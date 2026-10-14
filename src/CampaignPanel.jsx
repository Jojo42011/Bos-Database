import React, { useEffect, useState } from 'react';
export default function CampaignPanel({ api, workspace }) {
  const [events, setEvents] = useState([]),
    [drafts, setDrafts] = useState([]),
    [detail, setDetail] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    event_id: '',
    channel: 'email',
    subject: '',
    body: '',
    min_score: 30,
    holdout_percent: 10,
  });
  useEffect(() => {
    let active = true;
    Promise.all([api('/events'), api('/campaigns')])
      .then(([e, d]) => {
        if (active) {
          setEvents(e);
          setDrafts(d);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [workspace]);
  const field = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setDetail(await api('/campaigns', { method: 'POST', body: JSON.stringify(form) }));
      setDrafts(await api('/campaigns'));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="collector-page">
      <section className="panel">
        <h2>Campaign drafts</h2>
        <p>
          Build an audience for an upcoming event. Recipients need recorded permission for the
          selected channel. Sending is not connected yet.
        </p>
        {error && <p role="alert">{error}</p>}
        <form onSubmit={create} className="campaign-form">
          <label className="field">
            Event
            <select
              required
              value={form.event_id}
              onChange={(e) => field('event_id', e.target.value)}
            >
              <option value="">Choose event</option>
              {events
                .filter((e) => e.status === 'upcoming' && Date.parse(e.starts_at) > Date.now())
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Channel
            <select value={form.channel} onChange={(e) => field('channel', e.target.value)}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </label>
          <label className="field">
            Subject
            <input value={form.subject} onChange={(e) => field('subject', e.target.value)} />
          </label>
          <label className="field">
            Message
            <textarea
              required
              rows={4}
              value={form.body}
              onChange={(e) => field('body', e.target.value)}
            />
          </label>
          <label className="field">
            Minimum relevance score
            <input
              type="number"
              min="0"
              max="100"
              value={form.min_score}
              onChange={(e) => field('min_score', Number(e.target.value))}
            />
          </label>
          <label className="field">
            Holdout percentage
            <input
              type="number"
              min="0"
              max="30"
              value={form.holdout_percent}
              onChange={(e) => field('holdout_percent', Number(e.target.value))}
            />
          </label>
          <button className="button primary" disabled={busy || workspace === 'demo'}>
            Create draft
          </button>
        </form>
      </section>
      <section className="panel">
        <h3>Saved drafts</h3>
        {!drafts.length && <p>No drafts yet.</p>}
        {drafts.map((d) => (
          <button
            className="button"
            key={d.id}
            onClick={async () => {
              try {
                setDetail(await api('/campaigns/' + d.id));
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            {d.event_name} · {d.channel} · {d.recipients} recipients
          </button>
        ))}
      </section>
      {detail && (
        <section className="panel">
          <h3>Audience review</h3>
          <p>
            {detail.eligible} eligible · {detail.holdout} held out for measurement
          </p>
          <p>{detail.sending_note}</p>
          {detail.recipients.map((p) => (
            <article className="collector-run" key={p.person_id}>
              <div>
                <strong>{p.name}</strong>
                <p>{p.reasons.join(' · ')}</p>
              </div>
              <span>
                {p.score} / 100 · {p.excluded_reason || 'Eligible'}
              </span>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
