import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HomePage from '../src/app/page.tsx';
import PrivacyPage from '../src/app/privacy/page.tsx';
import template from '../google/publication.example.json' with { type: 'json' };
import privacy from './fixtures/privacy-env.json' with { type: 'json' };
import {
  googlePublicationReadiness,
  main,
} from '../scripts/check-google-release.mjs';

const origin = 'https://app.autoemail.es';
const env = {
  ...privacy,
  APP_ENV: 'production',
  PROVIDER_MODE: 'live',
  APP_URL: origin,
  SUPABASE_URL: 'https://zbcexekelujsqkkynsog.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit',
  SUPABASE_SECRET_KEY: 'sb_secret_private_unit',
  GOOGLE_CLIENT_ID: 'unit.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'private-google-secret',
  GOOGLE_REDIRECT_URI: `${origin}/api/gmail/callback`,
  GMAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
  PROVIDER_TIMEOUT_MS: '30000',
};
const web = {
  project_id: template.projectId,
  client_id: env.GOOGLE_CLIENT_ID,
  client_secret: env.GOOGLE_CLIENT_SECRET,
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  redirect_uris: [env.GOOGLE_REDIRECT_URI],
  javascript_origins: [],
};
const manifest = () => ({
  ...structuredClone(template),
  homepageUrl: `${origin}/`,
  privacyPolicyUrl: `${origin}/privacy`,
  authorizedDomains: ['autoemail.es'],
  supportEmail: 'support@autoemail.es',
  developerContactEmails: ['developer@autoemail.es'],
  demoVideoUrl: 'https://www.youtube.com/watch?v=Abcd1234_-X',
  evidence: Object.fromEntries(
    Object.keys(template.evidence).map((key) => [key, true]),
  ),
});
const check = (overrides = {}) =>
  googlePublicationReadiness({
    publication: manifest(),
    env,
    credentialsText: JSON.stringify({ web }),
    now: Date.parse('2026-11-01T12:00:00Z'),
    ...overrides,
  });
const html = (body) =>
  new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
const homeHtml = `<h1>Auto Email</h1><a href="/privacy">Privacidad y condiciones</a>`;
const privacyHtml = `<h1>Auto Email</h1><p>Google OpenAI Limited Use ${privacy.PRIVACY_OPERATOR_NAME} ${privacy.PRIVACY_CONTACT_EMAIL}</p>`;
const pages = () =>
  vi.fn(async (url) => html(url.endsWith('/privacy') ? privacyHtml : homeHtml));

