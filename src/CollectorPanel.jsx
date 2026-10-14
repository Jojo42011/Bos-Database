import React, { useEffect, useState } from 'react';
import './browser.css';
export default function CollectorPanel({ api, workspace, onConnect }) {
  const [state, setState] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [config, setConfig] = useState(''),
    [preview, setPreview] = useState(null);
  async function refresh() {
    const s = await api('/collector');
    setState(s);
    return s;
  }
  useEffect(() => {
    if (workspace === 'demo') return;
    let active = true;
    const load = () =>
      api('/collector')
        .then((s) => {
          if (active) setState(s);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    load();
    const t = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [workspace]);
  async function action(path, body) {
    setBusy(true);
    setError('');
    try {
      await api('/collector' + path, { method: 'POST', body: JSON.stringify(body || {}) });
      await refresh();
      setPreview(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (workspace === 'demo')
    return (
      <section className="panel">
        <h2>POSH collector</h2>
        <p>Connect your live workspace to configure daily event and order collection.</p>
        <button className="button primary" onClick={onConnect}>
          Connect workspace
        </button>
      </section>
    );
  return (
    <div className="collector-page">
      <section className="panel">
        <h2>POSH collector</h2>
        <p>Backfill your event history, then keep events and orders current each day.</p>
        <p>
          First, sign in using Browser worker and close its browser. A verified source mapping is
          required before unattended imports.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="collector-stats">
          <span>
            Mapping: <strong>{state?.readiness?.replaceAll('_', ' ') || 'Loading'}</strong>
          </span>
          <span>
            Last import:{' '}
            <strong>
              {state?.configuration?.last_success_at
                ? new Date(state.configuration.last_success_at).toLocaleString()
                : 'Never'}
            </strong>
          </span>
          <span>
            Schedule:{' '}
            <strong>
              {state?.configuration?.config.enabled
                ? `Every ${state.configuration.config.interval_minutes / 60} hours`
                : 'Off'}
            </strong>
          </span>
        </div>
        <button
          className="button primary"
          disabled={busy || !state?.configuration}
          onClick={() => action('/run')}
        >
          Collect now
        </button>
        {state?.progress && <p role="status">{JSON.stringify(state.progress)}</p>}
        <details
          onToggle={(e) => {
            if (e.currentTarget.open && !config)
              setConfig(JSON.stringify(state?.configuration?.config || {}, null, 2));
          }}
        >
          <summary>Source mapping and schedule</summary>
          <p>
            Developer setup: enter the reviewed mapping from the signed-in POSH response. See
            docs/collector.md. Do not put passwords or session tokens here.
          </p>
          <textarea
            aria-label="Collector configuration"
            value={config}
            onChange={(e) => setConfig(e.target.value)}
            rows={18}
            style={{ width: '100%', fontFamily: 'monospace' }}
          />
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              try {
                action('/config', JSON.parse(config));
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Save configuration
          </button>
        </details>
      </section>
      <section className="panel">
        <h3>Collection history</h3>
        <p>
          Incomplete runs never change customer data. Review the first complete run before enabling
          automatic imports.
        </p>
        {!state?.runs?.length && <p>No collections yet.</p>}
        {state?.runs?.map((r) => (
          <article key={r.id} className="collector-run">
            <div>
              <strong>{r.status.replaceAll('_', ' ')}</strong> ·{' '}
              {new Date(r.started_at).toLocaleString()}
              <p>
                {r.summary
                  ? `${r.summary.events} events · ${r.summary.orders} orders`
                  : r.error || 'Waiting for the browser'}
              </p>
            </div>
            {r.status === 'review' && (
              <button
                className="button"
                onClick={async () => {
                  try {
                    setPreview(await api('/collector/runs/' + r.id));
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Review
              </button>
            )}
            {['queued', 'review'].includes(r.status) && (
              <button
                className="button"
                disabled={busy}
                onClick={() => action('/runs/' + r.id + '/dismiss')}
              >
                Dismiss
              </button>
            )}
          </article>
        ))}
      </section>
      {preview && (
        <section className="panel">
          <h3>Review collection</h3>
          <p>
            {preview.summary.events} events · {preview.summary.orders} orders. Sample below shows up
            to ten of each. Check IDs, dates, amounts, status, and buyer identity before importing.
          </p>
          <pre style={{ overflow: 'auto', maxHeight: 400 }}>
            {JSON.stringify({ events: preview.events, orders: preview.orders }, null, 2)}
          </pre>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => action('/runs/' + preview.id + '/approve')}
          >
            Import complete collection
          </button>
          <button className="button" onClick={() => setPreview(null)}>
            Close review
          </button>
        </section>
      )}
    </div>
  );
}
