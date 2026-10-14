import { id, now, audit } from '../db.mjs';
import { configSchema, fingerprint } from './schema.mjs';
import { collectWorkspace } from './adapter.mjs';
import { applySnapshot, snapshotSummary, validateSnapshot } from './store.mjs';

export class Collector {
  constructor({ db, worker, collect = collectWorkspace, timeoutMs = 15 * 60000 }) {
    this.db = db;
    this.worker = worker;
    this.collect = collect;
    this.timeoutMs = timeoutMs;
    this.progress = null;
    this.controller = null;
    this.stopping = false;
    db.prepare(
      "UPDATE collector_runs SET status='interrupted',finished_at=?,error='Server restarted. No partial collection was imported.' WHERE status='running'",
    ).run(now());
    this.timer = setInterval(() => this.tick().catch(() => {}), 15000);
    this.timer.unref();
  }
  configuration() {
    const row = this.db.prepare('SELECT * FROM collector_config WHERE id=1').get();
    return row ? { ...row, config: JSON.parse(row.config_json), config_json: undefined } : null;
  }
  status() {
    const c = this.configuration();
    return {
      configuration: c,
      progress: this.progress,
      browserMode: this.worker.mode,
      runs: this.db
        .prepare(
          'SELECT id,trigger,status,started_at,finished_at,summary_json,error FROM collector_runs ORDER BY started_at DESC,rowid DESC LIMIT 30',
        )
        .all()
        .map((r) => ({
          ...r,
          summary: JSON.parse(r.summary_json || 'null'),
          summary_json: undefined,
        })),
      readiness: c?.verified_hash ? 'verified_recipe' : 'mapping_required',
      note: 'Live POSH compatibility requires a reviewed collection using your account.',
    };
  }
  save(raw) {
    const c = configSchema.parse(raw),
      old = this.configuration();
    if (
      this.db
        .prepare("SELECT id FROM collector_runs WHERE status IN ('queued','running','review')")
        .get()
    )
      throw new Error('Finish or dismiss the active collection before changing its configuration.');
    if (
      old &&
      old.config.organization !== c.organization &&
      this.db.prepare('SELECT 1 FROM source_records LIMIT 1').get()
    )
      throw new Error('Organization cannot change after import. Use a separate workspace.');
    for (const spec of [...c.events, c.orders]) {
      this.worker.policy.parse(spec.url.replaceAll('{event_id}', 'example'));
      this.worker.policy.parse(spec.response_url.replaceAll('{event_id}', 'example'));
    }
    if (!c.orders.url.includes('{event_id}'))
      throw new Error('Order page URL must include {event_id}.');
    if (!c.orders.fields.external_id || !c.events.every((e) => e.fields.external_id))
      throw new Error('Stable event and order ID mappings are required.');
    for (const [external, local] of Object.entries(c.event_links)) {
      const imported = this.db
        .prepare(
          "SELECT local_id FROM source_records WHERE organization=? AND kind='event' AND external_id=?",
        )
        .get(c.organization, external);
      if (imported && imported.local_id !== local)
        throw new Error('An imported event cannot be relinked automatically.');
    }
    const verified = old?.verified_hash === fingerprint(c) ? old.verified_hash : null;
    if (c.auto_import && !verified)
      throw new Error(
        'Review and import one complete collection before enabling automatic imports.',
      );
    this.db
      .prepare(
        `INSERT INTO collector_config VALUES(1,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,verified_hash=excluded.verified_hash,next_run_at=excluded.next_run_at`,
      )
      .run(
        JSON.stringify(c),
        verified,
        c.enabled ? new Date(Date.now() + c.interval_minutes * 60000).toISOString() : null,
      );
    audit(this.db, 'collector.configured', { enabled: c.enabled, auto_import: c.auto_import });
    return this.status();
  }
  enqueue(trigger = 'manual') {
    const c = this.configuration();
    if (!c) throw new Error('Configure the collector first.');
    if (
      this.db
        .prepare("SELECT id FROM collector_runs WHERE status IN ('queued','running','review')")
        .get()
    )
      throw new Error('A collection is already active or awaiting review.');
    const rid = id();
    this.db
      .prepare(
        'INSERT INTO collector_runs(id,trigger,status,config_hash,started_at) VALUES(?,?,?,?,?)',
      )
      .run(rid, trigger, 'queued', fingerprint(c.config), now());
    return { id: rid };
  }
  async tick() {
    if (this.stopping) return;
    const c = this.configuration();
    if (!c) return;
    if (c.config.enabled && c.next_run_at && c.next_run_at <= now()) {
      if (
        !this.db
          .prepare("SELECT id FROM collector_runs WHERE status IN ('queued','running','review')")
          .get()
      )
        this.enqueue('scheduled');
      this.db
        .prepare('UPDATE collector_config SET next_run_at=? WHERE id=1')
        .run(new Date(Date.now() + c.config.interval_minutes * 60000).toISOString());
    }
    if (this.worker.busy || this.worker.mode !== 'closed') return;
    const run = this.db
      .prepare("SELECT * FROM collector_runs WHERE status='queued' ORDER BY started_at LIMIT 1")
      .get();
    if (!run) return;
    await this.worker.exclusive(async () => {
      this.worker.mode = 'collecting';
      this.controller = new AbortController();
      const timeout = setTimeout(() => {
        this.controller?.abort(new Error('Collection timed out.'));
        void this.worker.closeBrowser();
      }, this.timeoutMs);
      timeout.unref();
      this.db.prepare("UPDATE collector_runs SET status='running' WHERE id=?").run(run.id);
      try {
        await this.worker.launch();
        const snapshot = validateSnapshot(
          await this.collect(this.worker, c.config, this.controller.signal, (p) => {
            this.progress = p;
          }),
        );
        this.controller.signal.throwIfAborted();
        const json = JSON.stringify(snapshot);
        if (Buffer.byteLength(json) > 40_000_000)
          throw new Error('Collection exceeds 40 MB. Narrow the configured scope.');
        this.db
          .prepare(
            "UPDATE collector_runs SET status='review',snapshot_json=?,summary_json=?,finished_at=? WHERE id=?",
          )
          .run(json, JSON.stringify(snapshotSummary(snapshot)), now(), run.id);
        if (c.config.auto_import && c.verified_hash === run.config_hash)
          applySnapshot(this.db, snapshot, c.config, run.id);
      } catch (e) {
        const state = this.controller.signal.aborted
          ? 'interrupted'
          : ['needs_login', 'mapping_required', 'rate_limited', 'incomplete'].includes(e.code)
            ? e.code
            : 'failed';
        const message = e.code
          ? e.message
          : e.name === 'ZodError'
            ? 'Source fields do not match the normalized schema. Review the mapping.'
            : this.controller.signal.aborted
              ? 'Collection stopped. No partial data was imported.'
              : 'Collection failed. Verify browser availability and source mapping; retry after resolving the issue.';
        // Failed automatic reconciliation retains its complete snapshot for inspection, but requires a new run.
        this.db
          .prepare('UPDATE collector_runs SET status=?,error=?,finished_at=? WHERE id=?')
          .run(state, message, now(), run.id);
      } finally {
        clearTimeout(timeout);
        this.controller = null;
        this.progress = null;
        await this.worker.closeBrowser();
      }
    });
  }
  preview(rid) {
    const r = this.db.prepare('SELECT * FROM collector_runs WHERE id=?').get(rid);
    if (!r?.snapshot_json) throw new Error('This collection has no staged records.');
    const s = JSON.parse(r.snapshot_json);
    return {
      id: r.id,
      status: r.status,
      summary: JSON.parse(r.summary_json),
      events: s.events.slice(0, 10).map((x) => x.data),
      orders: s.orders.slice(0, 10).map((x) => x.data),
    };
  }
  approve(rid) {
    const r = this.db.prepare('SELECT * FROM collector_runs WHERE id=?').get(rid);
    if (r?.status === 'imported') return { alreadyImported: true };
    if (r?.status !== 'review')
      throw new Error('Only a complete staged collection can be imported.');
    return applySnapshot(this.db, JSON.parse(r.snapshot_json), this.configuration().config, rid);
  }
  dismiss(rid) {
    const r = this.db.prepare('SELECT status FROM collector_runs WHERE id=?').get(rid);
    if (!r || !['queued', 'review'].includes(r.status))
      throw new Error('Only queued or review collections can be dismissed.');
    this.db
      .prepare(
        "UPDATE collector_runs SET status='dismissed',snapshot_json=NULL,finished_at=? WHERE id=?",
      )
      .run(now(), rid);
    return { ok: true };
  }
  async shutdown() {
    this.stopping = true;
    clearInterval(this.timer);
    this.controller?.abort(new Error('Server shutdown'));
    if (this.controller) await this.worker.closeBrowser();
  }
}
export function mountCollectorRoutes(app, collector) {
  app.use('/api/collector', (req, res, next) => {
    if (req.isDemo)
      return res.status(403).json({ error: 'Connect your live workspace to collect POSH data.' });
    if (!collector) return res.status(503).json({ error: 'Collector is unavailable.' });
    next();
  });
  const route = (method, path, fn) =>
    app[method]('/api/collector' + path, async (req, res, next) => {
      try {
        res.json(await fn(req));
      } catch (e) {
        e.status ||= 400;
        next(e);
      }
    });
  route('get', '', () => collector.status());
  route('post', '/config', (r) => collector.save(r.body));
  route('post', '/run', () => collector.enqueue());
  route('get', '/runs/:id', (r) => collector.preview(r.params.id));
  route('post', '/runs/:id/approve', (r) => collector.approve(r.params.id));
  route('post', '/runs/:id/dismiss', (r) => collector.dismiss(r.params.id));
}
