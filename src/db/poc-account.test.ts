import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataClient } from './models';
import { createOwnerRepositories } from './repositories';
import { resolvePocAccount } from './poc-account';

vi.mock('./repositories', () => ({ createOwnerRepositories: vi.fn() }));
const userId = '00000000-0000-4000-8000-000000000001';
const accountId = '00000000-0000-4000-8000-000000000002';
const profile = vi.fn();
const account = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
const client = { from } as unknown as DataClient;
describe('selección explícita de cuenta para PoC local', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingle.mockResolvedValue({
      data: { id: accountId, user_id: userId },
      error: null,
    });
    profile.mockResolvedValue({ id: userId, status: 'ACTIVE' });
    account.mockResolvedValue({
      id: accountId,
      user_id: userId,
      status: 'CONNECTED',
      email: 'owner@example.invalid',
    });
    vi.mocked(createOwnerRepositories).mockReturnValue({
      users: { get: profile },
      gmailAccounts: { findById: account },
    } as unknown as ReturnType<typeof createOwnerRepositories>);
  });
  it('resuelve solo el email seleccionado y revalida propietario y estado', async () => {
    expect(
      await resolvePocAccount(client, 'Owner@example.invalid'),
    ).toMatchObject({ work: { userId, gmailAccountId: accountId } });
    expect(eq).toHaveBeenCalledWith('email', 'owner@example.invalid');
    expect(createOwnerRepositories).toHaveBeenCalledWith(client, userId);
    expect(account).toHaveBeenCalledWith(accountId);
  });
  it('rechaza una cuenta inexistente, deshabilitada o desconectada', async () => {
    profile.mockResolvedValue({ id: userId, status: 'DISABLED' });
    await expect(
      resolvePocAccount(client, 'owner@example.invalid'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    profile.mockResolvedValue({ id: userId, status: 'ACTIVE' });
    account.mockResolvedValue({ status: 'DISCONNECTED' });
    await expect(
      resolvePocAccount(client, 'owner@example.invalid'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Deletion of local references is still possible after disconnecting Gmail.
    await expect(
      resolvePocAccount(client, 'owner@example.invalid', false),
    ).resolves.toBeDefined();
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(
      resolvePocAccount(client, 'owner@example.invalid'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rechaza entradas inválidas antes de acceder a la base y categoriza fallos de consulta', async () => {
    await expect(resolvePocAccount(client, 'bad')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(from).not.toHaveBeenCalled();
    maybeSingle.mockResolvedValue({ data: null, error: { private: 'secret' } });
    await expect(
      resolvePocAccount(client, 'owner@example.invalid'),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
