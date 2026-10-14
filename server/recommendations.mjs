import { people, events } from './db.mjs';
export const MODEL_VERSION = 'affinity-v2';
const norm = (v) =>
  String(v || '')
    .trim()
    .toLowerCase();
const day = 86400000;
const overlap = (a, b) =>
  a.length && b.length ? a.filter((x) => b.includes(x)).length / Math.max(a.length, b.length) : 0;
function details(db) {
  return new Map(
    db
      .prepare('SELECT * FROM event_details')
      .all()
      .map((x) => [
        x.event_id,
        {
          ...x,
          tags: JSON.parse(x.tags_json).map(norm),
          artists: JSON.parse(x.artists_json).map(norm),
        },
      ]),
  );
}
export function rankAudience(db, eventId, { at = Date.now() } = {}) {
  const catalog = events(db),
    event = catalog.find((x) => x.id === eventId);
  if (!event) {
    const e = new Error('Event not found');
    e.status = 404;
    throw e;
  }
  const meta = details(db),
    target = meta.get(eventId) || { tags: [], artists: [], format: '' };
  const orders = db.prepare('SELECT * FROM orders').all();
  const registered = new Set(
    orders
      .filter((o) => o.event_id === eventId && ['paid', 'rsvp', 'pending'].includes(o.status))
      .map((o) => o.person_id),
  );
  const historical = new Map(
    catalog
      .filter((e) => Date.parse(e.starts_at) < at && e.status !== 'cancelled')
      .map((e) => [e.id, e]),
  );
  const history = new Map();
  for (const o of orders) {
    if (
      o.status !== 'paid' ||
      o.subtotal_cents <= o.refund_cents ||
      Date.parse(o.purchased_at) > at ||
      !historical.has(o.event_id)
    )
      continue;
    if (!history.has(o.person_id)) history.set(o.person_id, new Map());
    const h = history.get(o.person_id),
      previous = h.get(o.event_id);
    // One signal per distinct event, independent of ticket quantity/order count.
    if (!previous || o.purchased_at < previous.purchased_at) h.set(o.event_id, o);
  }
  const ranked = people(db)
    .filter((p) => !registered.has(p.id))
    .map((p) => {
      const purchases = [...(history.get(p.id)?.values() || [])],
        reasons = [];
      let content = 0,
        series = 0,
        location = norm(p.city) && norm(p.city) === norm(event.city) ? 1 : 0,
        recency = 0;
      for (const o of purchases) {
        const e = historical.get(o.event_id),
          m = meta.get(e.id) || { tags: [], artists: [], format: '' };
        const decay = Math.pow(0.5, Math.max(0, at - Date.parse(e.starts_at)) / (180 * day));
        const genre = norm(e.genre) && norm(e.genre) === norm(event.genre) ? 1 : 0;
        const match = Math.min(
          1,
          0.6 * genre +
            0.2 * overlap(m.tags, target.tags) +
            0.15 * overlap(m.artists, target.artists) +
            0.05 * (norm(m.format) && norm(m.format) === norm(target.format) ? 1 : 0),
        );
        content = Math.max(content, match * decay);
        if (norm(e.concept) && norm(e.concept) === norm(event.concept))
          series = Math.max(series, decay);
        if (norm(e.city) && norm(e.city) === norm(event.city))
          location = Math.max(location, decay * 0.8);
        recency = Math.max(recency, decay);
      }
      if (content > 0) reasons.push('Purchased events with similar music, artists, or format');
      if (series > 0) reasons.push('Previously bought this event series');
      if (location > 0)
        reasons.push(
          norm(p.city) === norm(event.city)
            ? 'Recorded home city matches'
            : 'Previously bought events in this city',
        );
      if (purchases.length > 1) reasons.push(`${purchases.length} distinct past paid events`);
      const activity = recency * Math.min(purchases.length / 3, 1);
      const score = Math.round(40 * content + 25 * series + 20 * location + 15 * activity);
      const leads = purchases
        .map((o) =>
          Math.max(
            0,
            (Date.parse(historical.get(o.event_id).starts_at) - Date.parse(o.purchased_at)) / day,
          ),
        )
        .sort((a, b) => a - b);
      const median = leads.length >= 3 ? Math.round(leads[Math.floor(leads.length / 2)]) : null;
      return {
        ...p,
        score,
        reasons,
        tier: score >= 65 ? 'A' : score >= 30 ? 'B' : 'C',
        confidence: purchases.length >= 5 ? 'high' : purchases.length >= 2 ? 'moderate' : 'low',
        evidence_events: purchases.length,
        typical_lead_days: median,
        attendance: 'Not inferred from order-level scans',
        email_eligible: p.email_status === 'opted_in',
        sms_eligible: p.sms_status === 'opted_in' && /^\+[1-9]\d{7,14}$/.test(p.phone),
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    event,
    suppressed: registered.size,
    people: ranked,
    email: ranked.filter((p) => p.score >= 30 && p.email_eligible).length,
    sms: ranked.filter((p) => p.score >= 65 && p.sms_eligible).length,
    version: MODEL_VERSION,
    note: 'Relevance scores are not probabilities. Confidence reflects distinct past purchases. No messages are sent.',
  };
}
