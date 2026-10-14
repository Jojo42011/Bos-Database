import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDb } from '../server/db.mjs';
import { BrowserWorker } from '../server/browser/worker.mjs';
import { makePolicy, CredentialVault, privateAddress } from '../server/browser/security.mjs';
import { createApp } from '../server/app.mjs';
import { parseImport } from '../server/imports.mjs';

let fixture,
  origin,
  dir,
  db,
  demo,
  worker,
  agent,
  recipe,
  refund = 0;
const key = randomBytes(32).toString('hex');
const makeWorker = () =>
  new BrowserWorker({
    db,
    dir,
    vaultKey: key,
    policy: makePolicy({ testOrigin: origin }),
    tickMs: 3600000,
  });
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cc-browser-'));
  db = openDb(path.join(dir, 'live.sqlite'));
  demo = openDb(':memory:');
  const site = express();
  site.use(express.urlencoded({ extended: false }));
  site.get('/login', (req, res) =>
    res.send(
      '<h1>Fixture login</h1><form method="post"><label>Email<input name="email" type="email"></label><label>Password<input name="password" type="password"></label><button>Sign in</button></form>',
    ),
  );
  site.post('/login', (req, res) => {
    if (req.body.email !== 'fixture@example.com' || req.body.password !== 'fixture-secret')
      return res.status(401).send('Wrong credentials');
    res.cookie('fixture_session', 'logged-in', { httpOnly: true, maxAge: 86400000 });
    res.redirect('/report');
  });
  site.get('/report', (req, res) => {
    if (!req.headers.cookie?.includes('fixture_session=logged-in')) return res.redirect('/login');
    res.send(
      '<h1 id="organizer">Organizer dashboard</h1><a id="download" href="/download">Export CSV</a>',
    );
  });
  site.get('/download', (req, res) => {
    if (!req.headers.cookie?.includes('fixture_session=logged-in')) return res.status(401).end();
    res
      .set('Content-Disposition', 'attachment; filename="event-report.csv"')
      .type('text/csv')
      .send(
        `order_id,name,email,quantity,subtotal,refund,purchased_at,city\nfixture-1,Fixture Guest,guest@example.com,2,60.00,${refund}.00,2026-09-18T20:00:00-05:00,Austin\n`,
      );
  });
  fixture = await new Promise((resolve) => {
    const s = site.listen(0, '127.0.0.1', () => resolve(s));
  });
  origin = `http://127.0.0.1:${fixture.address().port}`;
  worker = makeWorker();
  agent = request.agent(createApp({ requireAuth: true, live: db, demo, browserWorker: worker }));
  await agent
    .post('/api/auth/setup')
    .set('X-Crowd-Control', '1')
    .send({ email: 'owner@example.com', password: 'a-long-owner-password' })
    .expect(201);
  const event = (
    await agent
      .post('/api/events')
      .set('X-Crowd-Control', '1')
      .send({
        name: 'Browser Test',
        concept: 'Velvet',
        city: 'Austin',
        venue: 'Test venue',
        starts_at: '2027-01-01T20:00:00-06:00',
        timezone: 'America/Chicago',
        capacity: 100,
        price_cents: 3000,
        genre: 'R&B',
      })
      .expect(201)
  ).body.id;
  recipe = {
    event_id: event,
    url: `${origin}/report`,
    ready_selector: '#organizer',
    steps: [],
    download_selector: '#download',
    enabled: false,
    interval_minutes: 30,
    auto_import: false,
  };
});
after(async () => {
  await worker.shutdown();
  await new Promise((r) => fixture.close(r));
  db.close();
  demo.close();
});
test('browser endpoints require owner authentication and reject demo access', async () => {
  const app = createApp({ requireAuth: true, live: db, demo, browserWorker: worker });
  await request(app).get('/api/browser').expect(401);
  await agent.get('/api/browser').set('X-Workspace', 'demo').expect(403);
  await agent
    .post('/api/browser/action')
    .set('X-Crowd-Control', '1')
    .send({ type: 'evaluate', code: 'process.exit()' })
    .expect(400);
});

