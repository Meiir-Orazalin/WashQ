import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm --filter @washqueue/contracts build && pnpm --filter @washqueue/web dev',
    env: {
      NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3000/api/v1',
    },
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chrome-desktop',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'chrome-mobile',
      use: { ...devices['Pixel 7'], channel: 'chrome' },
    },
  ],
});
