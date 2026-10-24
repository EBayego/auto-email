import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    name: 'integration',
    environment: 'node',
    fileParallelism: false,
    include: ['tests/**/*.integration.ts'],
    setupFiles: ['tests/setup/integration.ts'],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    allowOnly: false,
    passWithNoTests: false,
    hookTimeout: 30000,
    testTimeout: 15000,
  },
});
