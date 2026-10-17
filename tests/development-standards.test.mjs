import { describe, expect, it } from 'vitest';
import { assertBusinessChangesHaveTests } from '../scripts/check-test-changes.mjs';

describe('pruebas obligatorias para cambios de negocio', () => {
  it.each([
    'src/modules/policy/check.ts',
    'src/providers/gmail.ts',
    'src/worker/runtime.ts',
    'src/db/repositories.ts',
    'src/config/env.ts',
    'src/app/api/account/route.ts',
    'src/app/actions.ts',
    'src/app/_lib/auth.ts',
    'src/app/(auth)/actions.ts',
    'src/proxy.ts',
    'supabase/migrations/20261017000000_example.sql',
  ])('rechaza %s sin pruebas, incluso si solo se eliminan pruebas', (path) => {
    expect(() =>
      assertBusinessChangesHaveTests([
        { status: 'M', path },
        { status: 'D', path: 'tests/previous.test.ts' },
      ]),
    ).toThrow('deben incluir pruebas');
  });

  it.each([
    'src/modules/policy/check.test.ts',
    'tests/data-access.integration.ts',
    'supabase/tests/mail008_isolation.test.sql',
  ])('acepta cambios acompañados de %s', (path) => {
    expect(() =>
      assertBusinessChangesHaveTests([
        { status: 'M', path: 'src/modules/policy/check.ts' },
        { status: 'A', path },
      ]),
    ).not.toThrow();
  });

  it('no exige pruebas para estilos, tipos generados o configuración de herramientas', () => {
    expect(() =>
      assertBusinessChangesHaveTests([
        { status: 'M', path: 'src/app/globals.css' },
        { status: 'M', path: 'src/db/database.types.ts' },
        { status: 'M', path: 'vitest.config.mts' },
      ]),
    ).not.toThrow();
  });
});
