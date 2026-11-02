import {
  ConfigurationError,
  SecretValue,
  assertNoPublicSecrets,
} from './env.ts';

export type SharePointConfig = {
  clientId: string;
  clientSecret: SecretValue;
  encryptionKey: SecretValue;
  tenants: string[];
  scope: 'Sites.Read.All' | 'Sites.Selected';
  redirectUri: string;
  timeoutMs: number;
  ocr: { endpoint: string; key: SecretValue; dailyPageBudget: number } | null;
};
export function readSharePointConfig(
  env: Record<string, string | undefined> = process.env,
): SharePointConfig | null {
  assertNoPublicSecrets(env);
  if (env.SHAREPOINT_ENABLED !== 'true') {
    if (env.SHAREPOINT_ENABLED && env.SHAREPOINT_ENABLED !== 'false')
      throw new ConfigurationError(['SHAREPOINT_ENABLED']);
    return null;
  }
  const errors: string[] = [];
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tenants = (env.MICROSOFT_ALLOWED_TENANTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!tenants.length || tenants.some((t) => !uuid.test(t)))
    errors.push('MICROSOFT_ALLOWED_TENANTS');
  if (!uuid.test(env.MICROSOFT_CLIENT_ID ?? ''))
    errors.push('MICROSOFT_CLIENT_ID');
  if (!env.MICROSOFT_CLIENT_SECRET?.trim())
    errors.push('MICROSOFT_CLIENT_SECRET');
  const key = env.MICROSOFT_TOKEN_ENCRYPTION_KEY ?? '';
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(key) ||
    Buffer.from(key, 'base64').toString('base64') !== key
  )
    errors.push('MICROSOFT_TOKEN_ENCRYPTION_KEY');
  const scope = env.MICROSOFT_GRAPH_SCOPE ?? 'Sites.Read.All';
  if (!['Sites.Read.All', 'Sites.Selected'].includes(scope))
    errors.push('MICROSOFT_GRAPH_SCOPE');
  let origin = '';
  try {
    const url = new URL(env.APP_URL ?? '');
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname))
      )
    )
      throw new Error();
    origin = url.origin;
  } catch {
    errors.push('APP_URL');
  }
  let ocr: SharePointConfig['ocr'] = null;
  if (env.SHAREPOINT_OCR_ENDPOINT || env.SHAREPOINT_OCR_KEY) {
    try {
      const url = new URL(env.SHAREPOINT_OCR_ENDPOINT ?? '');
      if (
        url.protocol !== 'https:' ||
        !url.hostname.endsWith('.cognitiveservices.azure.com') ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        !env.SHAREPOINT_OCR_KEY?.trim()
      )
        throw new Error();
      const dailyPageBudget = Number(
        env.SHAREPOINT_OCR_DAILY_PAGE_BUDGET ?? '500',
      );
      if (
        !Number.isInteger(dailyPageBudget) ||
        dailyPageBudget < 1 ||
        dailyPageBudget > 100000
      )
        throw new Error();
      ocr = {
        endpoint: url.origin,
        key: new SecretValue(env.SHAREPOINT_OCR_KEY!),
        dailyPageBudget,
      };
    } catch {
      errors.push('SHAREPOINT_OCR_ENDPOINT', 'SHAREPOINT_OCR_KEY');
    }
  }
  if (errors.length) throw new ConfigurationError(errors);
  return {
    clientId: env.MICROSOFT_CLIENT_ID!.toLowerCase(),
    clientSecret: new SecretValue(env.MICROSOFT_CLIENT_SECRET!),
    encryptionKey: new SecretValue(key),
    tenants,
    scope: scope as SharePointConfig['scope'],
    redirectUri: `${origin}/api/connectors/microsoft/callback`,
    timeoutMs: 30000,
    ocr,
  };
}
