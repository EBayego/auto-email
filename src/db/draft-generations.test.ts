import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataClient } from './models';
import { createOwnerRepositories } from './repositories';
import { createDraftGenerationRepository } from './draft-generations';
import {
  profileWork,
  writingProfileRow,
} from '../../tests/fixtures/writing-profile';
vi.mock('./repositories', () => ({ createOwnerRepositories: vi.fn() }));
const user = vi.fn();
const account = vi.fn();
const maybeSingle = vi.fn();
const single = vi.fn();
const query = {
  select: vi.fn(),
  eq: vi.fn(),
  in: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  maybeSingle,
  single,
};
const from = vi.fn(() => query);
const client = { from } as unknown as DataClient;
const repo = () =>
  createDraftGenerationRepository(
    client,
    profileWork.userId,
    profileWork.gmailAccountId,
  );
const reservation = () => ({
  id: '20000000-0000-4000-8000-000000000021',
  threadId: 'thread21',
  targetMessageId: 'target21',
  styleRevision: writingProfileRow().revision,
  model: 'test-model',
  inputTokens: 100,
  outputTokens: 30,
});
const row = () => ({
  id: reservation().id,
  user_id: profileWork.userId,
  gmail_account_id: profileWork.gmailAccountId,
  thread_id: 'thread21',
  target_message_id: 'target21',
  status: 'CREATING',
  draft_id: null,
  draft_message_id: null,
  verified_at: null,
});
describe('registro de borradores con propietario y reserva persistente', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [
      query.select,
      query.eq,
      query.in,
      query.insert,
      query.update,
    ])
      fn.mockReturnValue(query);
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
    maybeSingle.mockResolvedValue({ data: row(), error: null });
    single.mockResolvedValue({ data: row(), error: null });
  });
  it('reserva con INSERT y guarda únicamente IDs, versiones y métricas', async () => {
    const input = {
      ...reservation(),
      bodyText: 'private-body',
      raw: 'private-mime',
      recipient: 'private@example.invalid',
    };
    expect(await repo().reserve(input)).toMatchObject({
      acquired: true,
      record: { status: 'CREATING', threadId: 'thread21' },
    });
    const payload = query.insert.mock.calls[0][0];
    expect(payload).toMatchObject({
      user_id: profileWork.userId,
      gmail_account_id: profileWork.gmailAccountId,
      target_message_id: 'target21',
      prompt_version: 'mail020-v2',
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private|bodyText|recipient|raw/,
    );
  });
  it('un conflicto UNIQUE devuelve el intento previo sin sobrescribirlo', async () => {
    single.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'private-error' },
    });
    expect(await repo().reserve(reservation())).toMatchObject({
      acquired: false,
      record: { id: row().id },
    });
    expect(query.update).not.toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith('target_message_id', 'target21');
  });
  it('un intento incierto en el mismo hilo también impide reservar otro objetivo', async () => {
    single.mockResolvedValue({ data: null, error: { code: '23505' } });
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          ...row(),
          target_message_id: 'earlier-target',
          status: 'UNCERTAIN',
        },
        error: null,
      });
    expect(await repo().reserve(reservation())).toMatchObject({
      acquired: false,
      record: { status: 'UNCERTAIN' },
    });
    expect(query.in).toHaveBeenCalledWith('status', ['CREATING', 'UNCERTAIN']);
  });
  it('no interpreta otro fallo de SQL como permiso para crear', async () => {
    single.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'private-error' },
    });
    await expect(repo().reserve(reservation())).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'UNAVAILABLE',
    });
  });
  it('guarda los IDs de Google solo en la reserva que sigue CREATING y confirma por separado', async () => {
    await repo().created(row().id, 'r-draft', 'message21');
    expect(query.update).toHaveBeenCalledWith({
      status: 'CREATED',
      draft_id: 'r-draft',
      draft_message_id: 'message21',
    });
    expect(query.eq).toHaveBeenCalledWith('status', 'CREATING');
    await repo().verified(row().id);
    expect(query.eq).toHaveBeenCalledWith('status', 'CREATED');
    expect(query.eq).toHaveBeenCalledWith('user_id', profileWork.userId);
    expect(query.eq).toHaveBeenCalledWith(
      'gmail_account_id',
      profileWork.gmailAccountId,
    );
  });
  it('registra incertidumbre con IDs conocidos sin admitir texto libre', async () => {
    await repo().stop(row().id, 'UNCERTAIN', 'GMAIL_WRITE_UNCERTAIN', {
      draftId: 'r-draft',
      draftMessageId: 'message21',
    });
    expect(query.update).toHaveBeenCalledWith({
      status: 'UNCERTAIN',
      reason_code: 'GMAIL_WRITE_UNCERTAIN',
      draft_id: 'r-draft',
      draft_message_id: 'message21',
    });
    await expect(
      repo().stop(row().id, 'CANCELLED', 'PERSISTENCE_FAILED'),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('comprueba el propietario y la conexión en cada operación', async () => {
    account.mockResolvedValue(null);
    await expect(repo().reserve(reservation())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    account.mockResolvedValue({ status: 'DISCONNECTED' });
    await expect(repo().find('target21')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    user.mockResolvedValue({ status: 'DISABLED' });
    await expect(
      repo().created(row().id, 'draft', 'message'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(from).not.toHaveBeenCalled();
  });
  it.each([
    { id: 'bad' },
    { styleRevision: 'bad' },
    { threadId: '../other' },
    { inputTokens: -1 },
    { outputTokens: 1.5 },
    { model: 'private model' },
  ])('valida la reserva antes de tocar SQL: %o', async (extra) => {
    await expect(
      repo().reserve({ ...reservation(), ...extra }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(from).not.toHaveBeenCalled();
  });
  it('rechaza una fila de otro propietario o de otro objetivo aunque la devuelva un cliente privilegiado', async () => {
    maybeSingle.mockResolvedValue({
      data: { ...row(), user_id: 'other-owner' },
      error: null,
    });
    await expect(repo().find('target21')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    maybeSingle.mockResolvedValue({
      data: { ...row(), target_message_id: 'other-target' },
      error: null,
    });
    await expect(repo().find('target21')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });
  it('no da por guardado un ID si se pierde la reserva o falla el UPDATE', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(
      repo().created(row().id, 'r-draft', 'message'),
    ).rejects.toBeDefined();
    maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'private-error' },
    });
    await expect(
      repo().created(row().id, 'r-draft', 'message'),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
