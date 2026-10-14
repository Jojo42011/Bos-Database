import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { openDb } from './db.mjs';
import { Collector } from './collector/service.mjs';
import { BrowserWorker } from './browser/worker.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const live = openDb(path.join(dir, 'crowd-control.sqlite')),
  demo = openDb(':memory:');
const worker = new BrowserWorker({
  db: live,
  dir,
  vaultKey: process.env.BROWSER_VAULT_KEY,
  allowedHosts: (process.env.BROWSER_ALLOWED_HOSTS || 'posh.vip')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});
const collector = new Collector({ db: live, worker });
const app = createApp({
  collector,
  live,
  demo,
  webhookToken: process.env.POSH_WEBHOOK_TOKEN,
  publicOrigin: process.env.PUBLIC_ORIGIN,
  browserWorker: worker,
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
    await collector.shutdown();
    await worker.shutdown();
    server.close(() => {
      live.close();
      demo.close();
      process.exit(0);
    });
  });
