import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb, seedDemo } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
let live, demo, app, agent;
beforeEach(() => {
  live = openDb(':memory:');
  demo = openDb(':memory:');
  seedDemo(demo);
  app = createApp({ live, demo, webhookToken: 'test-webhook-secret' });
  agent = request.agent(app);
});
afterEach(() => {
  live.close();
  demo.close();
});
const write = (method, url, body) => agent[method](url).set('X-Crowd-Control', '1').send(body);
async function setup() {
  await write('post', '/api/auth/setup', {
    email: 'owner@example.com',
    password: 'a-long-owner-password',
  }).expect(201);
}
async function event() {
  const r = await write('post', '/api/events', {
    name: 'Night One',
    concept: 'Velvet',
    city: 'Austin',
    venue: 'The Room',
    starts_at: '2027-01-01T20:00:00-06:00',
    timezone: 'America/Chicago',
    capacity: 100,
    price_cents: 3000,
    genre: 'R&B',
  }).expect(201);
  return r.body.id;
}
const csv = (refund = '0.00', email = 'jane@example.com', subtotal = '60.00') =>
  `order_id,name,email,quantity,subtotal,refund,purchased_at,city,scanned_count\norder-001,Jane Doe,${email},2,${subtotal},${refund},2026-09-18T20:00:00-05:00,Austin,1\n`;
