import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StyleScreen } from './style-screen';
import type { StyleEditorSnapshot } from '@/modules/identity/style-editor';
import {
  writingProfileFixture,
  legacyWritingProfileFixture,
} from '../../../../tests/fixtures/writing-profile';

const revision = crypto.randomUUID();
const snapshot: StyleEditorSnapshot = {
  generalRevision: revision,
  profiles: [
    {
      scope: { kind: 'GENERAL', key: '' },
      revision,
      parentRevision: null,
      version: 1,
      generatedAt: '2026-10-31T09:00:00Z',
      sampleSize: 30,
      reviewed: false,
      profile: writingProfileFixture(),
      current: true,
      inactiveReason: null,
    },
  ],
  preferences: [],
};
describe('MAIL-052 pantalla de perfil y preferencias', () => {
  it('presenta rasgos observados y requiere revisar el perfil antes de confirmarlo', () => {
    const html = renderToStaticMarkup(<StyleScreen initial={snapshot} />);
    expect(html).toContain('Estilo directo, cordial y poco ceremonioso.');
    expect(html).toContain(
      'Párrafos breves con petición directa y cierre cordial.',
    );
    expect(html).toContain('Saludos habituales');
    expect(html).toContain('Pendiente de revisión');
    expect(
      html.match(/<button[^>]*>Confirmar perfil de escritura<\/button>/)?.[0],
    ).toContain('disabled');
    expect(html).toContain('Todavía no hay perfiles específicos');
  });
  it('distingue preferencias explícitas y rasgos aprendidos', () => {
    const html = renderToStaticMarkup(
      <StyleScreen
        initial={{
          ...snapshot,
          preferences: [
            {
              scope: { kind: 'GENERAL', key: '' },
              preference: { key: 'length', value: 'long' },
              origin: 'EXPLICIT',
              revision: crypto.randomUUID(),
            },
          ],
        }}
      />,
    );
    expect(html).toContain('Restaurar preferencias de este ámbito');
    expect(html).toContain('Longitud habitual');
    expect(html).toContain('Breve');
    expect(html).toMatch(
      /<option value="long" selected="">Detallada<\/option>/,
    );
  });
  it('muestra las variaciones por tipo de destinatario y distingue los perfiles no vigentes', () => {
    const html = renderToStaticMarkup(
      <StyleScreen
        initial={{
          ...snapshot,
          profiles: [
            ...snapshot.profiles,
            {
              ...snapshot.profiles[0],
              scope: { kind: 'RELATIONSHIP', key: 'CLIENT' },
              revision: crypto.randomUUID(),
              parentRevision: revision,
              current: false,
              inactiveReason: 'RULES_CHANGED',
              profile: {
                ...writingProfileFixture(),
                formality: 'high',
                average_length: 'long',
              },
            },
          ],
        }}
      />,
    );
    expect(html).toContain('Clientes');
    expect(html).toContain('Comparación del estilo general');
    expect(html).toContain('No vigente');
    expect(html).toContain('Alta');
  });
  it('no inventa observaciones que falten en perfiles antiguos', () => {
    const html = renderToStaticMarkup(
      <StyleScreen
        initial={{
          ...snapshot,
          profiles: [
            {
              ...snapshot.profiles[0],
              profile: legacyWritingProfileFixture(),
              reviewed: true,
            },
          ],
        }}
      />,
    );
    expect(html).toContain('No disponible en este perfil');
    expect(html).not.toContain('Confirmar perfil de escritura');
  });
});
