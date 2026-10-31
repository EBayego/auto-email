import { describe, it, expect } from 'vitest';
import {
  activityReason,
  gmailConversationUrl,
  activityQuerySchema,
  activityFeedSchema,
} from './activity';
import { activityFeedFixture } from '../../../tests/fixtures/activity';
describe('MAIL-054 contratos de actividad', () => {
  it('admite filtros tipados y un cursor completo sin convertir ni truncar fechas', () => {
    expect(activityQuerySchema.parse({})).toEqual({ status: 'ALL' });
    const value = {
      status: 'FAILED',
      before: '2026-10-31T10:00:00.123456Z',
      beforeId: crypto.randomUUID(),
    };
    expect(activityQuerySchema.parse(value)).toEqual(value);
  });
  it.each([
    { status: 'SEND_ALL' },
    { before: '2026-10-31T10:00:00Z' },
    { beforeId: crypto.randomUUID() },
    { before: 'bad', beforeId: crypto.randomUUID() },
    { userId: crypto.randomUUID() },
  ])('rechaza filtros inválidos %j', (input) =>
    expect(activityQuerySchema.safeParse(input).success).toBe(false),
  );
  it('no muestra errores internos ni códigos desconocidos como texto', () => {
    expect(activityReason('EXCLUDED_DOMAIN')).toContain('dominio');
    expect(activityReason('POLICY_CHANGED')).toContain('cambiaron');
    expect(activityReason('SECRET_TOKEN_ABC')).not.toContain(
      'SECRET_TOKEN_ABC',
    );
    expect(activityReason('SYNC_GOOGLE_TIMEOUT_ATTEMPTS')).toContain(
      'servicio externo',
    );
  });
  it('genera enlaces acotados a Gmail con la cuenta correcta y sin URL arbitraria', () => {
    const link = new URL(
      gmailConversationUrl('owner+tag@example.invalid', '18b7a010cd')!,
    );
    expect(link.origin).toBe('https://mail.google.com');
    expect(link.searchParams.get('authuser')).toBe('owner+tag@example.invalid');
    expect(link.hash).toBe('#all/18b7a010cd');
    expect(gmailConversationUrl(null, '18b7a010cd')).toBeNull();
    expect(gmailConversationUrl('bad', 'thread')).toBeNull();
    expect(
      gmailConversationUrl('owner@example.invalid', 'https://evil.invalid'),
    ).toBeNull();
  });
  it('rechaza datos inesperados en las respuestas del repositorio', () => {
    const { nextCursor: _next, ...value } = activityFeedFixture();
    void _next;
    expect(activityFeedSchema.safeParse(value).success).toBe(true);
    expect(
      activityFeedSchema.safeParse({ ...value, body: 'private email' }).success,
    ).toBe(false);
  });
});
