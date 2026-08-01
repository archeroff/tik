import { defineConfig } from '@playwright/test';

// The E2E suite talks to the SAME hosted Supabase project as the app, so it
// loads `.env` into the test process (for the reset RPC) — the web server
// (vite) loads it on its own. Skip if `.env` is missing.
try {
  process.loadEnvFile?.('.env');
} catch {
  // no .env — E2E will fail fast on missing credentials
}

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
