import React, { useEffect, useState, useCallback } from 'react';
import {
  Globe2,
  Play,
  Plus,
  ShieldCheck,
  Clock3,
  RefreshCw,
  X,
  ArrowDown,
  ArrowUp,
  LockKeyhole,
  Download,
  Check,
  Settings2,
  LoaderCircle,
} from 'lucide-react';
import './browser.css';

const money = (c) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((c || 0) / 100);
const pretty = (s) => s?.replaceAll('_', ' ') || '—';
const stamp = (s) => (s ? new Date(s).toLocaleString() : 'Not yet');
const defaults = {
  event_id: '',
  url: 'https://posh.vip/',
  ready_selector: 'text=Orders',
  steps: [
    { action: 'click', selector: 'text=Settings' },
    { action: 'click', selector: 'text=Export event report' },
  ],
  download_selector: 'button:has-text("Export")',
  enabled: false,
  interval_minutes: 1440,
  auto_import: false,
};
const Button = ({ children, primary = false, ...props }) => (
  <button className={`button ${primary ? 'primary' : ''}`} {...props}>
    {children}
  </button>
);
const Field = ({ label, children, ...props }) => (
  <label className="field">
    <span>{label}</span>
    {children || <input {...props} />}
  </label>
);
export default function BrowserPanel({ api, workspace, onConnect }) {
  const [state, setState] = useState(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [frame, setFrame] = useState(null),
    [url, setUrl] = useState('https://posh.vip/'),
    [text, setText] = useState(''),
    [editor, setEditor] = useState(null),
    [events, setEvents] = useState([]),
    [preview, setPreview] = useState(null),
    [credentials, setCredentials] = useState(false);
  const reload = useCallback(async () => {
    if (workspace === 'demo') return;
    const d = await api('/browser');
    setState(d);
  }, [api, workspace]);
  useEffect(() => {
    if (workspace === 'demo') return;
    let active = true;
    const poll = async () => {
      try {
        const d = await api('/browser');
        if (active) setState(d);
      } catch (e) {
        if (active) setError(e.message);
      }
    };
    poll();
    api('/events')
      .then((d) => active && setEvents(d))
      .catch((e) => active && setError(e.message));
    const t = setInterval(poll, 4000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [workspace, api]);
  useEffect(() => {
    if (state?.mode !== 'interactive') {
      setFrame(null);
      return;
    }
    let active = true,
      running = false;
    const poll = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const f = await api('/browser/frame');
        if (active) setFrame(f);
      } catch {
      } finally {
        running = false;
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [state?.mode, api]);
  const action = async (path, body = {}, success = '') => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api(`/browser${path}`, { method: 'POST', body: JSON.stringify(body) });
      await reload();
      if (success) setMessage(success);
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">YOUR ALWAYS-READY OPERATOR</span>
          <h1>Let the night flow.</h1>
          <p>A browser, a saved session, and a clear path from POSH to your audience.</p>
        </div>
        <div className="title-actions">
          <Button onClick={() => (workspace === 'demo' ? onConnect() : setEditor({ ...defaults }))}>
            <Plus size={15} /> Add event sync
          </Button>
        </div>
      </div>
      <div className="browser-intro">
        <div className="browser-engine">
          <Globe2 size={22} />
          <div>
            <strong>Playwright browser worker</strong>
            <span>Open source · no AI API key · runs inside this app</span>
          </div>
        </div>
        <span className="badge blue">{workspace === 'demo' ? 'Preview' : pretty(state?.mode)}</span>
      </div>
      {workspace === 'demo' ? (
        <section className="panel browser-onboarding">
          <Globe2 size={32} />
          <h2>Your browser works here.</h2>
          <p>
            Connect your private workspace to log into POSH, save its session, and schedule event
            report imports. No separate app or browser subscription.
          </p>
          <Button primary onClick={onConnect}>
            Set up your workspace
          </Button>
        </section>
      ) : (
        <>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="browser-success" role="status">
              <Check size={14} />
              {message}
            </div>
          )}
          <section className="panel browser-connect">
            <div>
              <span className="eyebrow">01 · CONNECT</span>
              <h2>Your private POSH session</h2>
              <p>
                Open the browser below to sign in and complete verification. Close it when finished;
                the login profile stays on this server.
              </p>
            </div>
            <div className="browser-url">
              <Field label="POSH page">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://posh.vip/"
                />
              </Field>
              <Button
                primary
                disabled={busy || state?.mode === 'syncing'}
                onClick={() => action('/open', { url })}
              >
                <Globe2 size={14} />
                {state?.mode === 'interactive' ? 'Navigate' : 'Open browser'}
              </Button>
              {state?.mode === 'interactive' && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    action('/close', {}, 'Browser closed. Session saved; queued syncs can now run.')
                  }
                >
                  <X size={14} /> Close & save
                </Button>
              )}
            </div>
            {state?.mode === 'interactive' && (
              <div className="remote-browser">
                <div className="remote-toolbar">
                  <span className="live-indicator">
                    <i /> Interactive session
                  </span>
                  <code>{frame?.url || 'Loading…'}</code>
                  <button className="text-button" onClick={() => setCredentials((v) => !v)}>
                    <LockKeyhole size={12} /> Saved login
                  </button>
                </div>
                <div className="remote-viewport">
                  {frame?.image ? (
                    <img
                      src={frame.image}
                      alt="Interactive remote POSH browser. Click a field then use the input controls below."
                      draggable={false}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        if (!busy)
                          action('/action', {
                            type: 'click',
                            x: Math.min(1279, ((e.clientX - rect.left) / rect.width) * 1280),
                            y: Math.min(799, ((e.clientY - rect.top) / rect.height) * 800),
                          });
                      }}
                    />
                  ) : (
                    <div className="loading">
                      <LoaderCircle className="spin" /> Opening your browser…
                    </div>
                  )}
                </div>
                <div className="remote-input">
                  <input
                    aria-label="Text for selected browser field"
                    type="password"
                    autoComplete="off"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Text or verification code for the selected field"
                  />
                  <Button
                    disabled={busy || !text}
                    onClick={async () => {
                      if (await action('/action', { type: 'text', text })) setText('');
                    }}
                  >
                    Type into field
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => action('/action', { type: 'key', key: 'Enter' })}
                  >
                    Enter
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => action('/action', { type: 'key', key: 'Tab' })}
                  >
                    Tab
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => action('/action', { type: 'key', key: 'ControlOrMeta+A' })}
                  >
                    Select all
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => action('/action', { type: 'key', key: 'Backspace' })}
                  >
                    Delete
                  </Button>
                  <Button
                    aria-label="Scroll browser up"
                    disabled={busy}
                    onClick={() => action('/action', { type: 'scroll', delta: -550 })}
                  >
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    aria-label="Scroll browser down"
                    disabled={busy}
                    onClick={() => action('/action', { type: 'scroll', delta: 550 })}
                  >
                    <ArrowDown size={14} />
                  </Button>
                </div>
                <p className="form-note">
                  Click the page to focus a control, then type or press a key here. The browser view
                  is private to the signed-in workspace owner. Close the browser to release it for
                  scheduled jobs.
                </p>
              </div>
            )}
            {credentials && state?.mode === 'interactive' && (
              <div className="credential-panel">
                <h3>Saved login</h3>
                <p>
                  Optional. Session reuse works without saving a password. Credentials are encrypted
                  using your server’s vault key and only filled on the exact origin you specify.
                  Scheduled runs can submit this login once if the session expires. Verification
                  challenges still need you.
                </p>
                {!state.vault.available ? (
                  <p className="form-note">
                    Set BROWSER_VAULT_KEY before saving credentials. Manual sign-in is available
                    now.
                  </p>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const data = Object.fromEntries(new FormData(e.currentTarget));
                      const form = e.currentTarget;
                      if (await action('/credentials', data, 'Credentials saved securely.'))
                        form.reset();
                    }}
                  >
                    <div className="form-grid">
                      <Field
                        label="Login origin"
                        name="origin"
                        defaultValue="https://posh.vip"
                        required
                      />
                      <Field
                        label="Username or email"
                        name="username"
                        autoComplete="off"
                        required
                      />
                    </div>
                    <Field
                      label="Password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      required
                    />
                    <div className="form-grid">
                      <Field
                        label="Username field selector"
                        name="username_selector"
                        defaultValue='input[type="email"]'
                        required
                      />
                      <Field
                        label="Password field selector"
                        name="password_selector"
                        defaultValue='input[type="password"]'
                        required
                      />
                    </div>
                    <Button disabled={busy} type="submit">
                      Save credentials
                    </Button>
                  </form>
                )}
                {state.vault.saved && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      action(
                        '/credentials/fill',
                        {},
                        'Filled the login fields. Submit in the browser to continue.',
                      )
                    }
                  >
                    Fill saved credentials
                  </Button>
                )}
              </div>
            )}
          </section>
          <div className="section-heading">
            <div>
              <span className="eyebrow">02 · KEEP IT MOVING</span>
              <h2>Event syncs</h2>
            </div>
            <span className="muted small-text">One browser · one run at a time</span>
          </div>
          {state?.sources.length ? (
            <div className="sync-grid">
              {state.sources.map((s) => (
                <section className="panel sync-card" key={s.id}>
                  <div className="sync-card-title">
                    <h3>{s.event_name}</h3>
                    <span className={`badge ${s.enabled ? 'green' : ''}`}>
                      {s.enabled ? 'Scheduled' : 'Manual'}
                    </span>
                  </div>
                  <p>{s.url}</p>
                  <div className="sync-meta">
                    <span>
                      <Clock3 size={13} />
                      {s.enabled ? `Every ${s.interval_minutes} minutes` : 'Run when you need it'}
                    </span>
                    <span>
                      <ShieldCheck size={13} />
                      {s.auto_import ? 'Automatic import' : 'Review before import'}
                    </span>
                  </div>
                  <small>Last run: {stamp(s.last_run_at)}</small>
                  <small>Next run: {s.enabled ? stamp(s.next_run_at) : 'Schedule off'}</small>
                  <div className="sync-card-actions">
                    <Button
                      primary
                      disabled={busy}
                      onClick={() =>
                        action(
                          `/sources/${s.id}/run`,
                          {},
                          'Sync queued. Close any interactive session so the worker can run it.',
                        )
                      }
                    >
                      <Play size={13} /> Sync now
                    </Button>
                    <Button onClick={() => setEditor(s)}>
                      <Settings2 size={13} /> Configure
                    </Button>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <section className="panel">
              <div className="empty">
                <Download size={28} />
                <h3>Connect your first event</h3>
                <p>
                  Link an existing Crowd Control event to its POSH report page. Test the export
                  recipe before enabling a schedule.
                </p>
                <div className="empty-action">
                  <Button onClick={() => setEditor({ ...defaults })}>
                    <Plus size={14} /> Add event sync
                  </Button>
                </div>
              </div>
            </section>
          )}
          <section className="panel browser-runs">
            <div className="panel-heading">
              <div>
                <h2>Every run, accounted for.</h2>
                <p>Downloads, validation, review, and database updates in one place.</p>
              </div>
              <button
                className="text-button"
                onClick={() => reload().catch((e) => setError(e.message))}
              >
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
            {state?.jobs.length ? (
              <div className="run-list">
                {state.jobs.map((j) => (
                  <div className="run-row" key={j.id}>
                    <div>
                      <strong>
                        {state.sources.find((s) => s.id === j.source_id)?.event_name ||
                          'Event sync'}
                      </strong>
                      <small>
                        {stamp(j.created_at)} · {j.trigger}
                      </small>
                      {j.error && <p className="run-error">{j.error}</p>}
                      {j.summary && (
                        <p>
                          {j.summary.message ||
                            `${j.summary.rows} orders · ${j.summary.newOrders} new · ${j.summary.updates} updates · ${money(j.summary.net_cents)} net`}
                        </p>
                      )}
                    </div>
                    <span
                      className={`badge ${j.status === 'imported' || j.status === 'unchanged' ? 'green' : j.status === 'review' ? 'amber' : ''}`}
                    >
                      {pretty(j.status)}
                    </span>
                    <div className="run-buttons">
                      {j.status === 'review' && (
                        <Button
                          onClick={async () => {
                            try {
                              setPreview(await api(`/browser/jobs/${j.id}`));
                            } catch (e) {
                              setError(e.message);
                            }
                          }}
                        >
                          Review
                        </Button>
                      )}
                      {['queued', 'review'].includes(j.status) && (
                        <button
                          className="text-button"
                          onClick={() => action(`/jobs/${j.id}/dismiss`)}
                        >
                          Dismiss
                        </button>
                      )}
                      {['failed', 'needs_login', 'interrupted'].includes(j.status) && (
                        <button
                          className="text-button"
                          onClick={() => action(`/sources/${j.source_id}/run`, {}, 'Retry queued.')}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">
                <Clock3 size={24} />
                <h3>No syncs yet</h3>
                <p>Run history appears here after your first export.</p>
              </div>
            )}
          </section>
        </>
      )}
      {editor && (
        <SourceEditor
          source={editor}
          events={events}
          onClose={() => setEditor(null)}
          onSave={async (data) => {
            await api(editor.id ? `/browser/sources/${editor.id}` : '/browser/sources', {
              method: 'POST',
              body: JSON.stringify(data),
            });
            await reload();
            setMessage('Event sync saved.');
            setEditor(null);
          }}
        />
      )}
      {preview && (
        <div className="modal-shade">
          <section
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-label="Review browser import"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">REVIEW THE REPORT</span>
                <h2>Ready to bring these people home?</h2>
                <p>
                  {preview.summary.rows} orders · {money(preview.summary.net_cents)} net sales in
                  this file
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close review"
                onClick={() => setPreview(null)}
              >
                <X />
              </button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>BUYER</th>
                    <th>ORDER</th>
                    <th>NET SALES</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((r) => (
                    <tr key={r.external_id}>
                      <td>
                        {r.name}
                        <small className="block muted">{r.email}</small>
                      </td>
                      <td>{r.external_id}</td>
                      <td>{money(r.subtotal_cents - r.refund_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="form-note">
              <ShieldCheck size={14} /> Check totals against POSH. This will update matching orders;
              contact consent stays unchanged. A successful reviewed import unlocks automatic
              imports for this exact recipe.
            </p>
            <div className="modal-footer">
              <Button onClick={() => setPreview(null)}>Cancel</Button>
              <Button
                primary
                disabled={busy}
                onClick={async () => {
                  if (
                    await action(
                      `/jobs/${preview.job.id}/approve`,
                      {},
                      'Report imported. Audience and sales are updated.',
                    )
                  )
                    setPreview(null);
                }}
              >
                Approve & import
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function SourceEditor({ source, events, onClose, onSave }) {
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  return (
    <div className="modal-shade">
      <section
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Configure event sync"
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">POSH EXPORT RECIPE</span>
            <h2>A reliable route to your data.</h2>
            <p>The starter selectors need checking against your actual POSH organizer page.</p>
          </div>
          <button className="icon-button" aria-label="Close configuration" onClick={onClose}>
            <X />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            const f = new FormData(e.currentTarget);
            try {
              const steps = JSON.parse(f.get('steps'));
              setSaving(true);
              await onSave({
                event_id: f.get('event_id'),
                url: f.get('url'),
                ready_selector: f.get('ready_selector'),
                download_selector: f.get('download_selector'),
                steps,
                enabled: f.has('enabled'),
                interval_minutes: Number(f.get('interval_minutes')),
                auto_import: f.has('auto_import'),
              });
            } catch (e) {
              setError(e.message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {error && <div className="error">{error}</div>}
          <Field label="Crowd Control event">
            <select name="event_id" defaultValue={source.event_id} required>
              <option value="">Select event</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.city}
                </option>
              ))}
            </select>
          </Field>
          {!events.length && (
            <p className="form-note">Create an event in the Events section first.</p>
          )}
          <Field
            label="POSH organizer report page URL"
            name="url"
            type="url"
            defaultValue={source.url}
            required
          />
          <Field
            label="Signed-in page selector"
            name="ready_selector"
            defaultValue={source.ready_selector}
            required
          />
          <p className="field-help">
            An element visible only after login, such as a unique organizer navigation control.
            Missing it pauses the run for sign-in.
          </p>
          <Field label="Steps before download (JSON)">
            <textarea
              name="steps"
              rows={7}
              defaultValue={JSON.stringify(source.steps, null, 2)}
              required
              spellCheck={false}
            />
          </Field>
          <p className="field-help">
            Supported actions: click, check, select. Each needs a Playwright selector; select also
            needs a value. No scripts or credentials in recipes.
          </p>
          <Field
            label="Final download button selector"
            name="download_selector"
            defaultValue={source.download_selector}
            required
          />
          <div className="schedule-options">
            <label>
              <input type="checkbox" name="enabled" defaultChecked={source.enabled} /> Enable
              scheduled sync
            </label>
            <Field
              label="Interval in minutes"
              name="interval_minutes"
              type="number"
              min="30"
              max="10080"
              defaultValue={source.interval_minutes}
            />
            <label>
              <input
                type="checkbox"
                name="auto_import"
                defaultChecked={source.auto_import}
                disabled={!source.verified}
              />{' '}
              Automatically import validated reports
            </label>
            <small>
              {source.verified
                ? 'This recipe has a reviewed successful import.'
                : 'Unlocked after a successful reviewed import. Changes to the recipe require a new review.'}
            </small>
          </div>
          <div className="modal-footer">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button primary disabled={saving || !events.length}>
              {saving ? 'Saving…' : 'Save event sync'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
