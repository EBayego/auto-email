import { beforeAll, beforeEach, vi } from 'vitest';

const localFetch = globalThis.fetch;
const origins = [
  process.env.AUTO_EMAIL_TEST_URL,
  process.env.AUTO_EMAIL_TEST_APP_URL,
].map((value) => {
  if (!value) throw new Error('Ejecuta npm run test:integration.');
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('La integración solo admite servicios locales de prueba.');
  return url.origin;
});

function restrictFetchToLocalServices() {
  vi.stubGlobal('fetch', ((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!origins.includes(url.origin))
      throw new Error('Las pruebas de integración no admiten red externa.');
    return localFetch(input, {
      ...init,
      redirect: init?.redirect === 'manual' ? 'manual' : 'error',
    });
  }) satisfies typeof fetch);
}

beforeAll(restrictFetchToLocalServices);
beforeEach(restrictFetchToLocalServices);
