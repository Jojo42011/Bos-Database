import Papa from 'papaparse';
import { z } from 'zod';
import { id, now, transaction, audit } from './db.mjs';
const text = z.string().trim().min(1).max(200);
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const rowsSchema = z
  .array(
    z
      .object({
        external_id: text,
        name: text,
        email,
        phone: z.string().max(40),
        city: z.string().max(100),
        quantity: z.number().int().min(1).max(10000),
        subtotal_cents: z.number().int().min(0).max(100000000),
        refund_cents: z.number().int().min(0),
        purchased_at: z.string().datetime({ offset: true }),
        channel: text,
        tracking_link: z.string().max(200),
        scanned_count: z.number().int().min(0).nullable(),
      })
      .refine((r) => r.refund_cents <= r.subtotal_cents, 'Refund exceeds subtotal')
      .refine(
        (r) => r.scanned_count === null || r.scanned_count <= r.quantity,
        'Scanned count exceeds quantity',
      ),
  )
  .min(1)
  .max(10000);
const aliases = {
  external_id: ['order_id', 'order_number', 'external_id'],
  name: ['name', 'full_name'],
  email: ['email', 'email_address'],
  phone: ['phone', 'phone_number'],
  city: ['city', 'billing_city'],
  quantity: ['quantity', 'number_of_tickets', 'tickets_purchased'],
  subtotal: ['subtotal', 'order_subtotal'],
  refund: ['refund', 'refund_amount'],
  purchased_at: ['purchased_at', 'order_date_time', 'order_date'],
  channel: ['channel'],
  tracking_link: ['tracking_link'],
  scanned_count: ['scanned_count', 'tickets_scanned'],
};
export function parseImport(csv) {
  const parsed = Papa.parse(csv, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) =>
      h
        .replace(/^\uFEFF/, '')
        .trim()
        .toLowerCase()
        .replace(/#/g, 'number')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, ''),
  });
  if (parsed.errors.length) fail(400, `CSV error: ${parsed.errors[0].message}`);
  const get = (r, k) => {
    for (const a of aliases[k] || [k]) if (r[a] !== undefined) return String(r[a]).trim();
    return '';
  };
  const money = (v) => {
    if (!/^\d+(\.\d{1,2})?$/.test(v))
      fail(400, 'Money must be a non-negative decimal without currency symbols or commas.');
    return Math.round(Number(v) * 100);
  };
  const rows = parsed.data.map((r, i) => {
    const state = String(r.order_status || r.status || '')
      .trim()
      .toLowerCase()
      .replace(/[ -]+/g, '_');
    if (
      state &&
      ![
        'paid',
        'completed',
        'complete',
        'confirmed',
        'rsvp',
        'refunded',
        'partially_refunded',
      ].includes(state)
    )
      fail(
        400,
        `Row ${i + 2}: unsupported order status. Cancellations, pending orders and disputes require source mapping.`,
      );
    const transferred = [
      'received_from_ticket_transfer',
      'number_of_tickets_sent_via_transfer',
      'ticket_transfer',
      'is_transfer',
    ].some(
      (key) =>
        r[key] && !['0', 'false', 'no', 'n/a', ''].includes(String(r[key]).trim().toLowerCase()),
    );
    if (transferred)
      fail(400, `Row ${i + 2}: ticket transfer detected. Resolve transfers before importing.`);
    if (r.currency && String(r.currency).trim().toUpperCase() !== 'USD')
      fail(400, `Row ${i + 2}: only USD is supported.`);
    const date = get(r, 'purchased_at');
    if (!/T.*(Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date)))
      fail(
        400,
        `Row ${i + 2}: purchase date must be ISO 8601 with a timezone, for example 2026-09-18T20:00:00-05:00.`,
      );
    const qty = get(r, 'quantity');
    if (!/^\d+$/.test(qty)) fail(400, `Row ${i + 2}: quantity must be a positive whole number.`);
    const scanned = get(r, 'scanned_count');
    if (scanned && !/^\d+$/.test(scanned))
      fail(400, `Row ${i + 2}: scanned count must be a whole number or blank.`);
    return {
      external_id: get(r, 'external_id'),
      name: get(r, 'name') || [r.first_name, r.last_name].filter(Boolean).join(' '),
      email: get(r, 'email'),
      phone: get(r, 'phone'),
      city: get(r, 'city'),
      quantity: Number(qty),
      subtotal_cents: money(get(r, 'subtotal')),
      refund_cents: money(get(r, 'refund') || '0'),
      purchased_at: new Date(date).toISOString(),
      channel: get(r, 'channel') || 'Unknown',
      tracking_link: get(r, 'tracking_link'),
      scanned_count: scanned ? Number(scanned) : null,
    };
  });
  const clean = rowsSchema.parse(rows),
    seen = new Set();
  for (const r of clean) {
    if (seen.has(r.external_id))
      fail(400, `Duplicate order ID ${r.external_id} inside this file. Use one row per order.`);
    seen.add(r.external_id);
  }
  return clean;
}

