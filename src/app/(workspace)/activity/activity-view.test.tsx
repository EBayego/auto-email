import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityView, ActivityDetailView } from './activity-view';
import {
  activityDetailFixture,
  activityFeedFixture,
} from '../../../../tests/fixtures/activity';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
describe('MAIL-054 panel de actividad', () => {
  it('explica resultados, estado y errores sin renderizar códigos internos', () => {
    const html = renderToStaticMarkup(
      <ActivityView feed={activityFeedFixture()} query={{ status: 'ALL' }} />,
    );
    expect(html).toContain('Automatización activada');
    expect(html).toContain('El remitente está excluido.');
    expect(html).toContain('servicio externo');
    expect(html).not.toContain('SYNC_GOOGLE_TIMEOUT_ATTEMPTS');
    expect(html).toContain('Ver detalle');
    expect(html).toContain('authuser=owner%40example.invalid');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('EXCLUDED_SENDER');
  });
  it('conserva filtro y cursor al avanzar y permite volver a los recientes', () => {
    const feed = activityFeedFixture();
    feed.nextCursor = {
      before: '2026-10-31T10:00:00.123456Z',
      beforeId: crypto.randomUUID(),
    };
    const html = renderToStaticMarkup(
      <ActivityView
        feed={feed}
        query={{
          status: 'SKIPPED',
          before: '2026-10-31T11:00:00Z',
          beforeId: crypto.randomUUID(),
        }}
      />,
    );
    expect(html).toContain(
      'status=SKIPPED&amp;before=2026-10-31T10%3A00%3A00.123456Z',
    );
    expect(html).toContain('Volver a los mensajes recientes');
  });
  it('distingue un filtro vacío y la conexión pausada', () => {
    const feed = activityFeedFixture();
    feed.jobs = [];
    feed.overview.accountStatus = 'PAUSED';
    const html = renderToStaticMarkup(
      <ActivityView feed={feed} query={{ status: 'FAILED' }} />,
    );
    expect(html).toContain('Cuenta Gmail en pausa');
    expect(html).toContain('No hay registros que coincidan');
    expect(html).not.toContain('Automatización activada');
  });
  it('explica fuentes ausentes y advertencias, sin enseñar referencias históricas ni fragmentos', () => {
    const detail = activityDetailFixture();
    detail.job.draft = {
      status: 'CREATED',
      draftId: 'draft54',
      verifiedAt: null,
      reconciliation: 'MISSING',
      createdAt: detail.job.createdAt,
      updatedAt: detail.job.updatedAt,
      warnings: ['HUMAN_REVIEW_REQUIRED'],
    };
    detail.sources = [
      { kind: 'HISTORICAL_MESSAGE' },
      {
        kind: 'KNOWLEDGE_FRAGMENT',
        sourceTitle: null,
        documentName: null,
        version: 1,
        currentVersion: null,
        available: false,
      },
    ];
    const html = renderToStaticMarkup(
      <ActivityDetailView detail={detail} email="owner@example.invalid" />,
    );
    expect(html).toContain('Fuente eliminada o no disponible');
    expect(html).toContain('Contexto histórico autorizado');
    expect(html).toContain('Revisa el borrador en Gmail');
    expect(html).toContain('Puede haberse enviado o eliminado');
    expect(html).not.toContain('HUMAN_REVIEW_REQUIRED');
  });
});
