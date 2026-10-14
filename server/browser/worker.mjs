import { chromium } from 'playwright';
import { z } from 'zod';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { id, now, audit, transaction } from '../db.mjs';
import { stageImport, commitImport } from '../imports.mjs';
import { CredentialVault, makePolicy } from './security.mjs';

const selector = z.string().trim().min(1).max(500);
export const sourceSchema = z.object({
  event_id: z.string().min(1),
  url: z.string().url().max(1500),
  ready_selector: selector,
  steps: z
    .array(
      z.object({
        selector,
        action: z.enum(['click', 'check', 'select']),
        value: z.string().max(200).optional(),
      }),
    )
    .max(12),
  download_selector: selector,
  enabled: z.boolean().default(false),
  interval_minutes: z.number().int().min(30).max(10080).default(1440),
  auto_import: z.boolean().default(false),
});
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fingerprint = (s) =>
  hash(JSON.stringify([s.event_id, s.url, s.ready_selector, s.steps, s.download_selector]));
const publicUrl = (value) => {
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
};
export class BrowserWorker {
  constructor({
    db,
    dir,
    vaultKey,
    allowedHosts,
    policy,
    launchOptions = {},
    tickMs = 15000,
    jobTimeoutMs = 180000,
  }) {
    this.db = db;
    this.dir = path.join(dir, 'browser');
    this.policy = policy || makePolicy({ allowedHosts });
    this.vault = new CredentialVault(this.dir, vaultKey);
    this.launchOptions = launchOptions;
    this.context = null;
    this.page = null;
    this.busy = false;
    this.mode = 'closed';
    this.activeJob = null;
    this.lastTouch = Date.now();
    this.closing = false;
    this.jobTimeoutMs = jobTimeoutMs;
    db.exec(`CREATE TABLE IF NOT EXISTS browser_sources(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),config_json TEXT NOT NULL,verified_hash TEXT,next_run_at TEXT,last_run_at TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS browser_jobs(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES browser_sources(id),status TEXT NOT NULL,trigger TEXT NOT NULL,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT,batch_id TEXT REFERENCES import_batches(id),digest TEXT,summary_json TEXT,error TEXT,config_hash TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_browser_jobs_status ON browser_jobs(status,created_at);
`);
    db.prepare(
      "UPDATE browser_jobs SET status='interrupted',error='Server restarted during this run. Retry the sync.',finished_at=? WHERE status='running'",
    ).run(now());
    this.timer = setInterval(() => this.tick().catch(() => {}), tickMs);
    this.timer.unref();
  }
  sources() {
    return this.db
      .prepare(
        'SELECT s.*,e.name AS event_name FROM browser_sources s JOIN events e ON e.id=s.event_id ORDER BY s.created_at DESC',
      )
      .all()
      .map((s) => ({
        ...s,
        ...JSON.parse(s.config_json),
        config_json: undefined,
        verified: !!s.verified_hash,
      }));
  }
  status() {
    return {
      mode: this.mode,
      busy: this.busy,
      activeJob: this.activeJob,
      url: this.page ? publicUrl(this.page.url()) : '',
      vault: this.vault.status(),
      sources: this.sources(),
      jobs: this.db
        .prepare('SELECT * FROM browser_jobs ORDER BY created_at DESC LIMIT 40')
        .all()
        .map((j) => ({
          ...j,
          summary: j.summary_json ? JSON.parse(j.summary_json) : null,
          summary_json: undefined,
        })),
      engine: 'Playwright / Chromium',
      viewport: { width: 1280, height: 800 },
    };
  }
  saveSource(raw, sourceId) {
    const s = sourceSchema.parse(raw);
    this.policy.parse(s.url);
    if (!this.db.prepare('SELECT id FROM events WHERE id=?').get(s.event_id))
      throw new Error('Choose an existing event.');
    const old = sourceId
      ? this.db.prepare('SELECT * FROM browser_sources WHERE id=?').get(sourceId)
      : null;
    if (sourceId && !old) throw new Error('Source not found.');
    if (
      this.db
        .prepare(
          "SELECT id FROM browser_jobs WHERE source_id=? AND status IN ('queued','running','review')",
        )
        .get(sourceId || '')
    )
      throw new Error('Finish or dismiss the current run before editing this source.');
    const verified = old?.verified_hash === fingerprint(s) ? old.verified_hash : null;
    if (s.auto_import && !verified)
      throw new Error(
        'Review and import one successful run of this recipe before enabling automatic imports.',
      );
    const sid = sourceId || id();
    this.db
      .prepare(
        'INSERT INTO browser_sources VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET event_id=excluded.event_id,config_json=excluded.config_json,verified_hash=excluded.verified_hash,next_run_at=excluded.next_run_at',
      )
      .run(
        sid,
        s.event_id,
        JSON.stringify(s),
        verified,
        s.enabled ? new Date(Date.now() + s.interval_minutes * 60000).toISOString() : null,
        old?.last_run_at || null,
        old?.created_at || now(),
      );
    audit(this.db, 'browser.source_saved', {
      source_id: sid,
      enabled: s.enabled,
      auto_import: s.auto_import,
    });
    return { id: sid };
  }
  enqueue(sourceId, trigger = 'manual') {
    const s = this.sources().find((s) => s.id === sourceId);
    if (!s) throw new Error('Source not found.');
    if (
      this.db
        .prepare(
          "SELECT id FROM browser_jobs WHERE source_id=? AND status IN ('queued','running','review')",
        )
        .get(sourceId)
    )
      throw new Error('A run is already queued, running, or awaiting review for this event.');
    const jid = id();
    this.db
      .prepare(
        'INSERT INTO browser_jobs(id,source_id,status,trigger,created_at,config_hash) VALUES(?,?,?,?,?,?)',
      )
      .run(jid, sourceId, 'queued', trigger, now(), fingerprint(s));
    return { id: jid };
  }
  async tick() {
    if (this.closing) return;
    for (const s of this.sources())
      if (s.enabled && s.next_run_at && s.next_run_at <= now()) {
        try {
          this.enqueue(s.id, 'scheduled');
        } catch {}
        this.db
          .prepare('UPDATE browser_sources SET next_run_at=? WHERE id=?')
          .run(new Date(Date.now() + s.interval_minutes * 60000).toISOString(), s.id);
      }
    if (this.busy) return;
    if (this.mode === 'interactive') {
      if (Date.now() - this.lastTouch > 15 * 60000) await this.closeBrowser();
      return;
    }
    const job = this.db
      .prepare("SELECT * FROM browser_jobs WHERE status='queued' ORDER BY created_at LIMIT 1")
      .get();
    if (job) await this.run(job);
  }
  async launch() {
    if (this.context) return;
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    this.context = await chromium.launchPersistentContext(path.join(this.dir, 'profile'), {
      headless: true,
      chromiumSandbox: true,
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
      serviceWorkers: 'block',
      ...this.launchOptions,
    });
    this.context.setDefaultTimeout(15000);
    this.context.setDefaultNavigationTimeout(30000);
    await this.context.route('**/*', async (route) => {
      try {
        const req = route.request();
        if (req.url().startsWith('data:')) return route.continue();
        await this.policy.check(req.url(), req.isNavigationRequest());
        return route.continue();
      } catch {
        return route.abort('blockedbyclient');
      }
    });
    // Web sockets are not needed for CSV exports; block access to private services through them.
    await this.context.routeWebSocket('**/*', (ws) => ws.close());
    this.page = this.context.pages()[0] || (await this.context.newPage());
    this.context.on('page', (page) => {
      this.page = page;
      page.on('dialog', (d) => d.dismiss().catch(() => {}));
    });
    this.page.on('dialog', (d) => d.dismiss().catch(() => {}));
  }
  async exclusive(fn) {
    if (this.busy) throw new Error('The browser is busy. Wait for the current action or sync.');
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
  async open(url) {
    return this.exclusive(async () => {
      await this.policy.check(url);
      await this.launch();
      this.mode = 'interactive';
      this.lastTouch = Date.now();
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      return { ok: true };
    });
  }
  async closeBrowser() {
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.page = null;
    this.mode = 'closed';
  }
  async closeSession() {
    return this.exclusive(async () => {
      await this.closeBrowser();
      return { ok: true };
    });
  }
  async frame() {
    if (!this.page || this.mode === 'closed') return { image: null };
    const image = await this.page.screenshot({ type: 'jpeg', quality: 70, timeout: 5000 });
    return {
      image: `data:image/jpeg;base64,${image.toString('base64')}`,
      url: publicUrl(this.page.url()),
      width: 1280,
      height: 800,
    };
  }
  async action(input) {
    return this.exclusive(async () => {
      if (!this.page || this.mode !== 'interactive')
        throw new Error('Open an interactive browser session first.');
      this.lastTouch = Date.now();
      if (input.type === 'click') await this.page.mouse.click(input.x, input.y);
      if (input.type === 'text') await this.page.keyboard.insertText(input.text);
      if (input.type === 'key') await this.page.keyboard.press(input.key);
      if (input.type === 'scroll') await this.page.mouse.wheel(0, input.delta);
      return { ok: true };
    });
  }
  async useCredentials() {
    return this.exclusive(async () => {
      if (!this.page || this.mode !== 'interactive') throw new Error('Open the login page first.');
      const c = this.vault.read();
      if (new URL(this.page.url()).origin !== c.origin)
        throw new Error('Saved credentials can only be filled on their exact origin.');
      await this.page.locator(c.username_selector).fill(c.username);
      await this.page.locator(c.password_selector).fill(c.password);
      this.lastTouch = Date.now();
      return { ok: true };
    });
  }
  async run(job) {
    this.busy = true;
    this.mode = 'syncing';
    this.activeJob = job.id;
    this.db
      .prepare("UPDATE browser_jobs SET status='running',started_at=? WHERE id=?")
      .run(now(), job.id);
    const source = this.sources().find((s) => s.id === job.source_id);
    const timeout = setTimeout(() => this.closeBrowser(), this.jobTimeoutMs);
    timeout.unref();
    let stagedPath;
    try {
      if (!source || fingerprint(source) !== job.config_hash)
        throw new Error('Export configuration changed. Start a new run.');
      await this.policy.check(source.url);
      await this.launch();
      await this.page.goto(source.url, { waitUntil: 'domcontentloaded' });
      try {
        await this.page
          .locator(source.ready_selector)
          .waitFor({ state: 'visible', timeout: 15000 });
      } catch {
        let restored = false;
        try {
          const c = this.vault.read();
          if (new URL(this.page.url()).origin === c.origin) {
            await this.page.locator(c.username_selector).fill(c.username, { timeout: 5000 });
            await this.page.locator(c.password_selector).fill(c.password, { timeout: 5000 });
            await this.page.locator(c.password_selector).press('Enter');
            await this.page
              .locator(source.ready_selector)
              .waitFor({ state: 'visible', timeout: 15000 });
            await this.page.goto(source.url, { waitUntil: 'domcontentloaded' });
            await this.page
              .locator(source.ready_selector)
              .waitFor({ state: 'visible', timeout: 15000 });
            restored = true;
          }
        } catch {
          /* One attempt only; verification challenges require the owner. */
        }
        if (!restored) {
          const e = new Error(
            'The signed-in page was not found. Open the browser to sign in, or correct the ready selector.',
          );
          e.code = 'needs_login';
          throw e;
        }
      }
      for (const step of source.steps) {
        const target = this.page.locator(step.selector);
        if (step.action === 'click') await target.click();
        if (step.action === 'check') await target.check();
        if (step.action === 'select') await target.selectOption(step.value || '');
      }
      const downloaded = this.page.waitForEvent('download', { timeout: 45000 });
      const [download] = await Promise.all([
        downloaded,
        this.page.locator(source.download_selector).click(),
      ]);
      const stream = await download.createReadStream();
      if (!stream) throw new Error('Report download did not complete.');
      const chunks = [];
      let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > 4000000) {
          stream.destroy();
          await download.cancel().catch(() => {});
          throw new Error('Report exceeds the 4 MB import limit. Export a smaller report.');
        }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks),
        csv = raw.toString('utf8');
      if (!csv.trim() || csv.includes('\u0000') || /^\s*<(?:!doctype|html)/i.test(csv))
        throw new Error('The download is not a CSV report.');
      const digest = hash(raw),
        filename = `posh-${job.id}.csv`,
        reports = path.join(this.dir, 'reports');
      await mkdir(reports, { recursive: true, mode: 0o700 });
      stagedPath = path.join(reports, filename);
      await writeFile(`${stagedPath}.tmp`, raw, { mode: 0o600 });
      await rename(`${stagedPath}.tmp`, stagedPath);
      const previous = this.db
        .prepare(
          "SELECT digest FROM browser_jobs WHERE source_id=? AND status='imported' ORDER BY finished_at DESC LIMIT 1",
        )
        .get(source.id);
      if (previous?.digest === digest) {
        this.finish(job.id, 'unchanged', {
          digest,
          summary: { message: 'Report matches the last imported file.' },
        });
        return;
      }
      const preview = stageImport(this.db, { event_id: source.event_id, filename, csv });
      const summary = {
        rows: preview.rows,
        newOrders: preview.newOrders,
        updates: preview.updates,
        net_cents: preview.net_cents,
      };
      this.db
        .prepare('UPDATE browser_jobs SET batch_id=?,digest=?,summary_json=? WHERE id=?')
        .run(preview.id, digest, JSON.stringify(summary), job.id);
      if (source.auto_import && source.verified_hash === job.config_hash) {
        transaction(this.db, () => {
          commitImport(this.db, preview.id, { inTransaction: true });
          this.finish(job.id, 'imported', { summary });
        });
      } else this.finish(job.id, 'review', { summary });
    } catch (error) {
      this.finish(job.id, error.code === 'needs_login' ? 'needs_login' : 'failed', {
        error:
          error.code === 'needs_login'
            ? error.message
            : error instanceof z.ZodError
              ? 'Downloaded CSV does not match the import schema. Review the report columns.'
              : String(error.message).split('\n')[0].slice(0, 400),
      });
    } finally {
      clearTimeout(timeout);
      await this.closeBrowser();
      this.activeJob = null;
      this.busy = false;
      this.db
        .prepare('UPDATE browser_sources SET last_run_at=? WHERE id=?')
        .run(now(), job.source_id);
    }
  }
  finish(jid, status, { digest, summary, error } = {}) {
    this.db
      .prepare(
        'UPDATE browser_jobs SET status=?,finished_at=?,digest=COALESCE(?,digest),summary_json=COALESCE(?,summary_json),error=? WHERE id=?',
      )
      .run(
        status,
        now(),
        digest || null,
        summary ? JSON.stringify(summary) : null,
        error || null,
        jid,
      );
    audit(this.db, 'browser.run_finished', { job_id: jid, status });
  }
  preview(jid) {
    const job = this.db.prepare('SELECT * FROM browser_jobs WHERE id=?').get(jid);
    if (!job?.batch_id) throw new Error('This run has no preview.');
    const batch = this.db.prepare('SELECT * FROM import_batches WHERE id=?').get(job.batch_id);
    return {
      job,
      sample: JSON.parse(batch.rows_json).slice(0, 8),
      summary: JSON.parse(job.summary_json),
    };
  }
  approve(jid) {
    return transaction(this.db, () => {
      const job = this.db.prepare('SELECT * FROM browser_jobs WHERE id=?').get(jid);
      if (job?.status === 'imported') return { ok: true, alreadyCommitted: true };
      if (job?.status !== 'review') throw new Error('Only a reviewed download can be imported.');
      const source = this.sources().find((s) => s.id === job.source_id);
      if (fingerprint(source) !== job.config_hash)
        throw new Error('The source changed. Run a fresh preview.');
      commitImport(this.db, job.batch_id, { inTransaction: true });
      this.finish(jid, 'imported');
      this.db
        .prepare('UPDATE browser_sources SET verified_hash=? WHERE id=?')
        .run(job.config_hash, source.id);
      return { ok: true };
    });
  }
  dismiss(jid) {
    const job = this.db.prepare('SELECT * FROM browser_jobs WHERE id=?').get(jid);
    if (!job || !['queued', 'review'].includes(job.status))
      throw new Error('Only queued or review runs can be dismissed.');
    this.finish(jid, 'dismissed');
    return { ok: true };
  }
  async shutdown() {
    this.closing = true;
    clearInterval(this.timer);
    await this.closeBrowser();
    while (this.busy) await new Promise((r) => setTimeout(r, 25));
  }
}
