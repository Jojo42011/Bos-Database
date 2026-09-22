import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { openDb, seedDemo } from './db.mjs';
import { BrowserWorker } from './browser/worker.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const live = openDb(path.join(dir, 'crowd-control.sqlite')),
  demo = openDb(':memory:');
seedDemo(demo);
if (process.env.NODE_ENV === 'production') {
  if (!process.env.PUBLIC_ORIGIN?.startsWith('https://') || process.env.COOKIE_SECURE !== 'true')
    throw new Error('Production requires an HTTPS PUBLIC_ORIGIN and COOKIE_SECURE=true.');
  if (
    !live.prepare('SELECT id FROM users LIMIT 1').get() &&
    (process.env.SETUP_TOKEN || '').length < 32
  )
    throw new Error(
      'Set a random SETUP_TOKEN of at least 32 characters before creating the production owner.',
    );
}
const worker = new BrowserWorker({
  db: live,
  dir,
  vaultKey: process.env.BROWSER_VAULT_KEY,
  allowedHosts: (process.env.BROWSER_ALLOWED_HOSTS || 'posh.vip')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});
const app = createApp({
  live,
  demo,
  webhookToken: process.env.POSH_WEBHOOK_TOKEN,
  publicOrigin: process.env.PUBLIC_ORIGIN,
  secureCookie: process.env.COOKIE_SECURE === 'true',
  browserWorker: worker,
  setupToken: process.env.SETUP_TOKEN,
});
if (process.argv.includes('--production')) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () =>
  console.log(`Crowd Control running at http://${host}:${port}`),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    await worker.shutdown();
    server.close(() => {
      live.close();
      demo.close();
      process.exit(0);
    });
  });
