import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

export default defineConfig({
  testDir: './tests/e2e',
  // All browser tests mutate one ephemeral server's plugin/config state.
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3319',
    headless: true,
    channel:
      process.env.HARNESS_BROWSER ??
      (fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'msedge' : 'chromium'),
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'node dist/server/main.mjs --demo --port=3319 --ephemeral',
    url: 'http://127.0.0.1:3319/api/health',
    reuseExistingServer: false,
  },
});
