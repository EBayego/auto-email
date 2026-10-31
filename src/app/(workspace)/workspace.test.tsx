import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  getWorkspaceGmail,
  getRecentRuns,
  requireAccount,
} from '@/app/_lib/workspace';
import { getAccount } from '@/app/_lib/auth';
import { getStyleEditorAccess } from '@/app/_lib/style-editor';
import { writingProfileFixture } from '../../../tests/fixtures/writing-profile';
import DashboardPage from './dashboard/page';
import StylePage from './style/page';
import WorkspaceLayout from './layout';
import WorkspaceError from './error';
import Loading from './loading';
import LegacyAccountPage from '../app/page';
import { Notices } from './notices';
import { WorkspaceNavigation } from './navigation';

vi.mock('@/app/_lib/workspace', () => ({
  requireAccount: vi.fn(),
  getWorkspaceGmail: vi.fn(),
  getRecentRuns: vi.fn(),
  getWorkspaceStyle: vi.fn(),
}));
vi.mock('@/app/_lib/auth', () => ({ getAccount: vi.fn() }));
vi.mock('@/app/_lib/style-editor', () => ({ getStyleEditorAccess: vi.fn() }));
vi.mock('@/app/(auth)/actions', () => ({ signOut: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/knowledge',
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
const account = {
  user: { id: 'owner', email: 'owner@example.invalid' },
  settings: {
    automationEnabled: true,
    pollIntervalSeconds: 300,
    maxDailyDrafts: 30,
  },
};

describe('MAIL-050 estados de las pantallas', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAccount).mockResolvedValue(account);
    vi.mocked(getAccount).mockResolvedValue({
      status: 'authenticated',
      account,
    });
    vi.mocked(getWorkspaceGmail).mockResolvedValue(null);
    vi.mocked(getRecentRuns).mockResolvedValue([]);
  });
  it('muestra estados vacíos reales y no considera activa la automatización sin Gmail', async () => {
    const html = renderToStaticMarkup(
      await DashboardPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain('Conecta tu cuenta Gmail');
    expect(html).toContain('Pendiente de conexión');
    expect(html).toContain('Aún no hay actividad');
  });
  it('un fallo de datos muestra reintento y conserva las otras secciones sin filtrar errores internos', async () => {
    vi.mocked(getWorkspaceGmail).mockRejectedValue(
      new Error('private database secret'),
    );
    const html = renderToStaticMarkup(
      await DashboardPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain('No podemos consultar tu conexión');
    expect(html).toContain('Volver a intentar');
    expect(html).toContain('Aún no hay actividad');
    expect(html).not.toContain('private database secret');
  });
  it('el estilo distingue entre un error y un perfil ausente', async () => {
    vi.mocked(getWorkspaceGmail).mockRejectedValue(new Error('unavailable'));
    const html = renderToStaticMarkup(await StylePage());
    expect(html).toContain('No podemos consultar tu perfil');
    expect(html).not.toContain('Tu perfil todavía no está disponible');
  });
  it('muestra el estado confirmado del perfil existente', async () => {
    vi.mocked(getWorkspaceGmail).mockResolvedValue({
      status: 'CONNECTED',
    } as NonNullable<Awaited<ReturnType<typeof getWorkspaceGmail>>>);
    const revision = crypto.randomUUID();
    vi.mocked(getStyleEditorAccess).mockResolvedValue({
      get: vi.fn().mockResolvedValue({
        generalRevision: revision,
        profiles: [
          {
            scope: { kind: 'GENERAL', key: '' },
            revision,
            parentRevision: null,
            version: 2,
            sampleSize: 30,
            reviewed: true,
            generatedAt: '2026-10-24T10:00:00Z',
            profile: {
              ...writingProfileFixture(),
              style_description: 'Claro y directo.',
            },
            current: true,
            inactiveReason: null,
          },
        ],
        preferences: [],
      }),
      apply: vi.fn(),
    });
    const html = renderToStaticMarkup(await StylePage());
    expect(html).toContain('Perfil revisado');
    expect(html).toContain('Claro y directo.');
    expect(html).not.toContain('Pendiente de revisión');
  });
  it('no renderiza contenido privado cuando la cuenta no está disponible', async () => {
    vi.mocked(getAccount).mockResolvedValue({ status: 'unavailable' });
    const html = renderToStaticMarkup(
      await WorkspaceLayout({ children: 'private content' }),
    );
    expect(html).toContain('Cuenta no disponible');
    expect(html).not.toContain('private content');
  });
  it.each(['unauthenticated', 'forbidden'] as const)(
    'protege el layout para %s',
    async (status) => {
      vi.mocked(getAccount).mockResolvedValue({ status });
      await expect(WorkspaceLayout({ children: 'private' })).rejects.toThrow(
        'redirect:/login',
      );
    },
  );
  it('marca una sola sección activa y proporciona las seis rutas', () => {
    const html = renderToStaticMarkup(<WorkspaceNavigation />);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('aria-current="page" href="/knowledge"');
    for (const route of [
      'dashboard',
      'onboarding',
      'settings',
      'style',
      'knowledge',
      'activity',
    ])
      expect(html).toContain(`href="/${route}"`);
  });
  it('no expone los detalles de un error inesperado y anuncia la carga', () => {
    const html = renderToStaticMarkup(
      <WorkspaceError error={new Error('provider secret')} reset={() => {}} />,
    );
    expect(html).toContain('Volver a intentar');
    expect(html).not.toContain('provider secret');
    expect(renderToStaticMarkup(<Loading />)).toContain('role="status"');
  });
  it('solo presenta mensajes conocidos de los retornos de OAuth', () => {
    expect(
      renderToStaticMarkup(<Notices params={{ gmail: '<secret>' }} />),
    ).toBe('');
    expect(
      renderToStaticMarkup(<Notices params={{ gmail: 'CONNECTED' }} />),
    ).toContain('Gmail se ha conectado correctamente');
  });
  it.each([
    [{}, '/dashboard'],
    [
      { gmail: 'CONNECTED', next: 'https://evil.invalid' },
      '/settings?gmail=CONNECTED',
    ],
    [{ execution: 'SAVED' }, '/settings?execution=SAVED'],
    [{ error: 'signout' }, '/dashboard?error=signout'],
    [{ gmail: ['CONNECTED', 'UNAVAILABLE'] }, '/dashboard'],
  ])(
    'conserva retornos antiguos con un destino interno fijo: %j',
    async (params, destination) => {
      await expect(
        LegacyAccountPage({ searchParams: Promise.resolve(params) }),
      ).rejects.toThrow(`redirect:${destination}`);
    },
  );
});
