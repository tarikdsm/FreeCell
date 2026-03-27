import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @freecell/web dev -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'chromium-tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
      },
    },
  ],
});
