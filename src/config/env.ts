export class SecretValue {
  #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  reveal() {
    return this.#value;
  }
  toString() {
    return '[REDACTED]';
  }
  toJSON() {
    return '[REDACTED]';
  }
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return '[REDACTED]';
  }
}

export class ConfigurationError extends Error {
  readonly variables: readonly string[];
  constructor(variables: string[]) {
    const names = [...new Set(variables)].sort();
    super(
      `Configuración incompleta o inválida: ${names.join(', ')}. Revisa las variables de entorno del servidor.`,
    );
    this.name = 'ConfigurationError';
    this.variables = Object.freeze(names);
  }
}

type Environment = Record<string, string | undefined>;
export type AuthConfig = {
  appOrigin: string;
  supabaseUrl: string;
  publishableKey: string;
  secureCookies: boolean;
};
export type ReasoningEffort =
  'omit' | 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ServerConfig = {
  environment: 'development' | 'test' | 'staging' | 'production';
  auth: AuthConfig;
  supabase: { url: string; secretKey: SecretValue };
  timeoutMs: number;
} & (
  | {
      providerMode: 'live';
      gmail: { tokenEncryptionKey: SecretValue };
      openai: {
        apiKey: SecretValue;
        model: string;
        reasoningEffort: ReasoningEffort;
        maxOutputTokens: number;
      };
      google: {
        clientId: string;
        clientSecret: SecretValue;
        redirectUri: string;
      };
    }
  | { providerMode: 'mock'; openai: null; google: null }
);

