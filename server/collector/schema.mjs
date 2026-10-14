import { z } from 'zod';
import { createHash } from 'node:crypto';
const key = z.string().trim().min(1).max(200);
const date = z.string().datetime({ offset: true });
const amount = z.number().int().min(0).max(100000000);
export const eventSchema = z.object({
  external_id: key,
  name: key,
  starts_at: date,
  timezone: z
    .string()
    .default('America/Chicago')
    .refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
  city: z.string().max(200).default(''),
  venue: z.string().max(200).default(''),
  concept: z.string().max(200).default(''),
  genre: z.string().max(200).default(''),
  description: z.string().max(20000).default(''),
  tags: z.array(key).max(40).default([]),
  artists: z.array(key).max(40).default([]),
  format: z.string().max(100).default(''),
  capacity: z.number().int().min(1).max(1000000),
  price_cents: amount,
  status: z.enum(['upcoming', 'completed', 'cancelled']),
  updated_at: date.optional(),
});
export const orderSchema = z
  .object({
    external_id: key,
    event_external_id: key,
    customer_external_id: key.optional(),
    name: key,
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    phone: z.string().max(40).default(''),
    city: z.string().max(100).default(''),
    quantity: z.number().int().min(1).max(10000),
    subtotal_cents: amount,
    refund_cents: amount,
    currency: z.literal('USD'),
    purchased_at: date,
    updated_at: date.optional(),
    status: z.enum(['paid', 'rsvp', 'refunded', 'cancelled', 'pending', 'denied', 'transferred']),
    channel: z.string().max(200).default('Unknown'),
    tracking_link: z.string().max(200).default(''),
    scanned_count: z.number().int().min(0).nullable().default(null),
  })
  .superRefine((r, c) => {
    if (r.refund_cents > r.subtotal_cents)
      c.addIssue({ code: 'custom', message: 'Refund exceeds subtotal' });
    if (r.scanned_count !== null && r.scanned_count > r.quantity)
      c.addIssue({ code: 'custom', message: 'Scans exceed quantity' });
    if (r.status === 'refunded' && r.refund_cents !== r.subtotal_cents)
      c.addIssue({ code: 'custom', message: 'Fully refunded status requires full refund amount' });
    if (r.status === 'paid' && r.subtotal_cents === 0)
      c.addIssue({ code: 'custom', message: 'Free registrations must be mapped as rsvp' });
  });
const fieldPath = z
  .string()
  .min(1)
  .max(300)
  .regex(/^(?:\$|[a-zA-Z0-9_.-]+)$/);
const mapping = z.record(fieldPath).refine((v) => Object.keys(v).length <= 40);
const pageSchema = z.object({
  url: z.string().url().max(1500),
  response_url: z.string().url().max(1500),
  ready_selector: z.string().min(1).max(500),
  login_selector: z.string().min(1).max(500),
  items_path: fieldPath,
  total_path: fieldPath,
  next_selector: z.string().max(500).default(''),
  max_pages: z.number().int().min(1).max(500).default(100),
  fields: mapping,
  status_map: z.record(z.string().max(40)).default({}),
});
export const configSchema = z.object({
  organization: key,
  events: z.array(pageSchema).min(1).max(5),
  orders: pageSchema,
  event_links: z.record(key).default({}),
  enabled: z.boolean().default(false),
  auto_import: z.boolean().default(false),
  interval_minutes: z.number().int().min(30).max(10080).default(1440),
});
export const fingerprint = (c) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        organization: c.organization,
        events: c.events,
        orders: c.orders,
        event_links: c.event_links,
      }),
    )
    .digest('hex');
export function at(value, path) {
  if (path === '$') return value;
  return path
    .split('.')
    .reduce((v, k) => (v != null && Object.hasOwn(v, k) ? v[k] : undefined), value);
}
export function mapRecord(raw, spec, eventId) {
  const mapped = Object.fromEntries(
    Object.entries(spec.fields)
      .map(([k, p]) => [k, at(raw, p)])
      .filter(([, v]) => v !== undefined),
  );
  if (mapped.external_id != null) mapped.external_id = String(mapped.external_id);
  if (mapped.customer_external_id != null)
    mapped.customer_external_id = String(mapped.customer_external_id);
  if (eventId) mapped.event_external_id = eventId;
  if (mapped.status !== undefined && Object.hasOwn(spec.status_map, String(mapped.status)))
    mapped.status = spec.status_map[String(mapped.status)];
  return (eventId ? orderSchema : eventSchema).parse(mapped);
}
export function safeRaw(value, depth = 0) {
  if (depth > 12) return '[depth limit]';
  if (Array.isArray(value)) return value.map((v) => safeRaw(v, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !/password|secret|token|cookie|authorization|session/i.test(k))
        .map(([k, v]) => [k, safeRaw(v, depth + 1)]),
    );
  return value;
}