async function preview(eid, text = csv()) {
  return (
    await write('post', '/api/imports/preview', {
      event_id: eid,
      filename: 'orders.csv',
      csv: text,
    }).expect(200)
  ).body;
}
test('demo is isolated, read only, and live data requires authentication', async () => {
  await agent.get('/api/people').expect(401);
  const r = await agent.get('/api/people').set('X-Workspace', 'demo').expect(200);
  assert.equal(r.body.length, 186);
  await agent
    .post('/api/people')
    .set('X-Workspace', 'demo')
    .set('X-Crowd-Control', '1')
    .send({})
    .expect(403);
  assert.equal(live.prepare('SELECT COUNT(*) n FROM people').get().n, 0);
});
test('owner setup, password login, session expiry and CSRF enforcement', async () => {
  await agent.post('/api/auth/setup').send({}).expect(403);
  await setup();
  await write('post', '/api/auth/setup', {
    email: 'second@example.com',
    password: 'a-second-long-password',
  }).expect(409);
  await agent
    .post('/api/people')
    .set('X-Crowd-Control', '1')
    .set('Origin', 'https://attacker.invalid')
    .send({})
    .expect(403);
  await write('post', '/api/auth/logout', {}).expect(200);
  await agent.get('/api/people').expect(401);
  await write('post', '/api/auth/login', {
    email: 'owner@example.com',
    password: 'a-wrong-owner-password',
  }).expect(401);
  const r = await write('post', '/api/auth/login', {
    email: 'owner@example.com',
    password: 'a-long-owner-password',
  }).expect(200);
  assert.match(r.headers['set-cookie'][0], /HttpOnly/);
  live.prepare('UPDATE sessions SET expires_at=0').run();
  await agent.get('/api/people').expect(401);
});
test('CSV preview has no customer side effects; commit and re-commit are idempotent', async () => {
  await setup();
  const eid = await event(),
    p = await preview(eid);
  assert.equal(p.newOrders, 1);
  assert.equal(live.prepare('SELECT COUNT(*) n FROM people').get().n, 0);
  await write('post', `/api/imports/${p.id}/commit`, {}).expect(200);
  const r = await write('post', `/api/imports/${p.id}/commit`, {}).expect(200);
  assert.equal(r.body.alreadyCommitted, true);
  assert.equal(live.prepare('SELECT COUNT(*) n FROM orders').get().n, 1);
  assert.equal(live.prepare('SELECT COUNT(*) n FROM interactions').get().n, 1);
  const people = (await agent.get('/api/people').expect(200)).body;
  assert.equal(people[0].revenue_cents, 6000);
  assert.equal(people[0].email_status, 'unknown');
  assert.equal(people[0].sms_status, 'unknown');
});
test('re-import updates refund without duplicate sales; full refund removes buyer eligibility', async () => {
  await setup();
  const eid = await event();
  let p = await preview(eid);
  await write('post', `/api/imports/${p.id}/commit`, {}).expect(200);
  p = await preview(eid, csv('60.00'));
  assert.equal(p.updates, 1);
  await write('post', `/api/imports/${p.id}/commit`, {}).expect(200);
  const r = (await agent.get('/api/people').expect(200)).body;
  assert.equal(r[0].revenue_cents, 0);
  assert.equal(r[0].events_count, 0);
  assert.equal(live.prepare('SELECT COUNT(*) n FROM orders').get().n, 1);
});
test('identity conflicts roll back entire import', async () => {
  await setup();
  const eid = await event();
  let p = await preview(eid);
  await write('post', `/api/imports/${p.id}/commit`, {}).expect(200);
  p = await preview(eid, csv('0', 'different@example.com'));
  await write('post', `/api/imports/${p.id}/commit`, {}).expect(409);
  assert.equal(live.prepare('SELECT COUNT(*) n FROM people').get().n, 1);
  assert.equal(
    live.prepare('SELECT status FROM import_batches WHERE id=?').get(p.id).status,
    'preview',
  );
});
test('malformed data, negative money, scan overflow and ambiguous dates fail validation', async () => {
  await setup();
  const eid = await event();
  for (const text of [
    csv('-1'),
    csv().replace(',2,60', ',2.5,60'),
    csv().replace('20:00:00-05:00', '20:00:00'),
    csv().replace(',Austin,1', ',Austin,3'),
    csv() + csv().split('\n')[1],
  ])
    await write('post', '/api/imports/preview', {
      event_id: eid,
      filename: 'bad.csv',
      csv: text,
    }).expect(400);
  assert.equal(live.prepare('SELECT COUNT(*) n FROM import_batches').get().n, 0);
});
test('consent requires evidence, latest decision wins and unknown is never opt-in', async () => {
  await setup();
  const r = await write('post', '/api/people', {
    name: 'Jane',
    email: 'JANE@example.com',
    city: 'Austin',
  }).expect(201);
  const pid = r.body.id;
  await write('post', `/api/people/${pid}/consent`, {
    channel: 'sms',
    status: 'opted_in',
    evidence: 'yes',
  }).expect(400);
  for (const status of ['opted_in', 'opted_out'])
    await write('post', `/api/people/${pid}/consent`, {
      channel: 'sms',
      status,
      evidence: 'Explicit preference center decision v1',
    }).expect(200);
  const p = (await agent.get(`/api/people/${pid}`).expect(200)).body;
  assert.equal(p.sms_status, 'opted_out');
  assert.equal(p.consents.length, 2);
  assert.equal(p.email, 'jane@example.com');
});
test('existing registrations are suppressed from recommendations including free RSVPs', async () => {
  await setup();
  const eid = await event(),
    p = await preview(eid, csv('0', 'jane@example.com', '0.00'));
  await write('post', `/api/imports/${p.id}/commit`, {}).expect(200);
  const r = (await agent.get(`/api/events/${eid}/audience`).expect(200)).body;
  assert.equal(r.suppressed, 1);
  assert.equal(r.people.length, 0);
});
test('webhook inbox requires a secret, deduplicates deliveries and never mutates orders', async () => {
  await request(app).post('/api/webhooks/posh').send({ order: 'one' }).expect(401);
  for (let i = 0; i < 2; i++)
    await request(app)
      .post('/api/webhooks/posh')
      .set('Authorization', 'Bearer test-webhook-secret')
      .send({ order: 'one' })
      .expect(202);
  assert.equal(live.prepare('SELECT COUNT(*) n FROM webhook_inbox').get().n, 1);
  assert.equal(live.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
});
