import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataClient } from './models';
import { selectContextualWritingProfile } from './contextual-styles';
import {
  writingProfileRow,
  profileWork,
} from '../../tests/fixtures/writing-profile';
const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn() }));
vi.mock('./writing-profiles', () => ({
  createWritingProfileRepository: (
    _c: unknown,
    _u: string,
    _a: string,
    scope = { kind: 'GENERAL', key: '' },
  ) => ({ get: () => mocks.get(scope) }),
}));
vi.mock('./style-relationships', () => ({
  createStyleRelationshipRepository: () => ({ list: mocks.list }),
}));
const general = () => ({ ...writingProfileRow(), review_status: 'CONFIRMED' });
const contextual = (kind: string, key: string) => ({
  ...general(),
  scope_kind: kind,
  scope_key: key,
  parent_revision: general().revision,
  revision: '00000000-0000-4000-8000-000000000025',
});
const select = () =>
  selectContextualWritingProfile(
    {} as DataClient,
    profileWork.userId,
    profileWork.gmailAccountId,
    'person@company.invalid',
    new Date('2026-10-18T12:00:00Z'),
  );
describe('MAIL-025, selección contextual y respaldo general', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([]);
    mocks.get.mockImplementation(async (scope) =>
      scope.kind === 'GENERAL' ? general() : null,
    );
  });
  it('devuelve el perfil general cuando no existe un contexto fiable, sin inventar una relación', async () => {
    expect(await select()).toEqual(general());
    expect(mocks.get.mock.calls.map(([scope]) => scope.kind)).toEqual([
      'GENERAL',
      'RECIPIENT',
      'DOMAIN',
    ]);
  });
  it('prioriza un contacto concreto sobre la relación y el dominio', async () => {
    mocks.list.mockResolvedValue([
      {
        kind: 'DOMAIN',
        key: 'company.invalid',
        category: 'CLIENT',
        revision: general().revision,
      },
    ]);
    mocks.get.mockImplementation(async (scope) =>
      scope.kind === 'GENERAL' ? general() : contextual(scope.kind, scope.key),
    );
    expect((await select())?.scope_kind).toBe('RECIPIENT');
  });
  it('prefiere una categoría explícita al estilo del dominio y valida su configuración de origen', async () => {
    mocks.list.mockResolvedValue([
      {
        kind: 'DOMAIN',
        key: 'company.invalid',
        category: 'CLIENT',
        revision: general().revision,
      },
    ]);
    mocks.get.mockImplementation(async (scope) =>
      scope.kind === 'GENERAL'
        ? general()
        : scope.kind === 'RECIPIENT'
          ? null
          : {
              ...contextual(scope.kind, scope.key),
              relationship_rule_revisions: [general().revision],
            },
    );
    expect((await select())?.scope_kind).toBe('RELATIONSHIP');
    mocks.list.mockResolvedValue([
      {
        kind: 'DOMAIN',
        key: 'company.invalid',
        category: 'CLIENT',
        revision: '00000000-0000-4000-8000-000000000099',
      },
    ]);
    expect((await select())?.scope_kind).toBe('DOMAIN');
  });
  it.each(['UNREVIEWED', 'EXPIRED', 'OLD_GENERAL', 'FUTURE'])(
    'descarta contextos %s',
    async (reason) => {
      const profile = contextual('RECIPIENT', 'person@company.invalid');
      if (reason === 'UNREVIEWED') profile.review_status = 'UNREVIEWED';
      if (reason === 'OLD_GENERAL')
        profile.parent_revision = '00000000-0000-4000-8000-000000000099';
      if (reason === 'EXPIRED') profile.generated_at = '2026-01-01T00:00:00Z';
      if (reason === 'FUTURE') profile.generated_at = '2027-01-01T00:00:00Z';
      mocks.get.mockImplementation(async (scope) =>
        scope.kind === 'GENERAL'
          ? general()
          : scope.kind === 'RECIPIENT'
            ? profile
            : null,
      );
      expect(await select()).toEqual(general());
    },
  );
  it('no sustituye los errores de acceso por un respaldo silencioso', async () => {
    mocks.list.mockRejectedValue(new Error('FORBIDDEN'));
    await expect(select()).rejects.toThrow('FORBIDDEN');
  });
  it('tolera un pequeño desfase de reloj sin perder perfiles recién creados', async () => {
    mocks.get.mockImplementation(async (scope) =>
      scope.kind === 'GENERAL'
        ? general()
        : scope.kind === 'RECIPIENT'
          ? {
              ...contextual(scope.kind, scope.key),
              generated_at: '2026-10-18T12:00:00.500Z',
            }
          : null,
    );
    expect((await select())?.scope_kind).toBe('RECIPIENT');
  });
  it('requiere un perfil general confirmado', async () => {
    mocks.get.mockResolvedValue({ ...general(), review_status: 'UNREVIEWED' });
    expect(await select()).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
