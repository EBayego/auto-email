'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DateTime, Panel } from '../components';
import { scopeLabel } from '@/modules/identity/style-editor';
import {
  learningChangeLabel,
  learningMessages,
  styleLearningSnapshotSchema,
  styleLearningVersion,
  type StyleLearningSnapshot,
  type StyleLearningOperation,
} from '@/modules/identity/style-learning';
export function StyleLearningPanel({
  disabled = false,
  onChanged,
  initial,
}: {
  disabled?: boolean;
  onChanged: () => Promise<void>;
  initial?: StyleLearningSnapshot;
}) {
  const [snapshot, setSnapshot] = useState<StyleLearningSnapshot | null>(
      initial ?? null,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false);
  async function load() {
    const response = await fetch('/api/learning/style', { cache: 'no-store' }),
      body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setSnapshot(styleLearningSnapshotSchema.parse(body));
  }
  useEffect(() => {
    if (initial) return;
    let active = true;
    void fetch('/api/learning/style', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        return styleLearningSnapshotSchema.parse(body);
      })
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setMessage(learningMessages.UNAVAILABLE);
      });
    return () => {
      active = false;
    };
  }, [initial]);
  async function submit(operation: StyleLearningOperation) {
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const response = await fetch('/api/learning/style', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(operation),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setSnapshot(styleLearningSnapshotSchema.parse(body));
      if (operation.action === 'accept' || operation.action === 'revert')
        await onChanged();
      setMessage(
        operation.action === 'settings'
          ? 'Autorización actualizada.'
          : operation.action === 'accept'
            ? 'Cambio aplicado en una nueva versión del perfil.'
            : operation.action === 'revert'
              ? 'Cambio revertido en una nueva versión del perfil.'
              : 'Propuesta descartada.',
      );
    } catch (error) {
      setFailed(true);
      setMessage(
        learningMessages[(error as Error).message] ??
          learningMessages.UNAVAILABLE,
      );
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Aprender de tus correcciones">
      <p className="description">
        Las propuestas se basan en cambios repetidos en varios hilos y días. El
        estilo general necesita además diversidad de destinatarios. Se excluyen
        los cambios de contenido y las posibles correcciones factuales.
      </p>
      <p className="description">
        Cada cambio aceptado crea una versión del perfil. Puedes revertir el
        último cambio mientras ese perfil siga vigente. Tus preferencias
        explícitas conservan su prioridad.
      </p>
      <p className="description">
        Para obtener comparaciones de nuevas generaciones, autoriza la
        conservación temporal del original en{' '}
        <Link className="text-link" href="/settings">
          Ajustes de comparación
        </Link>
        .
      </p>
      {message && (
        <p
          role={failed ? 'alert' : 'status'}
          className={failed ? 'form-error' : 'form-message'}
        >
          {message}
        </p>
      )}
      {!snapshot ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={busy || disabled}
          onClick={() =>
            void load().catch(() => {
              setFailed(true);
              setMessage(learningMessages.UNAVAILABLE);
            })
          }
        >
          Consultar propuestas
        </button>
      ) : (
        <>
          <fieldset disabled={busy || disabled}>
            <legend>Aplicación automática</legend>
            <p className="description">
              Solo permite retirar saludos o despedidas a partir de nuevas
              correcciones repetidas. Los demás cambios siempre necesitan tu
              confirmación. Esta autorización se desactiva al desconectar Gmail
              o borrar tu perfil.
            </p>
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                void submit({
                  action: 'settings',
                  enabled: !snapshot.settings.enabled,
                  expectedRevision: snapshot.settings.revision,
                  noticeVersion: styleLearningVersion,
                })
              }
            >
              {snapshot.settings.enabled
                ? 'Desactivar ajustes automáticos'
                : 'Autorizar la retirada automática de saludos y despedidas'}
            </button>
            <p>
              {snapshot.settings.enabled ? 'Autorizada desde ' : 'Desactivada'}
              {snapshot.settings.authorizedAt && (
                <DateTime value={snapshot.settings.authorizedAt} />
              )}
            </p>
          </fieldset>
          {!snapshot.proposals.length ? (
            <p>
              Todavía no hay patrones con evidencia suficiente. Una única
              corrección no modifica tu perfil.
            </p>
          ) : (
            <ul className="style-learning-list">
              {snapshot.proposals.map((proposal) => {
                const pending =
                  proposal.status === 'PENDING' &&
                  proposal.currentRevision === proposal.baseRevision;
                const revert =
                  proposal.status === 'APPLIED' &&
                  proposal.currentRevision === proposal.appliedRevision;
                return (
                  <li key={proposal.id}>
                    <h3>{learningChangeLabel(proposal)}</h3>
                    <p>
                      {scopeLabel(proposal.scope)} · {proposal.support} de{' '}
                      {proposal.total} respuestas · {proposal.threads} hilos ·{' '}
                      {proposal.days} días
                    </p>
                    <p>
                      Antes:{' '}
                      {proposal.before?.length
                        ? proposal.before.join(' · ')
                        : 'Sin fórmula'}{' '}
                      → Propuesta:{' '}
                      {proposal.after.length
                        ? proposal.after.join(' · ')
                        : 'Sin fórmula'}
                    </p>
                    <p>
                      {proposal.status === 'PENDING'
                        ? pending
                          ? 'Pendiente de confirmación'
                          : 'El perfil ha cambiado'
                        : proposal.status === 'APPLIED'
                          ? `Aplicada ${proposal.automatic ? 'automáticamente' : 'con tu confirmación'} · versión ${proposal.appliedVersion}`
                          : proposal.status === 'REVERTED'
                            ? 'Revertida'
                            : proposal.status === 'REJECTED'
                              ? 'Descartada'
                              : 'Ya no vigente'}
                    </p>
                    {pending && (
                      <>
                        <button
                          className="button"
                          type="button"
                          disabled={busy || disabled}
                          onClick={() =>
                            void submit({
                              action: 'accept',
                              proposalId: proposal.id,
                              expectedRevision: proposal.currentRevision,
                            })
                          }
                        >
                          Aceptar cambio
                        </button>{' '}
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={busy || disabled}
                          onClick={() =>
                            void submit({
                              action: 'reject',
                              proposalId: proposal.id,
                              expectedRevision: proposal.currentRevision,
                            })
                          }
                        >
                          Descartar propuesta
                        </button>
                      </>
                    )}
                    {revert && (
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={busy || disabled}
                        onClick={() =>
                          void submit({
                            action: 'revert',
                            proposalId: proposal.id,
                            expectedRevision: proposal.currentRevision,
                          })
                        }
                      >
                        Revertir a la versión anterior
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