export function stageImport(db, input) {
  if (!db.prepare('SELECT id FROM events WHERE id=?').get(input.event_id))
    fail(400, 'Choose an existing event.');
  const rows = parseImport(input.csv),
    batch = id();
  const existing = db
      .prepare("SELECT external_id FROM orders WHERE event_id=? AND source='posh_csv'")
      .all(input.event_id),
    keys = new Set(existing.map((o) => o.external_id));
  db.prepare('INSERT INTO import_batches VALUES(?,?,?,?,?,?,NULL)').run(
    batch,
    input.event_id,
    input.filename,
    JSON.stringify(rows),
    'preview',
    now(),
  );
  return {
    id: batch,
    rows: rows.length,
    newOrders: rows.filter((r) => !keys.has(r.external_id)).length,
    updates: rows.filter((r) => keys.has(r.external_id)).length,
    net_cents: rows.reduce((s, r) => s + r.subtotal_cents - r.refund_cents, 0),
    sample: rows.slice(0, 5),
    warnings: [
      'USD only. One row per order. Transfers must be excluded.',
      'Contact permission remains unknown unless evidence is recorded separately.',
      'Scan counts belong to orders; they do not identify individual attendees.',
      'Re-imports replace these orders with the reviewed values. Use a current export.',
    ],
  };
}
export function commitImport(db, batchId, { inTransaction = false } = {}) {
  const apply = () => {
    const batch = db.prepare('SELECT * FROM import_batches WHERE id=?').get(batchId);
    if (!batch) fail(404, 'Import not found.');
    if (batch.status === 'committed') return { ok: true, alreadyCommitted: true };
    const rows = rowsSchema.parse(JSON.parse(batch.rows_json));
    for (const r of rows) {
      let p = db.prepare('SELECT id FROM people WHERE email=?').get(r.email);
      if (!p) {
        p = { id: id() };
        db.prepare('INSERT INTO people VALUES(?,?,?,?,?,?)').run(
          p.id,
          r.name,
          r.email,
          r.phone,
          r.city,
          now(),
        );
      }
      const old = db
        .prepare(
          "SELECT id,person_id FROM orders WHERE source='posh_csv' AND external_id=? AND event_id=?",
        )
        .get(r.external_id, batch.event_id);
      if (
        old &&
        db.prepare("SELECT 1 FROM source_records WHERE kind='order' AND local_id=?").get(old.id)
      )
        fail(
          409,
          'This order is managed by the collector. Run a fresh collection instead of overwriting it with CSV.',
        );
      if (old && old.person_id !== p.id)
        fail(
          409,
          `Order ${r.external_id} belongs to another profile. Review transfer or identity changes before importing.`,
        );
      db.prepare(
        `INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,external_id,event_id) DO UPDATE SET quantity=excluded.quantity,subtotal_cents=excluded.subtotal_cents,refund_cents=excluded.refund_cents,status=excluded.status,channel=excluded.channel,tracking_link=excluded.tracking_link,purchased_at=excluded.purchased_at,scanned_count=excluded.scanned_count`,
      ).run(
        old?.id || id(),
        'posh_csv',
        r.external_id,
        batch.event_id,
        p.id,
        r.quantity,
        r.subtotal_cents,
        r.refund_cents,
        'USD',
        r.refund_cents === r.subtotal_cents && r.refund_cents > 0
          ? 'refunded'
          : r.subtotal_cents === 0
            ? 'rsvp'
            : 'paid',
        r.channel,
        r.tracking_link,
        r.purchased_at,
        r.scanned_count,
      );
      db.prepare('INSERT INTO interactions VALUES(?,?,?,?,?,?,?)').run(
        id(),
        p.id,
        batch.event_id,
        old ? 'order_updated' : r.subtotal_cents === 0 ? 'rsvp' : 'purchase',
        `${old ? 'Updated' : 'Imported'} order ${r.external_id}`,
        now(),
        'posh_csv',
      );
    }
    db.prepare("UPDATE import_batches SET status='committed',committed_at=? WHERE id=?").run(
      now(),
      batch.id,
    );
    audit(db, 'import.committed', { batch_id: batch.id, rows: rows.length });
    return { ok: true, rows: rows.length };
  };
  return inTransaction ? apply() : transaction(db, apply);
}
