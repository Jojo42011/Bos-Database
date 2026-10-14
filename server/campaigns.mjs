import { z } from 'zod';
import { createHash } from 'node:crypto';
import { id, now, transaction, audit } from './db.mjs';
import { rankAudience, MODEL_VERSION } from './recommendations.mjs';
const draftSchema = z.object({
  event_id: z.string().min(1),
  channel: z.enum(['email', 'sms']),
  subject: z.string().trim().max(200).default(''),
  body: z.string().trim().min(1).max(10000),
  min_score: z.number().min(0).max(100).default(30),
  holdout_percent: z.number().int().min(0).max(30).default(10),
});
export function createDraft(db, raw) {
  const input = draftSchema.parse(raw),
    ranked = rankAudience(db, input.event_id);
  if (ranked.event.status !== 'upcoming' || Date.parse(ranked.event.starts_at) <= Date.now())
    throw new Error('Choose an upcoming event.');
  return transaction(db, () => {
    const cid = id();
    db.prepare('INSERT INTO campaign_drafts VALUES(?,?,?,?,?,?,?,?)').run(
      cid,
      input.event_id,
      input.channel,
      'draft',
      input.subject,
      input.body,
      now(),
      MODEL_VERSION,
    );
    for (const p of ranked.people) {
      if (p.score < input.min_score || !p[`${input.channel}_eligible`]) continue;
      const bucket =
        createHash('sha256')
          .update(cid + ':' + p.id)
          .digest()
          .readUInt32BE(0) % 100;
      db.prepare('INSERT INTO campaign_recipients VALUES(?,?,?,?,?,?)').run(
        cid,
        p.id,
        p.score,
        JSON.stringify(p.reasons),
        bucket < input.holdout_percent ? 1 : 0,
        'draft',
      );
    }
    audit(db, 'campaign.drafted', { campaign_id: cid });
    return draftDetail(db, cid);
  });
}
export function draftDetail(db, cid) {
  const d = db.prepare('SELECT * FROM campaign_drafts WHERE id=?').get(cid);
  if (!d) throw new Error('Campaign not found.');
  const ranked = rankAudience(db, d.event_id),
    eligible = new Map(ranked.people.map((p) => [p.id, p]));
  const recipients = db
    .prepare(
      'SELECT r.*,p.name,p.email FROM campaign_recipients r JOIN people p ON p.id=r.person_id WHERE campaign_id=? ORDER BY score DESC',
    )
    .all(cid)
    .map((r) => {
      const p = eligible.get(r.person_id);
      const recent = db
        .prepare(
          "SELECT COUNT(*) n FROM message_events WHERE person_id=? AND kind='sent' AND occurred_at>?",
        )
        .get(r.person_id, new Date(Date.now() - 7 * 86400000).toISOString()).n;
      const reason = !p
        ? 'Already registered'
        : !p[`${d.channel}_eligible`]
          ? 'Channel permission or contact unavailable'
          : recent >= 2
            ? 'Weekly contact limit reached'
            : r.holdout
              ? 'Holdout group'
              : null;
      return {
        ...r,
        reasons: JSON.parse(r.reasons_json),
        reasons_json: undefined,
        eligible: !reason,
        excluded_reason: reason,
      };
    });
  const sync = db.prepare('SELECT last_success_at FROM collector_config WHERE id=1').get();
  return {
    ...d,
    recipients,
    eligible: recipients.filter((r) => r.eligible).length,
    holdout: recipients.filter((r) => r.holdout).length,
    last_sync_at: sync?.last_success_at || null,
    sending_enabled: false,
    sending_note:
      'Draft only. Sending requires a provider integration, fresh registration sync, and owner approval.',
  };
}
export function mountCampaignRoutes(app) {
  app.get('/api/campaigns', (req, res) =>
    res.json(
      req.db
        .prepare(
          'SELECT c.*,e.name AS event_name,(SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id=c.id) AS recipients FROM campaign_drafts c JOIN events e ON e.id=c.event_id ORDER BY created_at DESC',
        )
        .all(),
    ),
  );
  app.get('/api/campaigns/:id', (req, res, next) => {
    try {
      res.json(draftDetail(req.db, req.params.id));
    } catch (e) {
      e.status = 400;
      next(e);
    }
  });
  app.post('/api/campaigns', (req, res, next) => {
    try {
      res.status(201).json(createDraft(req.db, req.body));
    } catch (e) {
      e.status = 400;
      next(e);
    }
  });
}