test('a hosted workspace cannot be claimed without its setup token', async () => {
  const fresh = openDb(':memory:');
  try {
    const app = createApp({
      requireAuth: true,
      live: fresh,
      demo,
      setupToken: 'deployment-test-token',
    });
    const body = { email: 'owner@example.com', password: 'a-long-owner-password' };
    await request(app).post('/api/auth/setup').set('X-Crowd-Control', '1').send(body).expect(403);
    await request(app)
      .post('/api/auth/setup')
      .set('X-Crowd-Control', '1')
      .send({ ...body, setup_token: 'wrong' })
      .expect(403);
    await request(app)
      .post('/api/auth/setup')
      .set('X-Crowd-Control', '1')
      .send({ ...body, setup_token: 'deployment-test-token' })
      .expect(201);
  } finally {
    fresh.close();
  }
});
test('URL policy blocks non-POSH navigation, private addresses and credentials in URLs', async () => {
  const policy = makePolicy();
  for (const url of [
    'http://posh.vip/',
    'https://127.0.0.1/',
    'https://posh.vip.attacker.test/',
    'file:///etc/passwd',
    'https://user:pass@posh.vip/',
    'https://posh.vip:8443/',
  ])
    assert.throws(() => policy.parse(url));
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(privateAddress(ip), true);
  assert.equal(privateAddress('8.8.8.8'), false);
});
test('vault encrypts credentials and rejects the wrong key', async () => {
  const vault = new CredentialVault(dir, key);
  vault.save({ password: 'not-plaintext' });
  assert.equal(
    (await readFile(path.join(dir, 'credentials.enc'), 'utf8')).includes('not-plaintext'),
    false,
  );
  assert.equal(vault.read().password, 'not-plaintext');
  assert.throws(() => new CredentialVault(dir, randomBytes(32).toString('hex')).read());
});
test('real Chromium login, download, reviewed import, persisted session and scheduled refund update', async () => {
  const source = worker.saveSource(recipe);
  assert.throws(() => worker.saveSource({ ...recipe, auto_import: true }, source.id), /Review/);
  const unauth = worker.enqueue(source.id);
  await worker.tick();
  assert.equal(worker.status().jobs.find((j) => j.id === unauth.id).status, 'needs_login');
  await worker.open(`${origin}/login`);
  const frame = await worker.frame();
  assert.match(frame.image, /^data:image\/jpeg;base64,/);
  worker.vault.save({
    origin,
    username: 'fixture@example.com',
    password: 'fixture-secret',
    username_selector: 'input[type=email]',
    password_selector: 'input[type=password]',
  });
  await worker.useCredentials();
  await worker.action({ type: 'key', key: 'Enter' });
  await worker.page.locator('#organizer').waitFor();
  await worker.closeSession();
  const job = worker.enqueue(source.id);
  assert.throws(() => worker.enqueue(source.id), /already/);
  await worker.tick();
  assert.equal(worker.status().jobs.find((j) => j.id === job.id).status, 'review');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
  const preview = worker.preview(job.id);
  assert.equal(preview.summary.net_cents, 6000);
  assert.equal(preview.sample.length, 1);
  worker.approve(job.id);
  worker.approve(job.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 1);
  await worker.shutdown();
  worker = makeWorker();
  const duplicate = worker.enqueue(source.id);
  await worker.tick();
  assert.equal(worker.status().jobs.find((j) => j.id === duplicate.id).status, 'unchanged');
  await worker.open(`${origin}/report`);
  await worker.page.context().clearCookies();
  await worker.closeSession();
  const restored = worker.enqueue(source.id);
  await worker.tick();
  assert.equal(worker.status().jobs.find((j) => j.id === restored.id).status, 'unchanged');
  worker.saveSource({ ...recipe, enabled: true, auto_import: true }, source.id);
  refund = 20;
  db.prepare('UPDATE browser_sources SET next_run_at=? WHERE id=?').run(
    '2000-01-01T00:00:00Z',
    source.id,
  );
  await worker.tick();
  const latest = worker.status().jobs[0];
  assert.equal(latest.trigger, 'scheduled');
  assert.equal(latest.status, 'imported');
  assert.equal(db.prepare('SELECT subtotal_cents-refund_cents n FROM orders').get().n, 4000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 1);
  assert.throws(
    () =>
      worker.saveSource({ ...recipe, auto_import: true, ready_selector: '#changed' }, source.id),
    /Review/,
  );
});
test('restart marks in-flight jobs interrupted and does not auto-import unresolved reports', async () => {
  const source = worker.sources()[0];
  const job = worker.enqueue(source.id);
  db.prepare("UPDATE browser_jobs SET status='running' WHERE id=?").run(job.id);
  await worker.shutdown();
  worker = makeWorker();
  assert.equal(worker.status().jobs.find((j) => j.id === job.id).status, 'interrupted');
});
test('transfers, non-USD and unsupported order states cannot silently inflate sales', () => {
  const base = 'order_id,name,email,quantity,subtotal,purchased_at';
  const row = 'x,Example Guest,guest@example.com,1,20.00,2026-09-18T20:00:00-05:00';
  for (const [header, value] of [
    ['ticket_transfer', 'true'],
    ['currency', 'EUR'],
    ['order_status', 'Canceled'],
  ])
    assert.throws(() => parseImport(`${base},${header}\n${row},${value}`));
});
