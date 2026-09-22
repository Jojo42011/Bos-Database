import { z } from 'zod';
export function mountBrowserRoutes(app, worker) {
  app.use('/api/browser', (req, res, next) => {
    if (req.isDemo)
      return res
        .status(403)
        .json({ error: 'The browser is available only in your private workspace.' });
    if (!worker) return res.status(503).json({ error: 'The browser worker is not configured.' });
    next();
  });
  const route = (method, url, fn) =>
    app[method](`/api/browser${url}`, async (req, res, next) => {
      try {
        res.json(await fn(req));
      } catch (e) {
        if (!e.status && !(e instanceof z.ZodError)) e.status = 400;
        next(e);
      }
    });
  route('get', '', () => worker.status());
  route('post', '/open', (req) =>
    worker.open(z.object({ url: z.string().url().max(1500) }).parse(req.body).url),
  );
  route('post', '/close', () => worker.closeSession());
  route('get', '/frame', () => worker.frame());
  route('post', '/action', (req) =>
    worker.action(
      z
        .discriminatedUnion('type', [
          z.object({
            type: z.literal('click'),
            x: z.number().min(0).max(1279),
            y: z.number().min(0).max(799),
          }),
          z.object({ type: z.literal('text'), text: z.string().max(2000) }),
          z.object({
            type: z.literal('key'),
            key: z.enum([
              'Enter',
              'Tab',
              'Shift+Tab',
              'Backspace',
              'Escape',
              'ControlOrMeta+A',
              'ArrowDown',
              'ArrowUp',
            ]),
          }),
          z.object({ type: z.literal('scroll'), delta: z.number().min(-1200).max(1200) }),
        ])
        .parse(req.body),
    ),
  );
  route('post', '/credentials', (req) => {
    const c = z
      .object({
        origin: z.string().url(),
        username: z.string().min(1).max(254),
        password: z.string().min(1).max(500),
        username_selector: z.string().min(1).max(500),
        password_selector: z.string().min(1).max(500),
      })
      .parse(req.body);
    const u = worker.policy.parse(c.origin);
    if (u.origin !== c.origin)
      throw new Error('Use an exact origin without a path for saved credentials.');
    worker.vault.save(c);
    return { ok: true };
  });
  route('post', '/credentials/fill', () => worker.useCredentials());
  route('post', '/sources', (req) => worker.saveSource(req.body));
  route('post', '/sources/:id', (req) => worker.saveSource(req.body, req.params.id));
  route('post', '/sources/:id/run', (req) => worker.enqueue(req.params.id));
  route('get', '/jobs/:id', (req) => worker.preview(req.params.id));
  route('post', '/jobs/:id/approve', (req) => worker.approve(req.params.id));
  route('post', '/jobs/:id/dismiss', (req) => worker.dismiss(req.params.id));
}
