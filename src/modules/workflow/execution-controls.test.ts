import { describe, expect, it } from 'vitest';
import { parseExecutionForm } from './execution-controls';

describe('MAIL-035 configuración de ejecución', () => {
  it.each(['pause', 'resume', 'run'])(
    'acepta la acción %s sin identidades del cliente',
    (action) => {
      expect(parseExecutionForm(new URLSearchParams({ action }))).toEqual({
        action,
      });
    },
  );
  it('valida los ajustes y permite cero borradores o desactivar el sistema', () => {
    expect(
      parseExecutionForm(
        new URLSearchParams({
          action: 'settings',
          pollIntervalSeconds: '60',
          maxDailyDrafts: '0',
        }),
      ),
    ).toEqual({
      action: 'settings',
      settings: {
        automationEnabled: false,
        pollIntervalSeconds: 60,
        maxDailyDrafts: 0,
      },
    });
    expect(
      parseExecutionForm(
        new URLSearchParams({
          action: 'settings',
          automationEnabled: 'true',
          pollIntervalSeconds: '300',
          maxDailyDrafts: '30',
        }),
      ),
    ).toMatchObject({ settings: { automationEnabled: true } });
  });
  it.each([
    'action=run&userId=other',
    'action=run&action=pause',
    'action=resume&accountId=other',
    'action=delete',
    'action=settings&automationEnabled=false&pollIntervalSeconds=300&maxDailyDrafts=30',
    'action=settings&pollIntervalSeconds=59&maxDailyDrafts=30',
    'action=settings&pollIntervalSeconds=86401&maxDailyDrafts=30',
    'action=settings&pollIntervalSeconds=300&maxDailyDrafts=-1',
    'action=settings&pollIntervalSeconds=300&maxDailyDrafts=1001',
    'action=settings&pollIntervalSeconds=3e2&maxDailyDrafts=30',
    'action=settings&pollIntervalSeconds=300&maxDailyDrafts=',
  ])('rechaza peticiones ambiguas o inválidas: %s', (form) => {
    expect(() => parseExecutionForm(new URLSearchParams(form))).toThrow(
      'INVALID_INPUT',
    );
  });
});
