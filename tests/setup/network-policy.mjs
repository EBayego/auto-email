const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
export function testNetworkOrigins(env) {
  // A child may deliberately test invalid production configuration. Unit mode
  // still denies every connection, independently of that configuration.
  if (env.AUTO_EMAIL_TEST_NETWORK_MODE === 'unit') return [];
  if (env.APP_ENV !== 'test' || env.PROVIDER_MODE !== 'mock')
    throw new Error('TEST_NETWORK_CONFIGURATION_INVALID');
  if (env.AUTO_EMAIL_TEST_NETWORK_MODE !== 'integration')
    throw new Error('TEST_NETWORK_CONFIGURATION_INVALID');
  return ['AUTO_EMAIL_TEST_URL', 'AUTO_EMAIL_TEST_APP_URL'].map((name) => {
    const url = new URL(env[name] ?? '');
    if (
      url.protocol !== 'http:' ||
      !loopback.has(url.hostname) ||
      !url.port ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('TEST_NETWORK_CONFIGURATION_INVALID');
    return url.origin;
  });
}
export const blockedTestNetwork = () => new Error('TEST_NETWORK_BLOCKED');
export function testFetch(origins, fetcher) {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!origins.includes(url.origin))
      return Promise.reject(blockedTestNetwork());
    return fetcher(input, {
      ...init,
      redirect:
        init?.redirect === 'manual' ||
        (init?.redirect === undefined &&
          input instanceof Request &&
          input.redirect === 'manual')
          ? 'manual'
          : 'error',
    });
  };
}
export function testSocketAllowed(origins, args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const first = values[0];
  const options =
    first && typeof first === 'object'
      ? first
      : {
          port: first,
          host: typeof values[1] === 'string' ? values[1] : 'localhost',
        };
  if (options.path || !Number.isInteger(Number(options.port))) return false;
  const host = (options.host ?? options.hostname ?? 'localhost')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return origins.some((origin) => {
    const url = new URL(origin);
    return (
      host === url.hostname.replace(/^\[|\]$/g, '') &&
      Number(options.port) === Number(url.port)
    );
  });
}
