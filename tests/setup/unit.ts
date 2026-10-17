import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => {
      throw new Error('La prueba debe inyectar un doble de red explícito.');
    }),
  );
});
