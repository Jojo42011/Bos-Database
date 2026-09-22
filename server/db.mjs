import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function openDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,phone TEXT DEFAULT '',city TEXT DEFAULT '',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,name TEXT NOT NULL,concept TEXT NOT NULL,city TEXT NOT NULL,venue TEXT NOT NULL,starts_at TEXT NOT NULL,timezone TEXT NOT NULL DEFAULT 'America/Chicago',capacity INTEGER NOT NULL CHECK(capacity>0),price_cents INTEGER NOT NULL CHECK(price_cents>=0),currency TEXT NOT NULL DEFAULT 'USD',genre TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'upcoming',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,source TEXT NOT NULL,external_id TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES events(id),person_id TEXT NOT NULL REFERENCES people(id),quantity INTEGER NOT NULL CHECK(quantity>0),subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents>=0),refund_cents INTEGER NOT NULL DEFAULT 0 CHECK(refund_cents>=0 AND refund_cents<=subtotal_cents),currency TEXT NOT NULL DEFAULT 'USD',status TEXT NOT NULL,channel TEXT NOT NULL,tracking_link TEXT DEFAULT '',purchased_at TEXT NOT NULL,scanned_count INTEGER,UNIQUE(source,external_id,event_id));
    CREATE TABLE IF NOT EXISTS interactions(id TEXT PRIMARY KEY,person_id TEXT REFERENCES people(id),event_id TEXT REFERENCES events(id),kind TEXT NOT NULL,detail TEXT NOT NULL,occurred_at TEXT NOT NULL,source TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS consent(id TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES people(id),channel TEXT NOT NULL,status TEXT NOT NULL,evidence TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS import_batches(id TEXT PRIMARY KEY,event_id TEXT REFERENCES events(id),filename TEXT NOT NULL,rows_json TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,committed_at TEXT);
    CREATE TABLE IF NOT EXISTS webhook_inbox(id TEXT PRIMARY KEY,digest TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'awaiting_mapping',received_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_orders_person ON orders(person_id);
    CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_person ON interactions(person_id,occurred_at);
    CREATE INDEX IF NOT EXISTS idx_consent_person ON consent(person_id,channel,created_at);
    `);
  if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec('PRAGMA user_version=1');
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function audit(db, action, detail) {
  db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(id(), action, JSON.stringify(detail), now());
}
export function people(db) {
  return db
    .prepare(
      `SELECT p.*,COALESCE((SELECT SUM(subtotal_cents-refund_cents) FROM orders WHERE person_id=p.id),0) AS revenue_cents,
    (SELECT COUNT(DISTINCT event_id) FROM orders WHERE person_id=p.id AND status='paid') AS events_count,
    (SELECT MAX(purchased_at) FROM orders WHERE person_id=p.id) AS last_purchase,
    COALESCE((SELECT status FROM consent WHERE person_id=p.id AND channel='email' ORDER BY created_at DESC,rowid DESC LIMIT 1),'unknown') AS email_status,
    COALESCE((SELECT status FROM consent WHERE person_id=p.id AND channel='sms' ORDER BY created_at DESC,rowid DESC LIMIT 1),'unknown') AS sms_status
    FROM people p ORDER BY revenue_cents DESC,p.name`,
    )
    .all();
}
export function events(db) {
  return db
    .prepare(
      `SELECT e.*,COALESCE(SUM(CASE WHEN o.status IN ('paid','rsvp') THEN o.quantity ELSE 0 END),0) AS tickets,
    COALESCE(SUM(o.subtotal_cents-o.refund_cents),0) AS revenue_cents,COUNT(DISTINCT o.person_id) AS buyers,
    SUM(o.scanned_count) AS scans FROM events e LEFT JOIN orders o ON o.event_id=e.id GROUP BY e.id ORDER BY e.starts_at DESC`,
    )
    .all();
}
export function seedDemo(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM events').get().n) return;
  transaction(db, () => {
    const day = 86400000,
      base = Date.now();
    const specs = [
      ['After Hours', 'OVO / XO', 'San Antonio', 'The Ivory Room', 14, 420, 3500, 'R&B'],
      ['Country Club', 'Country Club', 'Austin', 'The Pershing', 23, 350, 2800, 'Country'],
      [
        'Midnight Mirage',
        'Cactus Club',
        'San Antonio',
        '1902 Nightclub',
        35,
        600,
        4000,
        'Electronic',
      ],
      ['Velvet Sessions', 'OVO / XO', 'San Antonio', 'The Ivory Room', -14, 400, 3000, 'R&B'],
      ['Golden Hour', 'Country Club', 'Austin', 'The Pershing', -37, 350, 2500, 'Country'],
      ['Blue Monday', 'Blue Monday', 'Houston', 'White Oak Music Hall', -62, 500, 3200, 'R&B'],
    ];
    specs.forEach((s, i) =>
      db
        .prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          `event-${i}`,
          s[0],
          s[1],
          s[2],
          s[3],
          new Date(base + s[4] * day).toISOString(),
          'America/Chicago',
          s[5],
          s[6],
          'USD',
          s[7],
          s[4] > 0 ? 'upcoming' : 'completed',
          now(),
        ),
    );
    const first = [
      'Amelia',
      'Jordan',
      'Sofia',
      'Marcus',
      'Isabella',
      'Ethan',
      'Camila',
      'Noah',
      'Avery',
      'Jasmine',
      'Oliver',
      'Maya',
      'Sebastian',
      'Chloe',
      'Elijah',
      'Luna',
      'Alexander',
      'Aria',
      'Daniel',
      'Zoe',
    ];
    const last = [
      'Reyes',
      'Morgan',
      'Chen',
      'Williams',
      'Garcia',
      'Bennett',
      'Rivera',
      'Brooks',
      'Mitchell',
      'Torres',
      'Hughes',
      'Patel',
      'Cruz',
      'Foster',
      'Hayes',
      'Sullivan',
      'Martinez',
      'Reed',
      'Park',
      'Ellis',
    ];
    for (let i = 0; i < 186; i++) {
      const pid = `person-${i}`,
        city = ['San Antonio', 'Austin', 'San Antonio', 'Houston', 'Dallas'][i % 5];
      db.prepare('INSERT INTO people VALUES(?,?,?,?,?,?)').run(
        pid,
        `${first[i % 20]} ${last[(i * 7 + Math.floor(i / 20)) % 20]}`,
        `guest${i + 1}@example.com`,
        '',
        city,
        new Date(base - (80 + (i % 40)) * day).toISOString(),
      );
      for (const channel of ['email', 'sms'])
        if (i % (channel === 'email' ? 7 : 3) !== 0)
          db.prepare('INSERT INTO consent VALUES(?,?,?,?,?,?)').run(
            id(),
            pid,
            channel,
            'opted_in',
            'Synthetic demonstration consent',
            now(),
          );
      let bought = 0;
      for (let j = 0; j < 6; j++) {
        if (i % 5 === 0 || (i % 5 === 1 && bought > 0)) continue;
        if ((i * 13 + j * 7) % 10 > (j < 3 ? 3 : 6)) continue;
        bought++;
        const qty = 1 + ((i + j) % 3),
          price = specs[j][6],
          when = new Date(base + (Math.min(specs[j][4] - 2, -1) - (i % 16)) * day).toISOString();
        const refund = i % 41 === 0 ? qty * price : 0;
        db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
          id(),
          'demo',
          `order-${i}-${j}`,
          `event-${j}`,
          pid,
          qty,
          qty * price,
          refund,
          'USD',
          refund ? 'refunded' : 'paid',
          ['Email', 'Paid social', 'Promoter', 'Organic', 'SMS'][i % 5],
          ['newsletter', 'flyer2', 'host-marcus', 'bio', 'sms-reminder'][i % 5],
          when,
          j > 2 && !refund ? qty : null,
        );
        db.prepare('INSERT INTO interactions VALUES(?,?,?,?,?,?,?)').run(
          id(),
          pid,
          `event-${j}`,
          'purchase',
          `Purchased ${qty} ticket${qty > 1 ? 's' : ''} to ${specs[j][0]}`,
          when,
          'demo',
        );
      }
    }
  });
}
