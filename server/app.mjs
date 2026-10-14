import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { stageImport, commitImport } from './imports.mjs';
import { rankAudience } from './recommendations.mjs';
import { mountCollectorRoutes } from './collector/service.mjs';
import { mountCampaignRoutes } from './campaigns.mjs';
import { mountBrowserRoutes } from './browser/routes.mjs';
import { z } from 'zod';
import { id, now, transaction, audit, people, events } from './db.mjs';

const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const text = z.string().trim().min(1).max(200);
const credentials = z.object({ email, password: z.string().min(12).max(128) });
const eventSchema = z.object({
  name: text,
  concept: text,
  city: text,
  venue: text,
  starts_at: z.string().datetime({ offset: true }),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid timezone'),
  capacity: z.number().int().min(1).max(1000000),
  price_cents: z.number().int().min(0).max(100000000),
  genre: text,
});
const contactSchema = z.object({
  name: text,
  email,
  phone: z.string().trim().max(40).default(''),
  city: z.string().trim().max(100).default(''),
});
const digest = (value) => createHash('sha256').update(value).digest('hex');
const passwordHash = (password) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};
const verifyPassword = (password, hash) => {
  const [salt, key] = hash.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex'));
};
const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
export function createApp({
  live,
  demo,
  webhookToken = '',
  publicOrigin = '',
  secureCookie = false,
  browserWorker = null,
  collector = null,
  setupToken = '',
  requireAuth = false,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (req, res) => {
    live.prepare('SELECT 1').get();
    res.json({ ok: true });
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
        },
      },
    }),
  );
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path !== '/webhooks/posh') {
      const origin = req.get('origin');
      const allowed = publicOrigin || `${req.protocol}://${req.get('host')}`;
      if (origin && origin !== allowed)
        return res.status(403).json({ error: 'Origin not allowed' });
      if (req.get('x-crowd-control') !== '1')
        return res.status(403).json({ error: 'Missing request verification header' });
    }
    next();
  });
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again later.' },
  });
  app.use(
    '/api/auth',
    (req, res, next) =>
      requireAuth ? next() : res.status(404).json({ error: 'App login is disabled.' }),
    loginLimit,
  );
  const sessionUser = (req) => {
    const token = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('cc_session='))
      ?.slice(11);
    if (!token) return null;
    return live
      .prepare(
        'SELECT u.id,u.email FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires_at>?',
      )
      .get(digest(token), Date.now());
  };
  const setSession = (res, user) => {
    const token = randomBytes(32).toString('hex');
    live.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    live
      .prepare('INSERT INTO sessions VALUES(?,?,?)')
      .run(digest(token), user.id, Date.now() + 8 * 60 * 60 * 1000);
    res.cookie('cc_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });
  };
  app.get('/api/auth/status', (req, res) =>
    res.json({
      setupRequired: !live.prepare('SELECT id FROM users LIMIT 1').get(),
      setupTokenRequired: !!setupToken,
      user: sessionUser(req) || null,
    }),
  );
  app.post('/api/auth/setup', (req, res) => {
    if (
      setupToken &&
      (typeof req.body.setup_token !== 'string' ||
        !timingSafeEqual(
          Buffer.from(digest(req.body.setup_token)),
          Buffer.from(digest(setupToken)),
        ))
    )
      fail(403, 'The workspace setup token is incorrect.');
    const data = credentials.parse(req.body);
    const user = transaction(live, () => {
      if (live.prepare('SELECT id FROM users LIMIT 1').get())
        fail(409, 'Workspace owner already exists. Sign in instead.');
      const user = { id: id(), email: data.email };
      live
        .prepare('INSERT INTO users VALUES(?,?,?,?)')
        .run(user.id, user.email, passwordHash(data.password), now());
      return user;
    });
    setSession(res, user);
    res.status(201).json({ user });
  });
  app.post('/api/auth/login', (req, res) => {
    const data = credentials.parse(req.body),
      user = live.prepare('SELECT * FROM users WHERE email=?').get(data.email);
    if (!user || !verifyPassword(data.password, user.password))
      fail(401, 'Email or password is incorrect.');
    setSession(res, user);
    res.json({ user: { id: user.id, email: user.email } });
  });
  app.post('/api/auth/logout', (req, res) => {
    const token = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('cc_session='))
      ?.slice(11);
    if (token) live.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));
    res.clearCookie('cc_session', {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
    });
    res.json({ ok: true });
  });
  app.post('/api/webhooks/posh', rateLimit({ windowMs: 60000, limit: 120 }), (req, res) => {
    if (!webhookToken) fail(503, 'Webhook receiver is not configured.');
    const supplied = req.get('authorization') || '';
    if (
      !timingSafeEqual(Buffer.from(digest(supplied)), Buffer.from(digest(`Bearer ${webhookToken}`)))
    )
      fail(401, 'Invalid webhook token.');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
      fail(400, 'Expected a JSON object.');
    const payload = JSON.stringify(req.body),
      key = digest(payload);
    live
      .prepare('INSERT OR IGNORE INTO webhook_inbox(id,digest,payload,received_at) VALUES(?,?,?,?)')
      .run(id(), key, payload, now());
    res.status(202).json({ accepted: true, status: 'awaiting_mapping' });
  });
  app.use('/api', (req, res, next) => {
    const isDemo = requireAuth && req.get('x-workspace') === 'demo';
    if (isDemo && !['GET', 'HEAD'].includes(req.method))
      return res
        .status(403)
        .json({ error: 'Demo is read-only. Switch to your workspace to make changes.' });
    if (requireAuth && !isDemo && !sessionUser(req))
      return res.status(401).json({ error: 'Please sign in to your workspace.' });
    req.db = isDemo ? demo : live;
    req.isDemo = isDemo;
    next();
  });
  app.get('/api/dashboard', (req, res) => {
    const db = req.db,
      audience = people(db),
      ev = events(db),
      orders = db
        .prepare("SELECT * FROM orders WHERE status IN ('paid','refunded','cancelled','rsvp')")
        .all();
    const city = z.string().max(100).optional().parse(req.query.city),
      filtered = city ? audience.filter((p) => p.city === city) : audience;
    const ids = new Set(filtered.map((p) => p.id)),
      selected = orders.filter((o) => ids.has(o.person_id));
    const day = 86400000,
      days = 90,
      cutoff = Date.now() - days * day;
    const recent = selected.filter(
      (o) => Date.parse(o.purchased_at) >= cutoff && Date.parse(o.purchased_at) <= Date.now(),
    );
    const buyers = filtered.filter((p) => p.events_count > 0),
      repeat = buyers.filter((p) => p.events_count > 1);
    const trend = Array.from({ length: 12 }, (_, i) => {
      const end = Date.now() - (11 - i) * 7 * day,
        start = end - 7 * day;
      return {
        label: new Date(end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: recent
          .filter((o) => Date.parse(o.purchased_at) >= start && Date.parse(o.purchased_at) < end)
          .reduce((s, o) => s + o.subtotal_cents - o.refund_cents, 0),
      };
    });
    const channels = Object.entries(
      recent.reduce((a, o) => {
        a[o.channel] = (a[o.channel] || 0) + o.subtotal_cents - o.refund_cents;
        return a;
      }, {}),
    )
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    const upcoming = ev
      .filter(
        (e) =>
          e.status === 'upcoming' &&
          Date.parse(e.starts_at) > Date.now() &&
          (!city || e.city === city),
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    res.json({
      people: filtered.length,
      email: filtered.filter((p) => p.email_status === 'opted_in').length,
      sms: filtered.filter((p) => p.sms_status === 'opted_in').length,
      revenue_cents: recent.reduce((s, o) => s + o.subtotal_cents - o.refund_cents, 0),
      repeat_rate: buyers.length ? (repeat.length / buyers.length) * 100 : 0,
      repeat_buyers: repeat.length,
      buyers: buyers.length,
      trend,
      channels,
      upcoming,
      topPeople: filtered.slice(0, 5),
      cities: [...new Set(audience.map((p) => p.city).filter(Boolean))],
      activity: db
        .prepare(
          'SELECT i.*,p.name,e.name AS event_name FROM interactions i JOIN people p ON p.id=i.person_id LEFT JOIN events e ON e.id=i.event_id ORDER BY occurred_at DESC LIMIT 5',
        )
        .all(),
    });
  });
  app.get('/api/people', (req, res) => {
    const search = String(req.query.search || '').toLowerCase(),
      segment = String(req.query.segment || 'all');
    res.json(
      people(req.db).filter(
        (p) =>
          (!search || `${p.name} ${p.email} ${p.city}`.toLowerCase().includes(search)) &&
          (!req.query.city || p.city === req.query.city) &&
          (segment === 'all' ||
            (segment === 'repeat' && p.events_count > 1) ||
            (segment === 'sms' && p.sms_status === 'opted_in') ||
            (segment === 'email' && p.email_status === 'opted_in') ||
            (segment === 'nonbuyers' && p.events_count === 0)),
      ),
    );
  });
  app.post('/api/people', (req, res) => {
    const p = contactSchema.parse(req.body);
    if (req.db.prepare('SELECT id FROM people WHERE email=?').get(p.email))
      fail(409, 'A profile with that email already exists.');
    const pid = id();
    transaction(req.db, () => {
      req.db
        .prepare('INSERT INTO people VALUES(?,?,?,?,?,?)')
        .run(pid, p.name, p.email, p.phone, p.city, now());
      audit(req.db, 'person.created', { person_id: pid });
    });
    res.status(201).json({ id: pid });
  });
  app.get('/api/people/:id', (req, res) => {
    const person = people(req.db).find((p) => p.id === req.params.id);
    if (!person) fail(404, 'Person not found.');
    res.json({
      ...person,
      orders: req.db
        .prepare(
          'SELECT o.*,e.name AS event_name,e.genre FROM orders o JOIN events e ON e.id=o.event_id WHERE person_id=? ORDER BY purchased_at DESC',
        )
        .all(person.id),
      interactions: req.db
        .prepare('SELECT * FROM interactions WHERE person_id=? ORDER BY occurred_at DESC')
        .all(person.id),
      consents: req.db
        .prepare('SELECT * FROM consent WHERE person_id=? ORDER BY created_at DESC,rowid DESC')
        .all(person.id),
    });
  });
  app.post('/api/people/:id/consent', (req, res) => {
    const data = z
      .object({
        channel: z.enum(['email', 'sms']),
        status: z.enum(['opted_in', 'opted_out']),
        evidence: z.string().trim().min(10).max(2000),
      })
      .parse(req.body);
    if (!req.db.prepare('SELECT id FROM people WHERE id=?').get(req.params.id))
      fail(404, 'Person not found.');
    transaction(req.db, () => {
      req.db
        .prepare('INSERT INTO consent VALUES(?,?,?,?,?,?)')
        .run(id(), req.params.id, data.channel, data.status, data.evidence, now());
      audit(req.db, 'consent.recorded', { person_id: req.params.id, ...data });
    });
    res.json({ ok: true });
  });
  app.get('/api/events', (req, res) => res.json(events(req.db)));
  app.post('/api/events', (req, res) => {
    const e = eventSchema.parse(req.body),
      eid = id();
    transaction(req.db, () => {
      req.db
        .prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          eid,
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
          Date.parse(e.starts_at) > Date.now() ? 'upcoming' : 'completed',
          now(),
        );
      audit(req.db, 'event.created', { event_id: eid });
    });
    res.status(201).json({ id: eid });
  });
  app.get('/api/events/:id/audience', (req, res) => {
    res.json(rankAudience(req.db, req.params.id));
  });
  app.get('/api/sources', (req, res) =>
    res.json({
      demo: req.isDemo,
      webhookConfigured: !!webhookToken,
      webhooks: req.db
        .prepare(
          'SELECT id,status,received_at FROM webhook_inbox ORDER BY received_at DESC LIMIT 30',
        )
        .all(),
      imports: req.db
        .prepare(
          'SELECT id,event_id,filename,status,created_at,committed_at FROM import_batches ORDER BY created_at DESC LIMIT 30',
        )
        .all(),
      counts: {
        people: req.db.prepare('SELECT COUNT(*) AS n FROM people').get().n,
        events: req.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,
        orders: req.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
      },
    }),
  );
  mountBrowserRoutes(app, browserWorker);
  mountCollectorRoutes(app, collector);
  mountCampaignRoutes(app);
  app.post('/api/imports/preview', (req, res) => {
    const input = z
      .object({
        event_id: text,
        filename: z.string().max(200),
        csv: z.string().min(1).max(4000000),
      })
      .parse(req.body);
    res.json(stageImport(req.db, input));
  });
  app.post('/api/imports/:id/commit', (req, res) => res.json(commitImport(req.db, req.params.id)));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use((error, req, res, next) => {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (error.type === 'entity.too.large')
      return res
        .status(413)
        .json({ error: 'File too large. Split the import into files below 4 MB.' });
    if (error instanceof SyntaxError && 'body' in error)
      return res.status(400).json({ error: 'Invalid JSON.' });
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'Unexpected server error. Check server logs.',
    });
  });
  return app;
}
