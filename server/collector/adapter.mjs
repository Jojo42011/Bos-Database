import { at, mapRecord, safeRaw } from './schema.mjs';
const MAX_BYTES = 4_000_000;
function problem(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
const substitute = (s, id) => s.replaceAll('{event_id}', encodeURIComponent(id));

// Uses responses from actual browser navigation, not guessed private API endpoints.
// The page recipes are configured after observing the signed-in organizer dashboard.
export async function collectPages(
  page,
  spec,
  policy,
  { eventId, signal, onProgress = () => {} } = {},
) {
  const url = eventId ? substitute(spec.url, eventId) : spec.url;
  const responseUrl = eventId ? substitute(spec.response_url, eventId) : spec.response_url;
  await policy.check(url);
  await policy.check(responseUrl);
  const target = new URL(responseUrl);
  const result = [],
    seen = new Set();
  let expected;
  const collectResponse = async (action) => {
    signal?.throwIfAborted();
    const waiting = page.waitForResponse(
      (r) => {
        const u = new URL(r.url());
        return (
          u.origin === target.origin &&
          u.pathname === target.pathname &&
          [...target.searchParams].every(([k, v]) => u.searchParams.get(k) === v) &&
          r.request().method() === 'GET'
        );
      },
      { timeout: 20000 },
    );
    // Attach a rejection handler before navigation can fail.
    waiting.catch(() => {});
    await action();
    try {
      const response = await waiting;
      if ([401, 403].includes(response.status()))
        throw problem(
          'needs_login',
          'POSH needs a fresh login or account verification. Reconnect the browser.',
        );
      if (response.status() === 429)
        throw problem('rate_limited', 'POSH rate limited this request. Retry later.');
      if (!response.ok())
        throw problem('source_error', `Source returned HTTP ${response.status()}.`);
      if (Number(response.headers()['content-length'] || 0) > MAX_BYTES)
        throw new Error('Source page exceeds 4 MB. Reduce its page size.');
      const body = await response.body();
      if (body.length > MAX_BYTES) throw new Error('Source page exceeds 4 MB.');
      signal?.throwIfAborted();
      return JSON.parse(body.toString('utf8'));
    } catch (e) {
      if (
        await page
          .locator(spec.login_selector)
          .isVisible()
          .catch(() => false)
      )
        throw problem(
          'needs_login',
          'Sign in or complete verification in the browser, then retry.',
        );
      if (e.code) throw e;
      throw problem(
        'mapping_required',
        'Expected event data was not received. Inspect the dashboard and update its collection mapping.',
      );
    }
  };
  for (let n = 0; n < spec.max_pages; n++) {
    const payload = await collectResponse(() =>
      n === 0
        ? page.goto(url, { waitUntil: 'domcontentloaded' })
        : page.locator(spec.next_selector).click(),
    );
    await page.locator(spec.ready_selector).waitFor({ state: 'visible', timeout: 15000 });
    const rows = at(payload, spec.items_path),
      total = at(payload, spec.total_path);
    if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < 0 || total > 100000)
      throw problem(
        'mapping_required',
        'Expected a record array and integer total. Check the source mapping.',
      );
    if (expected !== undefined && expected !== total)
      throw problem(
        'incomplete',
        'Source total changed during pagination. Retry a fresh collection.',
      );
    expected = total;
    for (const raw of rows) {
      const data = mapRecord(raw, spec, eventId);
      if (seen.has(data.external_id))
        throw problem(
          'incomplete',
          'Repeated records detected during pagination. Nothing was imported.',
        );
      seen.add(data.external_id);
      result.push({ data, raw: safeRaw(raw) });
    }
    onProgress({ pages: n + 1, records: result.length, total });
    if (result.length > total)
      throw problem('incomplete', 'Collected count exceeds the source total.');
    if (result.length === total) return result;
    if (!rows.length || !spec.next_selector)
      throw problem(
        'incomplete',
        'More records exist, but pagination is not configured or stopped early.',
      );
    const next = page.locator(spec.next_selector);
    if (
      (await next.count()) !== 1 ||
      !(await next.isEnabled()) ||
      (await next.getAttribute('aria-disabled')) === 'true'
    )
      throw problem('incomplete', 'Pagination ended before all records were collected.');
    // Bounded, cancellable pacing. No retry of a click with an uncertain result.
    await new Promise((resolve, reject) => {
      const done = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const timer = setTimeout(done, 300);
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  throw problem('incomplete', 'Page limit reached before the collection was complete.');
}
export async function collectWorkspace(worker, config, signal, progress) {
  const observed_at = new Date().toISOString(),
    events = [],
    orders = [],
    ids = new Set();
  for (const spec of config.events) {
    const found = await collectPages(worker.page, spec, worker.policy, {
      signal,
      onProgress: (p) => progress({ phase: 'events', ...p }),
    });
    for (const e of found) {
      if (ids.has(e.data.external_id))
        throw problem('incomplete', 'Event lists overlap. Configure disjoint current/past views.');
      ids.add(e.data.external_id);
      events.push(e);
      if (events.length > 5000) throw new Error('Event limit exceeded.');
    }
  }
  for (let i = 0; i < events.length; i++) {
    signal?.throwIfAborted();
    const eventId = events[i].data.external_id;
    orders.push(
      ...(await collectPages(worker.page, config.orders, worker.policy, {
        eventId,
        signal,
        onProgress: (p) =>
          progress({ phase: 'orders', event: i + 1, eventCount: events.length, ...p }),
      })),
    );
    if (orders.length > 100000) throw new Error('Workspace exceeds the per-run order limit.');
  }
  return { observed_at, events, orders, complete: true };
}