describe('MAIL-068 expediente y publicación de Google OAuth', () => {
  it('prepara una solicitud sin presentar como aprobada la configuración local', async () => {
    const result = await check();
    expect(result.submissionReady).toBe(true);
    expect(result.publicLaunchEvidenceComplete).toBe(false);
    expect(result.remoteApprovalValidated).toBe(false);
    expect(result.launchPending).toEqual([
      'GOOGLE_APPROVAL_EVIDENCE',
      'PUBLIC_PAGES_NOT_CHECKED',
      'SECURITY_ASSESSMENT_EVIDENCE',
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('mantiene pendiente la revisión aunque dominio y contacto ya estén configurados', async () => {
    const result = await check({
      publication: template,
      env: { ...env, PRIVACY_REVIEW_APPROVED: 'false' },
    });
    expect(result.submissionReady).toBe(false);
    expect(result.pending).toEqual(
      expect.arrayContaining([
        'HOMEPAGE_URL',
        'PRIVACY_POLICY_URL',
        'AUTHORIZED_DOMAINS',
        'DEMONSTRATION_VIDEO',
        'PRIVACY_CONFIGURATION_AND_REVIEW',
      ]),
    );
  });
  it.each([
    [{ projectId: 'other-project' }, 'GOOGLE_PROJECT'],
    [{ appName: 'Other App' }, 'APP_BRANDING'],
    [{ homepageUrl: 'http://localhost:3000/' }, 'HOMEPAGE_URL'],
    [
      { privacyPolicyUrl: 'https://other.autoemail.es/privacy' },
      'PRIVACY_POLICY_URL',
    ],
    [{ authorizedDomains: ['email.es'] }, 'AUTHORIZED_DOMAINS'],
    [{ authorizedDomains: ['https://autoemail.es'] }, 'AUTHORIZED_DOMAINS'],
    [{ authorizedDomains: [] }, 'AUTHORIZED_DOMAINS'],
    [{ supportEmail: 'support@example.invalid' }, 'SUPPORT_EMAIL'],
    [{ developerContactEmails: [] }, 'DEVELOPER_CONTACT_EMAILS'],
    [{ scopes: [template.scopes[0]] }, 'EXACT_REQUESTED_SCOPES'],
    [
      { scopes: [...template.scopes, 'https://mail.google.com/'] },
      'EXACT_REQUESTED_SCOPES',
    ],
    [
      { scopes: [template.scopes[0], template.scopes[0]] },
      'EXACT_REQUESTED_SCOPES',
    ],
    [
      { demoVideoUrl: 'https://youtube.com.evil.es/watch?v=Abcd1234_-X' },
      'DEMONSTRATION_VIDEO',
    ],
    [
      {
        demoVideoUrl:
          'https://private:credential@www.youtube.com/watch?v=Abcd1234_-X',
      },
      'DEMONSTRATION_VIDEO',
    ],
    [
      {
        demoVideoUrl:
          'https://www.youtube.com/watch?v=Abcd1234_-X&private=secret',
      },
      'DEMONSTRATION_VIDEO',
    ],
    [{ unexpected: 'private-value' }, 'PUBLICATION_MANIFEST'],
  ])(
    'rechaza metadatos incoherentes sin volcar el expediente (%j)',
    async (change, code) => {
      const report = await check({ publication: { ...manifest(), ...change } });
      expect(report.pending).toContain(code);
      expect(report.submissionReady).toBe(false);
      expect(JSON.stringify(report)).not.toContain('private-value');
    },
  );
  it.each([
    'https://127.0.0.1',
    'https://localhost',
    'https://app.example.com',
    'https://autoemail.es:8443',
    'https://autoemail.es?private=secret',
  ])(
    'rechaza orígenes que no son públicos y canónicos (%s)',
    async (APP_URL) => {
      expect((await check({ env: { ...env, APP_URL } })).pending).toContain(
        'PUBLIC_APP_ORIGIN',
      );
    },
  );
  it.each([
    {
      redirect_uris: [
        ...web.redirect_uris,
        'http://localhost:3000/api/gmail/callback',
      ],
    },
    { javascript_origins: ['http://localhost:3000'] },
    { javascript_origins: 'https://app.autoemail.es' },
  ])('exige un cliente dedicado a producción (%j)', async (change) => {
    expect(
      (
        await check({
          credentialsText: JSON.stringify({ web: { ...web, ...change } }),
        })
      ).pending,
    ).toContain('DEDICATED_PRODUCTION_CLIENT');
  });
  it('detecta credenciales divergentes sin propagar secretos ni errores del parser', async () => {
    for (const credentialsText of [
      '{"private":"private-content',
      JSON.stringify({ web: { ...web, client_secret: 'different-private' } }),
    ]) {
      const result = await check({ credentialsText });
      expect(result.pending).toContain('GOOGLE_WEB_CLIENT');
      expect(JSON.stringify(result)).not.toMatch(
        /private-content|different-private|private-google-secret/,
      );
    }
  });
  it('comprueba únicamente las dos páginas públicas con peticiones anónimas y sin redirecciones', async () => {
    const fetcher = pages();
    const result = await check({ fetcher, checkPublicPages: true });
    expect(result.submissionReady).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetcher.mock.calls) {
      expect([`${origin}/`, `${origin}/privacy`]).toContain(url);
      expect(options).toMatchObject({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        headers: { Accept: 'text/html' },
      });
      expect(JSON.stringify(options)).not.toMatch(
        /Authorization|Cookie|private/,
      );
    }
    expect(result.publicPagesChecked).toBe(true);
    expect(result.launchPending).not.toContain('PUBLIC_PAGES_NOT_CHECKED');
  });
  it('reconoce la portada y la política reales renderizadas por la aplicación', async () => {
    const fetcher = vi.fn(async (url) =>
      html(
        renderToStaticMarkup(
          createElement(url.endsWith('/privacy') ? PrivacyPage : HomePage),
        ),
      ),
    );
    const result = await check({ fetcher, checkPublicPages: true });
    expect(result.pending).toEqual([]);
    expect(result.submissionReady).toBe(true);
    expect(result.publicLaunchEvidenceComplete).toBe(false);
  });
  it.each([
    [
      () => new Response('', { status: 302, headers: { Location: '/login' } }),
      'PUBLIC_HOMEPAGE',
    ],
    [() => new Response('login', { status: 401 }), 'PUBLIC_HOMEPAGE'],
    [
      () =>
        new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
      'PUBLIC_HOMEPAGE',
    ],
    [
      () => {
        throw new Error('https://private-url?private-token');
      },
      'PUBLIC_HOMEPAGE',
    ],
    [
      () =>
        html(`<h1>Auto Email</h1><!-- <a href="/privacy">privacidad</a> -->`),
      'PUBLIC_PRIVACY_LINK',
    ],
    [
      () => html(`<h1>Auto Email</h1><script>const link='[/privacy]'</script>`),
      'PUBLIC_PRIVACY_LINK',
    ],
    [() => html('x'.repeat(1024 * 1024 + 1)), 'PUBLIC_HOMEPAGE'],
  ])(
    'detecta páginas inaccesibles o enlaces inválidos',
    async (respond, code) => {
      const fetcher = vi.fn(async (url) =>
        url.endsWith('/privacy') ? html(privacyHtml) : respond(),
      );
      const result = await check({ fetcher, checkPublicPages: true });
      expect(result.pending).toContain(code);
      expect(JSON.stringify(result)).not.toMatch(/private-token|private-url/);
    },
  );
  it('detecta privacidad incompleta, falta de identidad o información de proveedores', async () => {
    const fetcher = vi.fn(async (url) =>
      html(
        url.endsWith('/privacy')
          ? 'Información pendiente de completar y revisar antes del piloto comercial.'
          : homeHtml,
      ),
    );
    expect((await check({ fetcher, checkPublicPages: true })).pending).toEqual(
      expect.arrayContaining([
        'PUBLIC_PRIVACY_UNFINISHED',
        'PUBLIC_OPERATOR_IDENTITY',
        'PUBLIC_PRIVACY_DISCLOSURES',
      ]),
    );
  });
  it('recoge cada evidencia administrativa pendiente sin sustituir la verificación de Google', async () => {
    const publication = manifest();
    publication.evidence = structuredClone(template.evidence);
    expect((await check({ publication })).pending).toHaveLength(4);
  });
  const approvedManifest = () => {
    const publication = manifest();
    publication.review = {
      status: 'approved',
      caseReference: 'Google case 123456',
      approvedScopes: [...template.scopes],
      approvalDate: '2026-10-28',
      securityAssessment: {
        status: 'passed',
        reference: 'Assessor validation 123',
        validUntil: '2027-10-27',
      },
    };
    return publication;
  };
  it('distingue evidencias declaradas de una aprobación remota que no consulta', async () => {
    const result = await check({
      publication: approvedManifest(),
      fetcher: pages(),
      checkPublicPages: true,
    });
    expect(result.publicLaunchEvidenceComplete).toBe(true);
    expect(result.remoteApprovalValidated).toBe(false);
  });
  it('exige actualizar el aviso de pruebas antes de considerar preparada la apertura aprobada', async () => {
    const fetcher = vi.fn(async (url) =>
      html(
        url.endsWith('/privacy')
          ? privacyHtml
          : `${homeHtml}<p>La apertura pública está pendiente de la verificación de Google.</p>`,
      ),
    );
    const result = await check({
      publication: approvedManifest(),
      fetcher,
      checkPublicPages: true,
    });
    expect(result.submissionReady).toBe(true);
    expect(result.publicLaunchEvidenceComplete).toBe(false);
    expect(result.launchPending).toContain('PUBLIC_TESTING_NOTICE');
  });
  it.each([
    { status: 'pending' },
    { status: 'changes_requested' },
    { caseReference: '' },
    { approvedScopes: [template.scopes[0]] },
    { approvalDate: '2026-11-02' },
    { approvalDate: '2026-02-30' },
  ])(
    'no acepta una aprobación pendiente, incompleta o inválida (%j)',
    async (change) => {
      const publication = approvedManifest();
      Object.assign(publication.review, change);
      expect((await check({ publication })).launchPending).toContain(
        'GOOGLE_APPROVAL_EVIDENCE',
      );
    },
  );
  it.each([
    { status: 'pending' },
    { status: 'not_started' },
    { reference: '' },
    { validUntil: '2026-10-31' },
    { validUntil: '2026-02-30' },
    { validUntil: '2030-01-01' },
  ])(
    'exige una evaluación vigente o una excepción documentada (%j)',
    async (change) => {
      const publication = approvedManifest();
      Object.assign(publication.review.securityAssessment, change);
      expect((await check({ publication })).launchPending).toContain(
        'SECURITY_ASSESSMENT_EVIDENCE',
      );
    },
  );
  it('acepta solo una excepción que conserva su referencia y revisión de vigencia', async () => {
    const publication = approvedManifest();
    publication.review.securityAssessment.status = 'exempted_by_google';
    expect((await check({ publication })).launchPending).not.toContain(
      'SECURITY_ASSESSMENT_EVIDENCE',
    );
  });
  it('no consulta ningún dominio cuando los metadatos públicos son incoherentes', async () => {
    const fetcher = pages();
    await check({
      publication: {
        ...manifest(),
        homepageUrl: 'https://other.autoemail.es/',
      },
      fetcher,
      checkPublicPages: true,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('ofrece ayuda sin configuración ni peticiones', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--help']);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('No modifica Google Cloud'),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('el CLI lee archivos privados sin modificarlos y falla sin revelar su contenido', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'auto-email-google-publication-'),
    );
    const files = [
      join(directory, 'submission.json'),
      join(directory, 'client.json'),
      join(directory, 'web.json'),
    ];
    const contents = [
      JSON.stringify(manifest()),
      JSON.stringify({ web }),
      JSON.stringify(env),
    ];
    try {
      await Promise.all(
        files.map((file, index) =>
          writeFile(file, contents[index], { mode: 0o600 }),
        ),
      );
      const args = [
        '--import',
        'tsx',
        'scripts/check-google-release.mjs',
        '--submission',
        files[0],
        '--credentials',
        files[1],
        '--runtime-config',
        files[2],
      ];
      const run = (extra = []) =>
        spawnSync(process.execPath, [...args, ...extra], {
          encoding: 'utf8',
          timeout: 15000,
          windowsHide: true,
        });
      const result = run();
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        submissionReady: true,
        publicLaunchEvidenceComplete: false,
        remoteApprovalValidated: false,
      });
      expect(result.stdout + result.stderr).not.toMatch(
        /private-google-secret|sb_secret_private_unit/,
      );
      expect(run(['--require-approval']).status).toBe(1);
      await writeFile(files[1], '{"private":"private-google-secret');
      const failed = run();
      expect(failed.status).toBe(1);
      expect(failed.stderr).toContain('GOOGLE_PUBLICATION_CHECK_FAILED');
      expect(failed.stderr).not.toContain('private-google-secret');
      expect(await readFile(files[0], 'utf8')).toBe(contents[0]);
      expect(await readFile(files[2], 'utf8')).toBe(contents[2]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
