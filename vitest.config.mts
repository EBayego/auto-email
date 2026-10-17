import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
    env: {
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
    },
  },
});
