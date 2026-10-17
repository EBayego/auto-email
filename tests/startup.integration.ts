import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';

it('el arranque directo de Next.js valida también las credenciales antes de atender peticiones', async () => {
  const child = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '0',
    ],
    {
      env: {
        ...process.env,
        APP_ENV: 'production',
        PROVIDER_MODE: 'live',
        APP_URL: 'https://mail.example.com',
        SUPABASE_SECRET_KEY: '',
        GOOGLE_CLIENT_SECRET: '',
        OPENAI_API_KEY: 'sk-private-startup-test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    expect(code).toBe(1);
    expect(output).toContain('SUPABASE_SECRET_KEY');
    expect(output).not.toContain('sk-private-startup-test');
  } finally {
    clearTimeout(timer);
    child.kill();
  }
});
