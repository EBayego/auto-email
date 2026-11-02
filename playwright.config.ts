import { defineConfig } from '@playwright/test';
const baseURL = process.env.AUTO_EMAIL_TEST_APP_URL;
if (
  !baseURL ||
  new URL(baseURL).hostname !== '127.0.0.1' ||
  process.env.APP_ENV !== 'test'
)
  throw new Error('Ejecuta npm run test:e2e con Supabase local.');
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: 'coverage/e2e/artifacts',
  reporter: [
    ['list'],
    ['junit', { outputFile: 'coverage/e2e/junit.xml' }],
    ['html', { outputFolder: 'coverage/e2e/html', open: 'never' }],
  ],
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--disable-background-networking', '--disable-component-update'],
    },
  },
});