const loopback = (url: URL) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
function validOrigin(value: string | undefined): URL | null {
  try {
    const url = new URL(value ?? '');
    return (url.protocol === 'https:' ||
      (url.protocol === 'http:' && loopback(url))) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}

function usable(value: string | undefined): value is string {
  return (
    !!value &&
    value === value.trim() &&
    !/\s/.test(value) &&
    !/^(?:<|your[_-]|replace[_-]|changeme|example)/i.test(value) &&
    !value.includes('...')
  );
}

export function readAuthConfig(env: Environment = process.env): AuthConfig {
  const app = validOrigin(env.APP_URL);
  const supabase = validOrigin(env.SUPABASE_URL);
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  const failures = [];
  if (!app) failures.push('APP_URL');
  if (!supabase) failures.push('SUPABASE_URL');
  if (!usable(key) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
    failures.push('SUPABASE_PUBLISHABLE_KEY');
  if (failures.length) throw new ConfigurationError(failures);
  return {
    appOrigin: app!.origin,
    supabaseUrl: supabase!.origin,
    publishableKey: key!,
    secureCookies: app!.protocol === 'https:',
  };
}

export function readServerConfig(env: Environment = process.env): ServerConfig {
  const failures: string[] = [];
  let auth: AuthConfig | undefined;
  try {
    auth = readAuthConfig(env);
  } catch (error) {
    if (error instanceof ConfigurationError) failures.push(...error.variables);
    else throw error;
  }
  const stage = env.APP_ENV;
  const mode = env.PROVIDER_MODE;
  if (!['development', 'test', 'staging', 'production'].includes(stage ?? ''))
    failures.push('APP_ENV');
  if (
    !['live', 'mock'].includes(mode ?? '') ||
    (mode === 'mock' && stage !== 'test')
  )
    failures.push('PROVIDER_MODE');
  if (stage === 'test' && mode !== 'mock') failures.push('PROVIDER_MODE');
  if (auth) {
    const app = new URL(auth.appOrigin);
    const db = new URL(auth.supabaseUrl);
    if (stage === 'test') {
      if (!loopback(app)) failures.push('APP_URL');
      if (!loopback(db)) failures.push('SUPABASE_URL');
    }
    if (stage === 'staging' || stage === 'production') {
      if (
        app.protocol !== 'https:' ||
        loopback(app) ||
        app.hostname.endsWith('.invalid')
      )
        failures.push('APP_URL');
      if (
        db.protocol !== 'https:' ||
        loopback(db) ||
        db.hostname.endsWith('.invalid')
      )
        failures.push('SUPABASE_URL');
    }
  }
  if (
    !usable(env.SUPABASE_SECRET_KEY) ||
    !/^sb_secret_[A-Za-z0-9_-]+$/.test(env.SUPABASE_SECRET_KEY)
  )
    failures.push('SUPABASE_SECRET_KEY');
  const timeout = Number(env.PROVIDER_TIMEOUT_MS);
  if (
    !/^\d+$/.test(env.PROVIDER_TIMEOUT_MS ?? '') ||
    !Number.isInteger(timeout) ||
    timeout < 1000 ||
    timeout > 120000
  )
    failures.push('PROVIDER_TIMEOUT_MS');
  for (const name of [
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
    'GOOGLE_CLIENT_SECRET',
    'GMAIL_TOKEN_ENCRYPTION_KEY',
  ]) {
    for (const prefix of ['NEXT_PUBLIC_', 'EXPO_PUBLIC_'])
      if (env[`${prefix}${name}`]) failures.push(`${prefix}${name}`);
  }

  const reasoning = env.OPENAI_REASONING_EFFORT;
  const maxOutputTokens = Number(env.OPENAI_MAX_OUTPUT_TOKENS);
  if (mode === 'live') {
    if (
      !/^[A-Za-z0-9+/]{43}=$/.test(env.GMAIL_TOKEN_ENCRYPTION_KEY ?? '') ||
      Buffer.from(env.GMAIL_TOKEN_ENCRYPTION_KEY ?? '', 'base64').toString(
        'base64',
      ) !== env.GMAIL_TOKEN_ENCRYPTION_KEY
    )
      failures.push('GMAIL_TOKEN_ENCRYPTION_KEY');
    if (
      !usable(env.OPENAI_API_KEY) ||
      !/^sk-[A-Za-z0-9_-]+$/.test(env.OPENAI_API_KEY)
    )
      failures.push('OPENAI_API_KEY');
    if (
      !usable(env.OPENAI_MODEL) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(env.OPENAI_MODEL)
    )
      failures.push('OPENAI_MODEL');
    if (
      !['omit', 'none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
        reasoning ?? '',
      )
    )
      failures.push('OPENAI_REASONING_EFFORT');
    if (
      !/^\d+$/.test(env.OPENAI_MAX_OUTPUT_TOKENS ?? '') ||
      !Number.isInteger(maxOutputTokens) ||
      maxOutputTokens < 16 ||
      maxOutputTokens > 32768
    )
      failures.push('OPENAI_MAX_OUTPUT_TOKENS');
    if (
      !usable(env.GOOGLE_CLIENT_ID) ||
      !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(
        env.GOOGLE_CLIENT_ID,
      )
    )
      failures.push('GOOGLE_CLIENT_ID');
    if (
      !usable(env.GOOGLE_CLIENT_SECRET) ||
      env.GOOGLE_CLIENT_SECRET.length < 16
    )
      failures.push('GOOGLE_CLIENT_SECRET');
    try {
      const redirect = new URL(env.GOOGLE_REDIRECT_URI ?? '');
      if (
        !auth ||
        redirect.origin !== auth.appOrigin ||
        redirect.pathname !== '/api/gmail/callback' ||
        redirect.search ||
        redirect.hash ||
        redirect.username ||
        redirect.password
      )
        failures.push('GOOGLE_REDIRECT_URI');
    } catch {
      failures.push('GOOGLE_REDIRECT_URI');
    }
  }
  if (failures.length) throw new ConfigurationError(failures);
  const common = {
    environment: stage as ServerConfig['environment'],
    auth: auth!,
    supabase: {
      url: auth!.supabaseUrl,
      secretKey: new SecretValue(env.SUPABASE_SECRET_KEY!),
    },
    timeoutMs: timeout,
  };
  return mode === 'mock'
    ? { ...common, providerMode: 'mock', openai: null, google: null }
    : {
        ...common,
        providerMode: 'live',
        gmail: {
          tokenEncryptionKey: new SecretValue(env.GMAIL_TOKEN_ENCRYPTION_KEY!),
        },
        openai: {
          apiKey: new SecretValue(env.OPENAI_API_KEY!),
          model: env.OPENAI_MODEL!,
          reasoningEffort: reasoning as ReasoningEffort,
          maxOutputTokens,
        },
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: new SecretValue(env.GOOGLE_CLIENT_SECRET!),
          redirectUri: env.GOOGLE_REDIRECT_URI!,
        },
      };
}

export function getServerConfig(): ServerConfig {
  return readServerConfig();
}
