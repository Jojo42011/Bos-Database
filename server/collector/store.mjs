import { createHash } from 'node:crypto';
import { id, now, transaction, audit } from '../db.mjs';
import { eventSchema, orderSchema, fingerprint, safeRaw } from './schema.mjs';

export function migrateCollector(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS collector_config(id INTEGER PRIMARY KEY CHECK(id=1),config_json TEXT NOT NULL,verified_hash TEXT,next_run_at TEXT,last_success_at TEXT);
    CREATE TABLE IF NOT EXISTS collector_runs(id TEXT PRIMARY KEY,trigger TEXT NOT NULL,status TEXT NOT NULL,config_hash TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,summary_json TEXT,error TEXT,snapshot_json TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS collector_one_active ON collector_runs((1)) WHERE status IN ('queued','running','review');
    CREATE TABLE IF NOT EXISTS source_records(organization TEXT NOT NULL,kind TEXT NOT NULL,external_id TEXT NOT NULL,local_id TEXT,version_at TEXT NOT NULL,observed_at TEXT NOT NULL,digest TEXT NOT NULL,raw_json TEXT NOT NULL,normalized_json TEXT NOT NULL,PRIMARY KEY(organization,kind,external_id));
    CREATE TABLE IF NOT EXISTS event_details(event_id TEXT PRIMARY KEY REFERENCES events(id),description TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',artists_json TEXT NOT NULL DEFAULT '[]',format TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS campaign_drafts(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),channel TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',subject TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,model_version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS campaign_recipients(campaign_id TEXT NOT NULL REFERENCES campaign_drafts(id),person_id TEXT NOT NULL REFERENCES people(id),score REAL NOT NULL,reasons_json TEXT NOT NULL,holdout INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft',PRIMARY KEY(campaign_id,person_id));
    CREATE TABLE IF NOT EXISTS message_events(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaign_drafts(id),person_id TEXT NOT NULL REFERENCES people(id),kind TEXT NOT NULL,occurred_at TEXT NOT NULL,provider_id TEXT UNIQUE);
  `);
  if (db.prepare('PRAGMA user_version').get().user_version < 3) db.exec('PRAGMA user_version=3');
}
const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function validateSnapshot(snapshot) {
  if (!Number.isFinite(Date.parse(snapshot.observed_at)))
    throw new Error('Collection timestamp is required');
  const events = snapshot.events.map((x) => ({ ...x, data: eventSchema.parse(x.data) }));
  const orders = snapshot.orders.map((x) => ({ ...x, data: orderSchema.parse(x.data) }));
  if (!snapshot.complete || events.length > 5000 || orders.length > 100000)
    throw new Error('Incomplete or oversized collection. Nothing was imported.');
  const ids = new Set();
  for (const e of events) {
    if (ids.has(e.data.external_id)) throw new Error('Duplicate event ID');
    ids.add(e.data.external_id);
  }
  const keys = new Set();
  for (const o of orders) {
    if (!ids.has(o.data.event_external_id))
      throw new Error('Order references an uncollected event');
    const k = JSON.stringify([o.data.event_external_id, o.data.external_id]);
    if (keys.has(k)) throw new Error('Duplicate order ID within an event');
    keys.add(k);
  }
  return { ...snapshot, events, orders };
}
export function snapshotSummary(snapshot) {
  return {
    events: snapshot.events.length,
    orders: snapshot.orders.length,
    transfers: snapshot.orders.filter((x) => x.data.status === 'transferred').length,
    scanned_orders: snapshot.orders.filter((x) => x.data.scanned_count > 0).length,
    net_cents: snapshot.orders.reduce(
      (s, x) =>
        s +
        (['paid', 'refunded', 'cancelled'].includes(x.data.status)
          ? x.data.subtotal_cents - x.data.refund_cents
          : 0),
      0,
    ),
    complete: snapshot.complete,
  };
}
export function applySnapshot(db, snapshot, config, runId) {
  snapshot = validateSnapshot(snapshot);
  return transaction(db, () => {
    const run = db.prepare('SELECT * FROM collector_runs WHERE id=?').get(runId);
    if (!run) throw new Error('Collection run not found');
    if (run.status === 'imported') return { alreadyImported: true };
    if (!['review', 'running'].includes(run.status) || run.config_hash !== fingerprint(config))
      throw new Error('Collection configuration changed. Run again.');
    const counts = { created: 0, updated: 0, unchanged: 0, stale: 0 };
    const organization = config.organization;
    const save = (kind, externalId, item, apply) => {
      const data = item.data,
        version = data.updated_at || snapshot.observed_at;
      const old = db
        .prepare('SELECT * FROM source_records WHERE organization=? AND kind=? AND external_id=?')
        .get(organization, kind, externalId);
      const content = { ...data };
      delete content.updated_at;
      const hash = digest(content);
      if (old && Date.parse(version) < Date.parse(old.version_at)) {
        counts.stale++;
        return old.local_id;
      }
      if (old && Date.parse(version) === Date.parse(old.version_at) && old.digest !== hash)
        throw new Error('Conflicting records with the same source timestamp. Review the mapping.');
      const changed = !old || old.digest !== hash;
      const local = changed ? apply(old?.local_id) : old.local_id;
      counts[!old ? 'created' : changed ? 'updated' : 'unchanged']++;
      db.prepare(
        `INSERT INTO source_records VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(organization,kind,external_id) DO UPDATE SET local_id=excluded.local_id,version_at=excluded.version_at,observed_at=excluded.observed_at,digest=excluded.digest,raw_json=excluded.raw_json,normalized_json=excluded.normalized_json`,
      ).run(
        organization,
        kind,
        externalId,
        local,
        version,
        snapshot.observed_at,
        hash,
        JSON.stringify(safeRaw(item.raw)),
        JSON.stringify(data),
      );
      return local;
    };
    const eventIds = new Map();
    for (const item of snapshot.events) {
      const e = item.data;
      const eid = save('event', e.external_id, item, (previous) => {
        const linked = config.event_links[e.external_id];
        if (previous && linked && previous !== linked)
          throw new Error('An imported event cannot be relinked automatically.');
        const local = previous || linked || id();
        if (linked && !db.prepare('SELECT id FROM events WHERE id=?').get(linked))
          throw new Error('Linked local event does not exist');
        const claimed = db
          .prepare(
            "SELECT external_id FROM source_records WHERE kind='event' AND local_id=? AND NOT(organization=? AND external_id=?)",
          )
          .get(local, organization, e.external_id);
        if (claimed) throw new Error('Two source events cannot share one local event');
        db.prepare(
          `INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,concept=excluded.concept,city=excluded.city,venue=excluded.venue,starts_at=excluded.starts_at,timezone=excluded.timezone,capacity=excluded.capacity,price_cents=excluded.price_cents,genre=excluded.genre,status=excluded.status`,
        ).run(
          local,
          e.name,
          e.concept,
          e.city,
          e.venue,
          e.starts_at,
          e.timezone,
          e.capacity,
          e.price_cents,
          'USD',
          e.genre,
          e.status,
          now(),
        );
        db.prepare(
          `INSERT INTO event_details VALUES(?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET description=excluded.description,tags_json=excluded.tags_json,artists_json=excluded.artists_json,format=excluded.format`,
        ).run(local, e.description, JSON.stringify(e.tags), JSON.stringify(e.artists), e.format);
        return local;
      });
      eventIds.set(e.external_id, eid);
    }
    for (const item of snapshot.orders) {
      const o = item.data,
        eid = eventIds.get(o.event_external_id);
      save('order', JSON.stringify([o.event_external_id, o.external_id]), item, () => {
        // Transfer registrations are retained as source evidence, never counted as new sales.
        if (o.status === 'transferred') {
          const exists = db
            .prepare(
              "SELECT id FROM orders WHERE event_id=? AND source='posh_csv' AND external_id=?",
            )
            .get(eid, o.external_id);
          if (exists)
            throw new Error(
              'Transfer changes an existing sale. Explicit source reconciliation is required.',
            );
          return null;
        }
        let person = db.prepare('SELECT * FROM people WHERE email=?').get(o.email);
        const oldOrder = db
          .prepare("SELECT * FROM orders WHERE event_id=? AND source='posh_csv' AND external_id=?")
          .get(eid, o.external_id);
        if (oldOrder && oldOrder.person_id !== person?.id)
          throw new Error(
            'Order identity changed. Resolve the buyer or transfer before importing.',
          );
        if (o.customer_external_id) {
          const identity = db
            .prepare(
              "SELECT local_id FROM source_records WHERE organization=? AND kind='customer' AND external_id=?",
            )
            .get(organization, o.customer_external_id);
          if (identity && identity.local_id !== person?.id)
            throw new Error('Customer identity changed. Review before merging profiles.');
        }
        if (!person) {
          person = { id: id() };
          db.prepare('INSERT INTO people VALUES(?,?,?,?,?,?)').run(
            person.id,
            o.name,
            o.email,
            o.phone,
            o.city,
            now(),
          );
        }
        if (o.customer_external_id)
          db.prepare('INSERT OR IGNORE INTO source_records VALUES(?,?,?,?,?,?,?,?,?)').run(
            organization,
            'customer',
            o.customer_external_id,
            person.id,
            o.updated_at || snapshot.observed_at,
            snapshot.observed_at,
            digest(o.email),
            '{}',
            JSON.stringify({ email: o.email }),
          );
        const oid = oldOrder?.id || id();
        db.prepare(
          `INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,external_id,event_id) DO UPDATE SET quantity=excluded.quantity,subtotal_cents=excluded.subtotal_cents,refund_cents=excluded.refund_cents,status=excluded.status,channel=excluded.channel,tracking_link=excluded.tracking_link,purchased_at=excluded.purchased_at,scanned_count=excluded.scanned_count`,
        ).run(
          oid,
          'posh_csv',
          o.external_id,
          eid,
          person.id,
          o.quantity,
          o.subtotal_cents,
          o.refund_cents,
          'USD',
          o.status,
          o.channel,
          o.tracking_link,
          o.purchased_at,
          o.scanned_count,
        );
        db.prepare('INSERT INTO interactions VALUES(?,?,?,?,?,?,?)').run(
          id(),
          person.id,
          eid,
          oldOrder ? 'order_updated' : 'purchase',
          `${oldOrder ? 'Updated' : 'Collected'} order ${o.external_id}`,
          now(),
          'posh_collector',
        );
        return oid;
      });
    }
    const summary = { ...snapshotSummary(snapshot), ...counts };
    db.prepare(
      "UPDATE collector_runs SET status='imported',finished_at=?,summary_json=?,snapshot_json=NULL,error=NULL WHERE id=?",
    ).run(now(), JSON.stringify(summary), runId);
    db.prepare('UPDATE collector_config SET verified_hash=?,last_success_at=? WHERE id=1').run(
      fingerprint(config),
      now(),
    );
    audit(db, 'collector.imported', { run_id: runId, ...summary });
    return summary;
  });
}
