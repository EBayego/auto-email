import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataClient } from './models';
import { createOwnerRepositories } from './repositories';
import { createWritingProfileRepository } from './writing-profiles';
import {
  profileWork,
  writingProfileFixture,
  writingProfileRow,
  legacyWritingProfileFixture,
} from '../../tests/fixtures/writing-profile';
vi.mock('./repositories', () => ({ createOwnerRepositories: vi.fn() }));
const user = vi.fn();
const account = vi.fn();
const maybeSingle = vi.fn();
const single = vi.fn();
const query = {
  select: vi.fn(),
  eq: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  maybeSingle,
  single,
};
const from = vi.fn(() => query);
const client = { from } as unknown as DataClient;
const repo = () =>
  createWritingProfileRepository(
    client,
    profileWork.userId,
    profileWork.gmailAccountId,
  );
const generation = () => ({
  profile: writingProfileFixture(),
  model: 'test-model',
  sampleSize: 1,
  inputTokens: 100,
  outputTokens: 80,
  warnings: ['BELOW_RECOMMENDED_SIZE' as const],
  sourceMessageIds: ['sent0'],
});
describe('repositorio de perfiles aislado por propietario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of [query.select, query.eq, query.upsert, query.update])
      method.mockReturnValue(query);
    user.mockResolvedValue({ id: profileWork.userId, status: 'ACTIVE' });
    account.mockResolvedValue({
      id: profileWork.gmailAccountId,
      user_id: profileWork.userId,
      status: 'CONNECTED',
    });
    vi.mocked(createOwnerRepositories).mockReturnValue({
      users: { get: user },
      gmailAccounts: { findById: account },
    } as unknown as ReturnType<typeof createOwnerRepositories>);
    maybeSingle.mockResolvedValue({ data: writingProfileRow(), error: null });
    single.mockResolvedValue({ data: writingProfileRow(), error: null });
  });
  it('consulta un perfil reutilizable filtrando propietario y cuenta', async () => {
    expect((await repo().get())?.profile).toEqual(writingProfileFixture());
    expect(query.eq).toHaveBeenCalledWith('user_id', profileWork.userId);
    expect(query.eq).toHaveBeenCalledWith(
      'gmail_account_id',
      profileWork.gmailAccountId,
    );
    expect(account).toHaveBeenCalledWith(profileWork.gmailAccountId);
  });
  it('guarda solo perfil validado y métricas, y reinicia la revisión al regenerar', async () => {
    const input = {
      ...generation(),
      authoredText: 'private-body',
      raw: 'private-mime',
    };
    await repo().save(input);
    const [payload, conflict] = query.upsert.mock.calls[0];
    expect(payload).toMatchObject({
      user_id: profileWork.userId,
      gmail_account_id: profileWork.gmailAccountId,
      profile: writingProfileFixture(),
      review_status: 'UNREVIEWED',
      reviewed_at: null,
      origin: 'SENT_HISTORY',
      source_message_ids: ['sent0'],
      prompt_version: 'mail024-v2',
    });
    expect(payload.revision).not.toBe(writingProfileRow().revision);
    expect(JSON.stringify(payload)).not.toContain('private');
    expect(conflict).toEqual({
      onConflict: 'gmail_account_id,scope_kind,scope_key',
    });
    expect(payload).not.toHaveProperty('version');
  });
  it('rechaza cuentas ajenas o desconectadas y usuarios deshabilitados antes de escribir', async () => {
    account.mockResolvedValue(null);
    await expect(repo().save(generation())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    account.mockResolvedValue({ status: 'DISCONNECTED' });
    await expect(repo().save(generation())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    user.mockResolvedValue({ status: 'DISABLED' });
    await expect(repo().get()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(from).not.toHaveBeenCalled();
  });
  it('no guarda perfiles inválidos ni métricas o modelos manipulados', async () => {
    await expect(
      repo().save({
        ...generation(),
        profile: {
          ...writingProfileFixture(),
          email: 'private@example.invalid',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    for (const extra of [
      { sampleSize: 0 },
      { sampleSize: 501 },
      { inputTokens: -1 },
      { model: 'bad model' },
      { sourceMessageIds: [] },
      { sourceMessageIds: ['sent0', 'sent0'] },
      { sourceMessageIds: ['bad id'] },
      { sourceMessageIds: ['<private@example.invalid>'] },
    ])
      await expect(
        repo().save({ ...generation(), ...extra }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(from).not.toHaveBeenCalled();
  });
  it('reutiliza perfiles antiguos con procedencia histórica incompleta y no los vuelve a guardar como nuevos', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        ...writingProfileRow(),
        profile: legacyWritingProfileFixture(),
        prompt_version: 'mail018-v1',
        source_message_ids: [],
      },
      error: null,
    });
    expect((await repo().get())?.profile.schema_version).toBe(1);
    await expect(
      repo().save({ ...generation(), profile: legacyWritingProfileFixture() }),
    ).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    expect(query.upsert).not.toHaveBeenCalled();
  });
  it('rechaza metadatos incoherentes devueltos por el almacén', async () => {
    for (const extra of [
      { version: 0 },
      { origin: 'OTHER_ACCOUNT' },
      { source_message_ids: [] },
    ]) {
      maybeSingle.mockResolvedValueOnce({
        data: { ...writingProfileRow(), ...extra },
        error: null,
      });
      await expect(repo().get()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    }
  });
  it('impide confirmar una revisión antigua y limita la operación a la cuenta propietaria', async () => {
    await repo().confirm(writingProfileRow().revision);
    expect(query.update).toHaveBeenCalledWith({
      review_status: 'CONFIRMED',
      reviewed_at: expect.any(String),
    });
    expect(query.eq).toHaveBeenCalledWith(
      'revision',
      writingProfileRow().revision,
    );
    expect(query.eq).toHaveBeenCalledWith('user_id', profileWork.userId);
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(
      repo().confirm(writingProfileRow().revision),
    ).rejects.toMatchObject({ code: 'STALE_REVIEW' });
  });
  it('rechaza respuestas de otra cuenta y oculta errores de almacenamiento', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        ...writingProfileRow(),
        user_id: '00000000-0000-4000-8000-000000000099',
      },
      error: null,
    });
    await expect(repo().get()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    single.mockResolvedValue({ data: null, error: { detail: 'private-body' } });
    await expect(repo().save(generation())).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });
});
