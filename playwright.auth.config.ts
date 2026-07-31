import { defineConfig, devices } from '@playwright/test';

const webOrigin = 'http://127.0.0.1:3000';
const apiOrigin = 'http://127.0.0.1:4000';
const apiBaseUrl = `${apiOrigin}/api/v1`;

const testDatabaseUrl = requireEnvironment('TEST_DATABASE_URL');
const accessTokenSigningSecret = requireEnvironment('ACCESS_TOKEN_SIGNING_SECRET');
process.env.AUTH_E2E_RUN_ID ??= 'local';

export default defineConfig({
  testDir: './e2e/live-auth',
  globalTeardown: './e2e/live-auth/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: 'test-results/auth',
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/auth' }]]
    : 'list',
  use: {
    baseURL: webOrigin,
    screenshot: 'only-on-failure',
    trace: {
      attachments: false,
      mode: 'retain-on-failure',
      screenshots: true,
      snapshots: false,
      sources: false,
    },
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @washqueue/api start',
      env: {
        ACCESS_TOKEN_LIFETIME_SECONDS: '900',
        ACCESS_TOKEN_SIGNING_SECRET: accessTokenSigningSecret,
        API_DOCS_ENABLED: 'false',
        API_PORT: '4000',
        CORS_ORIGINS: webOrigin,
        DATABASE_URL: testDatabaseUrl,
        LOG_LEVEL: 'error',
        NODE_ENV: 'test',
        REFRESH_TOKEN_LIFETIME_SECONDS: '3600',
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${apiBaseUrl}/health/ready`,
    },
    {
      command: 'pnpm --filter @washqueue/web start',
      env: {
        NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
        NODE_ENV: 'production',
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: webOrigin,
    },
  ],
  projects: [
    {
      name: 'chromium-auth',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        ...(process.env.AUTH_E2E_USE_SYSTEM_CHROME === 'true' ? { channel: 'chrome' } : {}),
      },
    },
    {
      name: 'webkit-auth',
      use: { ...devices['Desktop Safari'], browserName: 'webkit' },
    },
  ],
});

function requireEnvironment(name: 'ACCESS_TOKEN_SIGNING_SECRET' | 'TEST_DATABASE_URL'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for live authentication browser tests`);
  }

  return value;
}
