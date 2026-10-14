import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, people, events } from '../server/db.mjs';
import { configSchema, fingerprint, mapRecord } from '../server/collector/schema.mjs';
import { applySnapshot, validateSnapshot } from '../server/collector/store.mjs';
import { Collector } from '../server/collector/service.mjs';
import { rankAudience } from '../server/recommendations.mjs';
import { createDraft, draftDetail } from '../server/campaigns.mjs';
import { stageImport, commitImport } from '../server/imports.mjs';
let db, serial;
beforeEach(() => {
  db = openDb(':memory:');
  serial = 0;
});
afterEach(() => db.close());
const spec = {
  url: 'https://posh.vip/events',
  response_url: 'https://posh.vip/data',
  ready_selector: '#ready',
  login_selector: '#login',
  items_path: 'items',
  total_path: 'total',
  fields: { external_id: 'id' },
};
const config = configSchema.parse({
  organization: 'test',
  events: [spec],
  orders: { ...spec, url: 'https://posh.vip/events/{event_id}' },
});
const ev = (id, date = '2026-09-01T00:00:00Z') => ({
  data: {
    external_id: id,
    name: 'Night ' + id,
    starts_at: date,
    capacity: 100,
    price_cents: 3000,
    status: date.startsWith('2099') ? 'upcoming' : 'completed',
    genre: 'House',
    concept: 'Night',
    city: 'Austin',
  },
  raw: { id },
});
const order = (eid, extra = {}) => ({
  data: {
    external_id: 'o1',
    event_external_id: eid,
    name: 'Jane',
    email: 'JANE@example.com',
    city: 'Austin',
    quantity: 2,
    subtotal_cents: 6000,
    refund_cents: 0,
    currency: 'USD',
    purchased_at: '2026-08-01T00:00:00Z',
    status: 'paid',
    ...extra,
  },
  raw: { session_token: 'never retain', id: 'o1' },
});
function snapshot(extra = {}) {
  return {
    complete: true,
    observed_at: '2026-10-01T00:00:00Z',
    events: [ev('past'), ev('future', '2099-01-01T00:00:00Z')],
    orders: [order('past')],
    ...extra,
  };
}
function run(s, c = config) {
  const id = 'run' + ++serial;
  db.prepare(
    'INSERT INTO collector_runs(id,trigger,status,config_hash,started_at) VALUES(?,?,?,?,?)',
  ).run(id, 'manual', 'review', fingerprint(c), s.observed_at);
  return { id, result: () => applySnapshot(db, s, c, id) };
}
test('complete collection imports atomically, normalizes identity, redacts raw secrets and is idempotent', () => {
  const first = run(snapshot());
  first.result();
  assert.equal(first.result().alreadyImported, true);
  run(snapshot({ observed_at: '2026-10-02T00:00:00Z' })).result();
  assert.equal(people(db).length, 1);
  assert.equal(people(db)[0].email, 'jane@example.com');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM interactions').get().n, 1);
  assert.equal(people(db)[0].email_status, 'unknown');
  assert.equal(
    db
      .prepare("SELECT raw_json FROM source_records WHERE kind='order'")
      .get()
      .raw_json.includes('never retain'),
    false,
  );
  assert.equal(db.prepare('SELECT scanned_count FROM orders').get().scanned_count, null);
});
test('refund revisions update one order and stale snapshots cannot undo them', () => {
  run(snapshot()).result();
  run(
    snapshot({
      observed_at: '2026-10-03T00:00:00Z',
      orders: [order('past', { status: 'refunded', refund_cents: 6000 })],
    }),
  ).result();
  const stale = run(snapshot({ observed_at: '2026-10-02T00:00:00Z' })).result();
  assert.equal(stale.stale, 3);
  assert.equal(people(db)[0].revenue_cents, 0);
  const target = events(db).find((e) => e.name === 'Night future');
  assert.equal(rankAudience(db, target.id).people[0].evidence_events, 0);
});
test('identity conflict rolls back the whole collection, including new events', () => {
  run(snapshot()).result();
  const bad = snapshot({
    observed_at: '2026-10-02T00:00:00Z',
    events: [...snapshot().events, ev('new')],
    orders: [order('past', { email: 'someone@example.com' })],
  });
  assert.throws(run(bad).result, /identity changed/);
  assert.equal(events(db).length, 2);
  assert.equal(people(db).length, 1);
});
test('partial or duplicate data, invalid money and timestamp conflicts fail closed', () => {
  assert.throws(() => validateSnapshot(snapshot({ complete: false })), /Incomplete/);
  assert.throws(
    () => validateSnapshot(snapshot({ orders: [order('past'), order('past')] })),
    /Duplicate order/,
  );
  assert.throws(
    () => validateSnapshot(snapshot({ orders: [order('past', { scanned_count: 3 })] })),
    /Scans/,
  );
  run(snapshot()).result();
  assert.throws(
    run(snapshot({ orders: [order('past', { refund_cents: 1000 })] })).result,
    /same source timestamp/,
  );
});
test('matching uses distinct past events, consent, and suppresses existing future registrations', () => {
  run(snapshot({ orders: [order('past'), order('past', { external_id: 'o2' })] })).result();
  const target = events(db).find((e) => e.name === 'Night future');
  let ranking = rankAudience(db, target.id, { at: Date.parse('2026-10-01') });
  assert.equal(ranking.people[0].evidence_events, 1);
  assert.equal(ranking.people[0].confidence, 'low');
  assert.equal(ranking.people[0].email_eligible, false);
  assert.match(ranking.people[0].attendance, /Not inferred/);
  run(
    snapshot({
      observed_at: '2026-10-02T00:00:00Z',
      orders: [order('past'), order('future', { external_id: 'registered', status: 'pending' })],
    }),
  ).result();
  ranking = rankAudience(db, target.id);
  assert.equal(ranking.suppressed, 1);
  assert.equal(ranking.people.length, 0);
});
test('campaign draft freezes reasons but rechecks permission and registrations', () => {
  run(snapshot()).result();
  const p = people(db)[0],
    target = events(db).find((e) => e.name === 'Night future');
  const empty = createDraft(db, {
    event_id: target.id,
    channel: 'email',
    body: 'Join us',
    min_score: 0,
  });
  assert.equal(empty.recipients.length, 0);
  db.prepare('INSERT INTO consent VALUES(?,?,?,?,?,?)').run(
    'c1',
    p.id,
    'email',
    'opted_in',
    'Explicit signup',
    '2026-10-01T00:00:00Z',
  );
  const draft = createDraft(db, {
    event_id: target.id,
    channel: 'email',
    body: 'Join us',
    min_score: 0,
    holdout_percent: 0,
  });
  assert.equal(draft.eligible, 1);
  assert.equal(draft.sending_enabled, false);
  db.prepare('INSERT INTO consent VALUES(?,?,?,?,?,?)').run(
    'c2',
    p.id,
    'email',
    'opted_out',
    'Unsubscribe',
    '2026-10-02T00:00:00Z',
  );
  assert.equal(draftDetail(db, draft.id).eligible, 0);
});
test('manual CSV cannot overwrite a source-managed order', () => {
  run(snapshot()).result();
  const eid = events(db).find((e) => e.name === 'Night past').id;
  const staged = stageImport(db, {
    event_id: eid,
    filename: 'old.csv',
    csv: 'order_id,name,email,quantity,subtotal,refund,purchased_at\no1,Jane,jane@example.com,2,60.00,0.00,2026-08-01T00:00:00Z\n',
  });
  assert.throws(() => commitImport(db, staged.id), /managed by the collector/);
});
test('scheduler blocks partial data, serializes browser use, and requires reviewed mapping for auto-import', async () => {
  const worker = {
    mode: 'closed',
    busy: false,
    policy: { parse: () => {} },
    async exclusive(fn) {
      this.busy = true;
      try {
        return await fn();
      } finally {
        this.busy = false;
      }
    },
    async launch() {},
    async closeBrowser() {
      this.mode = 'closed';
    },
  };
  let calls = 0;
  const c = new Collector({
    db,
    worker,
    collect: async () => {
      calls++;
      return snapshot();
    },
  });
  try {
    assert.throws(() => c.save({ ...config, auto_import: true }), /Review and import/);
    c.save(config);
    c.enqueue();
    assert.throws(() => c.enqueue(), /already active/);
    worker.busy = true;
    await c.tick();
    assert.equal(calls, 0);
    worker.busy = false;
    await c.tick();
    assert.equal(c.status().runs[0].status, 'review');
    assert.equal(people(db).length, 0);
    c.approve(c.status().runs[0].id);
    c.save({ ...config, enabled: true, auto_import: true });
    db.prepare("UPDATE collector_config SET next_run_at='2000-01-01'").run();
    await c.tick();
    assert.equal(calls, 2);
    assert.equal(c.status().runs[0].status, 'imported');
    assert.throws(
      () =>
        c.save({
          ...config,
          events: [{ ...spec, response_url: 'https://posh.vip/changed' }],
          auto_import: true,
        }),
      /Review and import/,
    );
    c.save(config);
    c.collect = async () => snapshot({ complete: false });
    c.enqueue();
    await c.tick();
    assert.equal(c.status().runs[0].status, 'failed');
    assert.equal(people(db).length, 1);
  } finally {
    await c.shutdown();
  }
});
