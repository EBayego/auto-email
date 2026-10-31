import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createAuthClient } from '@/modules/auth/client';
import type { Database } from '@/db/database.types';

const url = process.env.AUTO_EMAIL_TEST_URL!;
const origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
const routes = [
  'dashboard',
  'onboarding',
  'settings',
  'style',
  'knowledge',
  'activity',
];
const owners: {
  id: string;
  email: string;
  jar: Map<string, string>;
  client: ReturnType<typeof createAuthClient>;
}[] = [];
const cookies = (index: number) =>
  [...owners[index].jar].map(([key, value]) => `${key}=${value}`).join('; ');
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

describe('MAIL-050 navegación privada con Supabase local', () => {
  beforeAll(async () => {
    if (new URL(url).origin !== 'http://127.0.0.1:55321')
      throw new Error('Solo se permite Supabase local.');
    for (let index = 0; index < 2; index++) {
      const email = `mail050-${index}-${crypto.randomUUID()}@example.invalid`;
      const password = `Test-${crypto.randomUUID()}`;
      const result = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(result.error).toBeNull();
      const jar = new Map<string, string>();
      const client = createAuthClient(
        {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (values) => {
            for (const { name, value } of values) {
              if (value) jar.set(name, value);
              else jar.delete(name);
            }
          },
        },
        {
          appOrigin: origin,
          supabaseUrl: url,
          publishableKey: process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
          secureCookies: false,
        },
      );
      owners.push({ id: result.data.user!.id, email, jar, client });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
    }
    const account = await service
      .from('gmail_accounts')
      .insert({
        user_id: owners[0].id,
        email: owners[0].email,
        encrypted_refresh_token: '\\x74657374',
      })
      .select('id')
      .single();
    expect(account.error).toBeNull();
    expect(
      (
        await service.from('processing_runs').insert({
          user_id: owners[0].id,
          gmail_account_id: account.data!.id,
          trigger_kind: 'MANUAL',
        })
      ).error,
    ).toBeNull();
  });
  afterAll(async () => {
    for (const owner of owners) {
      await owner.client.auth.signOut({ scope: 'local' });
      expect((await service.auth.admin.deleteUser(owner.id)).error).toBeNull();
    }
  });

  it.each(routes)(
    'redirige /%s a login sin sesión y evita cachés públicas',
    async (route) => {
      const response = await fetch(`${origin}/${route}`, {
        redirect: 'manual',
      });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('/login');
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(await response.text()).not.toContain(owners[0].email);
    },
  );
  it.each(routes)(
    'ambos usuarios pueden navegar por /%s con sus propios datos',
    async (route) => {
      for (const index of [0, 1]) {
        const response = await fetch(`${origin}/${route}`, {
          headers: { cookie: cookies(index) },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
        const html = await response.text();
        expect(html).toContain(owners[index].email);
        expect(html).not.toContain(owners[1 - index].email);
        expect(html).not.toContain('encrypted_refresh_token');
        expect(html).toContain('Saltar al contenido');
        expect(html).toContain('Navegación principal');
        for (const destination of routes)
          expect(html).toContain(`href="/${destination}"`);
      }
    },
  );
  it('distingue actividad existente de un usuario sin ejecuciones', async () => {
    const populated = await (
      await fetch(`${origin}/activity`, { headers: { cookie: cookies(0) } })
    ).text();
    const empty = await (
      await fetch(`${origin}/activity`, { headers: { cookie: cookies(1) } })
    ).text();
    expect(populated).toContain('Revisión manual');
    expect(empty).toContain('Aún no hay ejecuciones');
  });
  it('muestra el estado de reconexión sin consultar Gmail', async () => {
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({ status: 'REAUTH_REQUIRED' })
          .eq('user_id', owners[0].id)
      ).error,
    ).toBeNull();
    const html = await (
      await fetch(`${origin}/settings`, { headers: { cookie: cookies(0) } })
    ).text();
    expect(html).toContain('Necesita autorización');
    expect(html).toContain('Volver a conectar Gmail');
    expect(html).not.toContain('Revisar correos ahora');
  });
  it.each([
    ['', '/dashboard'],
    ['?gmail=CONNECTED&next=https://evil.invalid', '/settings?gmail=CONNECTED'],
    ['?execution=SAVED', '/settings?execution=SAVED'],
    ['?error=signout', '/dashboard?error=signout'],
  ])('mantiene compatibilidad con /app%s', async (query, destination) => {
    const response = await fetch(`${origin}/app${query}`, {
      redirect: 'manual',
      headers: { cookie: cookies(0) },
    });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(destination);
  });
});
