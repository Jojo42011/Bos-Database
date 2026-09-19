import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const data = mkdtempSync(path.join(tmpdir(), 'crowd-control-e2e-'));
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:3101',
    viewport: { width: 1440, height: 1100 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server/index.mjs --production',
    url: 'http://127.0.0.1:3101',
    reuseExistingServer: false,
    env: {
      PORT: '3101',
      HOST: '127.0.0.1',
      DATA_DIR: data,
      PUBLIC_ORIGIN: 'http://127.0.0.1:3101',
    },
  },
});
