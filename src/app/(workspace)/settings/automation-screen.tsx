'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type {
  AutomationSettings,
  AutomationSnapshot,
} from '@/modules/workflow/automation-settings';
import {
  applyRestrictionInstructions,
  intentLabels,
  requirementLabels,
  scopeLabels,
  settingsMessages,
  splitSettingsList,
} from '@/modules/workflow/automation-form';
import type { SourceConfiguration } from '@/modules/source-router/sources';
import { Panel, StatusBadge } from '../components';

type Lists = {
  addresses: string;
  domains: string;
  topics: string;
  blockedSenders: string;
  blockedDomains: string;
};
const listsFor = (settings: AutomationSettings): Lists => ({
  addresses: settings.excludedAddresses.join('\n'),
  domains: settings.excludedDomains.join('\n'),
  topics: settings.policy.blockedTopics.join('\n'),
  blockedSenders: settings.policy.blockedSenders.join('\n'),
  blockedDomains: settings.policy.blockedDomains.join('\n'),
});
export function AutomationScreen({
  initial,
  sources,
  connected,
}: {
  initial: AutomationSnapshot;
  sources: SourceConfiguration | null;
  connected: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initial),
    [settings, setSettings] = useState(initial.settings),
    [lists, setLists] = useState(() => listsFor(initial.settings));
  const [instructions, setInstructions] = useState(''),
    [note, setNote] = useState(''),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false),
    [stale, setStale] = useState(false),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const changed = () => {
    setDirty(true);
    setMessage('');
    setNote('');
  };
  const assembled = (): AutomationSettings => ({
    ...settings,
    excludedAddresses: splitSettingsList(lists.addresses),
    excludedDomains: splitSettingsList(lists.domains),
    policy: {
      ...settings.policy,
      blockedTopics: splitSettingsList(lists.topics),
      blockedSenders: splitSettingsList(lists.blockedSenders),
      blockedDomains: splitSettingsList(lists.blockedDomains),
    },
  });
  function adopt(value: AutomationSnapshot) {
    setSnapshot(value);
    setSettings(value.settings);
    setLists(listsFor(value.settings));
    setInstructions('');
    setDirty(false);
    setStale(false);
    setNote('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    setMessage('');
    try {
      const response = await fetch('/api/automation/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          revision: snapshot.revision,
          settings: assembled(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      adopt(body);
      setMessage(
        'Configuración guardada. Se aplicará a los siguientes correos.',
      );
    } catch (error) {
      const code = (error as Error).message;
      setError(true);
      setStale(code === 'SETTINGS_CHANGED');
      setMessage(settingsMessages[code] ?? settingsMessages.UNAVAILABLE);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch('/api/automation/settings', {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      adopt(body);
      setMessage('Configuración recargada.');
    } catch {
      setError(true);
      setMessage('No se puede recargar la configuración. Vuelve a intentarlo.');
    } finally {
      setBusy(false);
    }
  }
  const updateList = (key: keyof Lists, value: string) => {
    changed();
    setLists({ ...lists, [key]: value });
  };
  const disabled = busy || stale;
  return (
    <form
      onSubmit={save}
      className="automation-settings"
      aria-label="Configuración de automatización"
    >
      <fieldset disabled={disabled} className="settings-fieldset">
        <legend className="sr-only">Automatización y restricciones</legend>
        <Panel title="Automatización y límites">
          <StatusBadge
            tone={
              snapshot.settings.execution.automationEnabled && connected
                ? 'success'
                : 'neutral'
            }
          >
            {snapshot.settings.execution.automationEnabled && connected
              ? 'Automatización activada'
              : 'Automatización en pausa'}
          </StatusBadge>
          <label className="settings-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={settings.execution.automationEnabled}
              onChange={(event) => {
                changed();
                setSettings({
                  ...settings,
                  execution: {
                    ...settings.execution,
                    automationEnabled: event.target.checked,
                  },
                });
              }}
            />
            Activar automatización
          </label>
          <p className="description">
            El cambio se aplica al guardar. Al pausarla también se detienen las
            revisiones manuales pendientes. El asistente prepara borradores; tú
            los revisas y envías desde Gmail.
          </p>
          {!connected && (
            <p className="form-message">
              La conexión Gmail debe estar activa para procesar correos. Puedes
              preparar y guardar los ajustes mientras tanto.
            </p>
          )}
          <div className="settings-fields">
            <label>
              Intervalo de comprobación (segundos)
              <input
                type="number"
                min={60}
                max={86400}
                required
                value={settings.execution.pollIntervalSeconds}
                onChange={(event) => {
                  changed();
                  setSettings({
                    ...settings,
                    execution: {
                      ...settings.execution,
                      pollIntervalSeconds: Number(event.target.value),
                    },
                  });
                }}
              />
            </label>
            <label>
              Límite de borradores por día (UTC)
              <input
                type="number"
                min={0}
                max={1000}
                required
                value={settings.execution.maxDailyDrafts}
                onChange={(event) => {
                  changed();
                  setSettings({
                    ...settings,
                    execution: {
                      ...settings.execution,
                      maxDailyDrafts: Number(event.target.value),
                    },
                  });
                }}
              />
            </label>
          </div>
          <p className="description">
            Un límite de 0 impide crear borradores, incluidas las revisiones
            manuales.
          </p>
        </Panel>
        <Panel title="Qué correos puede procesar">
          <label>
            Selección de mensajes
            <select
              value={settings.processingScope}
              onChange={(event) => {
                changed();
                setSettings({
                  ...settings,
                  processingScope: event.target
                    .value as AutomationSettings['processingScope'],
                });
              }}
            >
              {Object.entries(scopeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="description">
            La selección se comprueba al analizar el mensaje y antes de crear el
            borrador. Los mensajes omitidos no se reprocesan al ampliar la
            selección. Spam, papelera, boletines y respuestas automáticas siguen
            excluidos.
          </p>
          <fieldset className="settings-checks">
            <legend>Tipos de correo permitidos</legend>
            {Object.entries(intentLabels).map(([value, label]) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={
                    !settings.policy.blockedCategories.includes(
                      value as keyof typeof intentLabels,
                    )
                  }
                  onChange={(event) => {
                    changed();
                    const kind = value as keyof typeof intentLabels;
                    setSettings({
                      ...settings,
                      policy: {
                        ...settings.policy,
                        blockedCategories: event.target.checked
                          ? settings.policy.blockedCategories.filter(
                              (item) => item !== kind,
                            )
                          : [...settings.policy.blockedCategories, kind],
                      },
                    });
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p className="description">
            Permitir un tipo no obliga a generar una respuesta: los asuntos
            sensibles y la falta de evidencia requieren revisión.
          </p>
          <div className="settings-fields">
            <label>
              Remitentes excluidos
              <textarea
                rows={4}
                maxLength={26000}
                value={lists.addresses}
                onChange={(event) =>
                  updateList('addresses', event.target.value)
                }
                placeholder="avisos@ejemplo.com"
              />
            </label>
            <label>
              Dominios excluidos
              <textarea
                rows={4}
                maxLength={26000}
                value={lists.domains}
                onChange={(event) => updateList('domains', event.target.value)}
                placeholder="ejemplo.com"
              />
            </label>
          </div>
          <p className="description">
            Hasta 100 entradas por lista, separadas por líneas o comas. Usa
            direcciones completas y dominios sin @, rutas ni comodines. Se
            excluye el dominio exacto; añade sus subdominios si también quieres
            excluirlos.
          </p>
        </Panel>
        <Panel title="Restricciones e instrucciones">
          <label>
            Temas sobre los que no responder
            <textarea
              rows={3}
              maxLength={3000}
              value={lists.topics}
              onChange={(event) => updateList('topics', event.target.value)}
              placeholder={'descuentos\ncontratación'}
            />
          </label>
          <p className="description">
            Hasta 30 temas de 80 caracteres. Usa una frase por línea. Si el
            correo trata uno de estos temas, se bloquea la propuesta.
          </p>
          <label>
            Instrucciones personalizadas
            <textarea
              rows={3}
              maxLength={2000}
              value={instructions}
              onChange={(event) => {
                changed();
                setInstructions(event.target.value);
              }}
              placeholder="No responder sobre descuentos"
            />
          </label>
          <p className="description">
            Puedes escribir «No responder sobre descuentos», «Excluir remitente
            avisos@ejemplo.com» o «Excluir dominio ejemplo.com». Una instrucción
            por línea. Se añadirán a las restricciones del formulario para que
            puedas revisarlas antes de guardar. Para tono, saludos o idioma,
            utiliza <Link href="/style">Mi estilo</Link>.
          </p>
          <button
            type="button"
            className="button button-secondary"
            disabled={!instructions.trim()}
            onClick={() => {
              try {
                const next = applyRestrictionInstructions(
                  instructions,
                  assembled(),
                );
                setSettings(next);
                setLists(listsFor(next));
                setInstructions('');
                setNote(
                  'Instrucciones aplicadas al formulario. Guarda para utilizarlas.',
                );
              } catch {
                setNote(
                  'No se ha podido interpretar alguna instrucción. Usa los ejemplos indicados; no se ha aplicado ningún cambio parcial.',
                );
              }
            }}
          >
            Aplicar instrucciones a las restricciones
          </button>
          {note && (
            <p role="status" className="form-message">
              {note}
            </p>
          )}
          <details className="settings-requirements">
            <summary>Fuentes obligatorias y bloqueos adicionales</summary>
            <p className="description">
              Exige evidencia de fuentes concretas para los siguientes datos. Si
              faltan, están desactivadas o no respaldan la respuesta, el
              asistente se abstiene.
            </p>
            {!sources && (
              <p className="form-message">
                No se pueden cargar las fuentes. Se conservan los requisitos
                actuales; recarga la página para editarlos.
              </p>
            )}
            {sources &&
              Object.entries(requirementLabels).map(([kind, label]) => {
                const selected =
                  settings.policy.sourceRequirements.find(
                    (item) => item.kind === kind,
                  )?.sourceIds ?? [];
                const missing = selected.filter(
                  (id) => !sources.sources.some((source) => source.id === id),
                );
                return (
                  <fieldset className="settings-checks" key={kind}>
                    <legend>
                      Fuente obligatoria para {label.toLowerCase()}
                    </legend>
                    {sources.sources.map((source) => (
                      <label key={source.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(source.id)}
                          onChange={(event) => {
                            changed();
                            const ids = event.target.checked
                              ? [...selected, source.id]
                              : selected.filter((id) => id !== source.id);
                            setSettings({
                              ...settings,
                              policy: {
                                ...settings.policy,
                                sourceRequirements: [
                                  ...settings.policy.sourceRequirements.filter(
                                    (item) => item.kind !== kind,
                                  ),
                                  ...(ids.length
                                    ? [
                                        {
                                          kind: kind as keyof typeof requirementLabels,
                                          sourceIds: ids,
                                        },
                                      ]
                                    : []),
                                ],
                              },
                            });
                          }}
                        />
                        {source.title}
                        {!source.enabled ? ' (desactivada)' : ''}
                      </label>
                    ))}
                    {!sources.sources.length && (
                      <p className="description">
                        Crea una fuente en la sección de documentos para poder
                        seleccionarla.
                      </p>
                    )}
                    {missing.map((id) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked
                          onChange={() => {
                            changed();
                            const ids = selected.filter((item) => item !== id);
                            setSettings({
                              ...settings,
                              policy: {
                                ...settings.policy,
                                sourceRequirements: [
                                  ...settings.policy.sourceRequirements.filter(
                                    (item) => item.kind !== kind,
                                  ),
                                  ...(ids.length
                                    ? [
                                        {
                                          kind: kind as keyof typeof requirementLabels,
                                          sourceIds: ids,
                                        },
                                      ]
                                    : []),
                                ],
                              },
                            });
                          }}
                        />
                        Fuente eliminada: retirar requisito
                      </label>
                    ))}
                  </fieldset>
                );
              })}
            <div className="settings-fields">
              <label>
                Bloquear respuestas a estas direcciones
                <textarea
                  rows={3}
                  maxLength={13000}
                  value={lists.blockedSenders}
                  onChange={(event) =>
                    updateList('blockedSenders', event.target.value)
                  }
                />
              </label>
              <label>
                Bloquear respuestas a estos dominios
                <textarea
                  rows={3}
                  maxLength={13000}
                  value={lists.blockedDomains}
                  onChange={(event) =>
                    updateList('blockedDomains', event.target.value)
                  }
                />
              </label>
            </div>
            <p className="description">
              Hasta 50 entradas por lista. Estos bloqueos también se comprueban
              al preparar la respuesta, aunque el correo ya estuviera en
              proceso.
            </p>
          </details>
        </Panel>
      </fieldset>
      <div className="workspace-panel settings-save">
        {instructions.trim() && (
          <p className="description">
            Aplica las instrucciones al formulario o vacía el campo antes de
            guardar.
          </p>
        )}
        {message && (
          <p
            role={error ? 'alert' : 'status'}
            className={error ? 'form-error' : 'form-message'}
          >
            {message}
          </p>
        )}
        <div className="workspace-actions">
          <button
            className="button"
            type="submit"
            disabled={disabled || !dirty || !!instructions.trim()}
          >
            {busy ? 'Guardando…' : 'Guardar configuración'}
          </button>
          {dirty && !stale && (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => {
                adopt(snapshot);
                setMessage('Cambios locales descartados.');
                setError(false);
              }}
            >
              Descartar cambios locales
            </button>
          )}
          {stale && (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void reload()}
            >
              Recargar y descartar cambios locales
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
