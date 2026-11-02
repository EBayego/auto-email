import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import privacyEnvironment from './tests/fixtures/privacy-env.json' with { type: 'json' };

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    name: 'unit',
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx,mjs}'],
    setupFiles: ['tests/setup/unit.ts'],
    reporters: ['default', 'junit'],
    outputFile: { junit: 'coverage/unit/junit.xml' },
    env: {
      ...privacyEnvironment,
      APP_ENV: 'test',
      PROVIDER_MODE: 'mock',
      APP_URL: 'http://localhost:3000',
      SUPABASE_URL: 'http://127.0.0.1:55321',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit',
      SUPABASE_SECRET_KEY: 'sb_secret_unit',
      OPENAI_API_KEY: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      PROVIDER_TIMEOUT_MS: '30000',
    },
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    allowOnly: false,
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/db/database.types.ts'],
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage/unit',
      reportOnFailure: true,
      thresholds: {
        'src/modules/gmail/**/*.ts': { lines: 90, branches: 85, functions: 90 },
        'src/modules/identity/**/*.ts': {
          lines: 90,
          branches: 85,
          functions: 90,
        },
        'src/modules/classifier/**/*.ts': {
          lines: 90,
          branches: 85,
          functions: 90,
        },
        'src/modules/source-router/**/*.ts': {
          lines: 90,
          branches: 85,
          functions: 90,
        },
        'src/modules/response/**/*.ts': {
          lines: 90,
          branches: 85,
          functions: 90,
        },
        'src/modules/policy/**/*.ts': {
          lines: 90,
          branches: 85,
          functions: 90,
        },
        'src/modules/security/**/*.ts': {
          lines: 88,
          branches: 75,
          functions: 90,
        },
        'src/providers/{openai,gmail,request-policy}.ts': {
          lines: 90,
          branches: 85,
          functions: 90,
        },
        'src/worker/{automation-selection,email-classifier,email-generation}.ts':
          { lines: 90, branches: 85 },
      },
    },
  },
});
