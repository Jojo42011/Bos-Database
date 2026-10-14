import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.mjs';
import { BrowserWorker } from '../server/browser/worker.mjs';
import { makePolicy } from '../server/browser/security.mjs';
import { Collector } from '../server/collector/service.mjs';
import { createApp } from '../server/app.mjs';

test('Chromium collects paginated event history and orders, reuses login, stages review and rejects broken pagination', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cc-collector-')),
    db = openDb(':memory:'),
    demo = openDb(':memory:');
  const site = express();
  let broken = false,
    refund = 0;
  site.get('/login', (req, res) => {
    res.cookie('session', 'fixture', { httpOnly: true, maxAge: 86400000 });
    res.send('<h1>Signed in</h1>');
  });
  site.use((req, res, next) =>
    req.headers.cookie?.includes('session=fixture')
      ? next()
      : res.status(401).json({ error: 'Sign in' }),
  );
  site.get('/events', (req, res) =>
    res.send(
      '<h1 id="ready">Events</h1><button id="next" onclick="load(2)">Next</button><script>function load(p){fetch("/data/events?page="+p)}load(1)</script>',
    ),
  );
  site.get('/event/:id', (req, res) =>
    res.send(`<h1 id="ready">Orders</h1><script>fetch('/data/orders/${req.params.id}')</script>`),
  );
  site.get('/data/events', (req, res) => {
    const n = req.query.page === '2' && !broken ? 2 : 1;
    res.json({
      total: 2,
      items: [
        {
          id: 'e' + n,
          name: 'Night ' + n,
          starts_at: '2026-09-01T00:00:00Z',
          capacity: 100,
          price_cents: 3000,
          status: 'completed',
        },
      ],
    });
  });
  site.get('/data/orders/:id', (req, res) =>
    res.json({
      total: 1,
      items: [
        {
          id: 'o' + req.params.id,
          name: 'Jane',
          email: 'jane@example.com',
          quantity: 1,
          subtotal_cents: 3000,
          currency: 'USD',
          refund_cents: refund,
          status: refund ? 'refunded' : 'paid',
          purchased_at: '2026-08-01T00:00:00Z',
        },
      ],
    }),
  );
  const server = await new Promise((resolve) => {
      const s = site.listen(0, '127.0.0.1', () => resolve(s));
    }),
    origin = `http://127.0.0.1:${server.address().port}`;
  const worker = new BrowserWorker({
    db,
    dir,
    policy: makePolicy({ testOrigin: origin }),
    tickMs: 3600000,
  });
  const c = new Collector({ db, worker });
  const fields = (keys) =>
    Object.fromEntries(keys.split(' ').map((k) => [k, k === 'external_id' ? 'id' : k]));
  const spec = {
    url: origin + '/events',
    response_url: origin + '/data/events',
    ready_selector: '#ready',
    login_selector: '#login',
    items_path: 'items',
    total_path: 'total',
    next_selector: '#next',
    fields: fields('external_id name starts_at capacity price_cents status'),
  };
  try {
    const agent = request.agent(
      createApp({ requireAuth: true, live: db, demo, browserWorker: worker, collector: c }),
    );
    await agent.get('/api/collector').expect(401);
    await agent.get('/api/collector').set('X-Workspace', 'demo').expect(403);
    await agent
      .post('/api/auth/setup')
      .set('X-Crowd-Control', '1')
      .send({ email: 'owner@example.com', password: 'long-owner-password' })
      .expect(201);
    await agent.post('/api/collector/run').send({}).expect(403);
    const config = {
      organization: 'fixture',
      events: [spec],
      orders: {
        ...spec,
        url: origin + '/event/{event_id}',
        response_url: origin + '/data/orders/{event_id}',
        next_selector: '',
        fields: fields(
          'external_id name email quantity subtotal_cents refund_cents currency status purchased_at',
        ),
      },
    };
    await agent.post('/api/collector/config').set('X-Crowd-Control', '1').send(config).expect(200);
    await worker.launch();
    await worker.page.goto(origin + '/login');
    await worker.closeBrowser();
    const first = c.enqueue();
    await c.tick();
    assert.equal(c.status().runs[0].status, 'review', JSON.stringify(c.status()));
    assert.equal(c.preview(first.id).summary.events, 2);
    assert.equal(c.preview(first.id).summary.orders, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
    await agent
      .post('/api/collector/runs/' + first.id + '/approve')
      .set('X-Crowd-Control', '1')
      .send({})
      .expect(200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 2);
    c.save({ ...config, auto_import: true });
    refund = 3000;
    c.enqueue();
    await c.tick();
    assert.equal(c.status().runs[0].status, 'imported');
    assert.equal(db.prepare('SELECT SUM(refund_cents) n FROM orders').get().n, 6000);
    broken = true;
    c.enqueue();
    await c.tick();
    assert.equal(c.status().runs[0].status, 'incomplete');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 2);
  } finally {
    await c.shutdown();
    await worker.shutdown();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    demo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
