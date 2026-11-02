import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readPrivacyNotice, requirePrivacyNotice } from './config';
import { privacyOperationSchema, privacyNoticeVersion } from './notice';
import environment from '../../../tests/fixtures/privacy-env.json';

describe('MAIL-061 aviso y aceptación informada', () => {
  it('bloquea los permisos sin identidad, contacto, alojamiento, detalles o revisión', () => {
    for (const field of Object.keys(environment)) {
      const env = { ...environment, [field]: '' };
      expect(readPrivacyNotice(env).ready).toBe(false);
      expect(() => requirePrivacyNotice(env)).toThrow(
        'PRIVACY_CONFIGURATION_REQUIRED',
      );
    }
    expect(
      readPrivacyNotice({ ...environment, PRIVACY_REVIEW_APPROVED: 'false' })
        .ready,
    ).toBe(false);
    expect(
      readPrivacyNotice({ ...environment, PRIVACY_CONTACT_EMAIL: 'invalid' })
        .ready,
    ).toBe(false);
  });
  it('conserva exactamente el texto mostrado y distingue cambios de contenido y operador', () => {
    const notice = requirePrivacyNotice(environment);
    expect(notice.hash).toBe(
      createHash('sha256').update(notice.snapshot).digest('hex'),
    );
    expect(JSON.parse(notice.snapshot).sections).toEqual(notice.sections);
    expect(requirePrivacyNotice(environment).hash).toBe(notice.hash);
    expect(
      requirePrivacyNotice({
        ...environment,
        PRIVACY_OPERATOR_NAME: 'Otro operador',
      }).hash,
    ).not.toBe(notice.hash);
    expect(notice.snapshot).toContain('Limited Use');
    expect(notice.snapshot).toContain('OpenAI');
    expect(notice.snapshot).toContain('168 horas');
  });
  it('requiere acción explícita y rechaza versiones antiguas, falsos permisos y propietarios inyectados', () => {
    const valid = {
      action: 'grant',
      version: privacyNoticeVersion,
      noticeHash: 'a'.repeat(64),
      consent: true,
    };
    expect(privacyOperationSchema.safeParse(valid).success).toBe(true);
    for (const override of [
      { consent: false },
      { version: 'old' },
      { userId: crypto.randomUUID() },
      { consent: undefined },
      { noticeHash: 'invalid' },
    ]) {
      expect(
        privacyOperationSchema.safeParse({ ...valid, ...override }).success,
      ).toBe(false);
    }
    expect(
      privacyOperationSchema.safeParse({ action: 'withdraw' }).success,
    ).toBe(true);
  });
});
