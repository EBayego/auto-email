import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StyleLearningPanel } from './style-learning-panel';
import type {
  StyleLearningSnapshot,
  LearningProposal,
} from '@/modules/identity/style-learning';
const revision = crypto.randomUUID(),
  appliedRevision = crypto.randomUUID();
const proposal: LearningProposal = {
  id: crypto.randomUUID(),
  scope: { kind: 'GENERAL', key: '' },
  feature: 'greeting',
  category: 'NONE',
  status: 'PENDING',
  baseRevision: revision,
  appliedRevision: null,
  baseVersion: 1,
  appliedVersion: null,
  currentRevision: revision,
  support: 5,
  total: 6,
  threads: 4,
  days: 3,
  audiences: 3,
  automatic: false,
  createdAt: '2026-10-30T00:00:00Z',
  decidedAt: null,
  before: ['Hola'],
  after: [],
};
function render(
  proposals: LearningProposal[],
  enabled = false,
  disabled = false,
) {
  const initial: StyleLearningSnapshot = {
    settings: { enabled, revision: null, authorizedAt: null },
    proposals,
  };
  return renderToStaticMarkup(
    <StyleLearningPanel
      initial={initial}
      disabled={disabled}
      onChanged={vi.fn()}
    />,
  );
}
describe('MAIL-059 revisión del aprendizaje', () => {
  it('muestra la evidencia y pide confirmación por defecto', () => {
    const html = render([proposal]);
    expect(html).toContain('5 de 6 respuestas');
    expect(html).toContain('4 hilos');
    expect(html).toContain('Pendiente de confirmación');
    expect(html).toContain('Aceptar cambio');
    expect(html).toContain('Descartar propuesta');
    expect(html).toContain('Desactivada');
    expect(html).toContain('Autorizar la retirada automática');
  });
  it('ofrece revertir únicamente la última versión aplicada que sigue vigente', () => {
    const applied = {
      ...proposal,
      status: 'APPLIED' as const,
      appliedRevision,
      appliedVersion: 2,
      currentRevision: appliedRevision,
    };
    expect(render([applied])).toContain('Revertir a la versión anterior');
    expect(
      render([{ ...applied, currentRevision: crypto.randomUUID() }]),
    ).not.toContain('Revertir a la versión anterior');
  });
  it('no permite confirmar propuestas cuyo perfil ha cambiado', () => {
    const html = render([
      { ...proposal, currentRevision: crypto.randomUUID() },
    ]);
    expect(html).toContain('El perfil ha cambiado');
    expect(html).not.toContain('Aceptar cambio');
  });
  it('mantiene los controles deshabilitados mientras hay cambios de estilo pendientes', () => {
    expect(render([proposal], false, true)).toMatch(
      /disabled=""[^>]*>Aceptar cambio/,
    );
  });
  it('explica la ausencia de patrones sin inventar recomendaciones', () => {
    expect(render([])).toContain('Una única corrección no modifica tu perfil');
  });
});
