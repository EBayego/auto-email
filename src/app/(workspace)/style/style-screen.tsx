'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { DateTime, Panel, StatusBadge } from '../components';
import {
  emptyPreferenceDraft,
  parseEditorInstructions,
  readableStyleValue,
  scopeIdentity,
  scopeLabel,
  styleEditorMessages,
  styleFields,
  type PreferenceDraft,
  type StyleEditorOperation,
  type StyleEditorSnapshot,
  type StyleProfileView,
} from '@/modules/identity/style-editor';
import {
  validatePreferenceSet,
  type StoredStylePreference,
} from '@/modules/identity/style-preferences';
import type { StyleScope } from '@/modules/identity/contextual-style';

export function StyleScreen({ initial }: { initial: StyleEditorSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [selected, setSelected] = useState(
    scopeIdentity({ kind: 'GENERAL', key: '' }),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [stale, setStale] = useState(false);
  const [lastAction, setLastAction] = useState('');
  const scopes = new Map(
    snapshot.profiles.map((view) => [scopeIdentity(view.scope), view.scope]),
  );
  for (const row of snapshot.preferences)
    scopes.set(scopeIdentity(row.scope), row.scope);
  const chosen = scopes.get(selected) ?? {
    kind: 'GENERAL' as const,
    key: '' as const,
  };
  const profile = snapshot.profiles.find(
    (view) => scopeIdentity(view.scope) === scopeIdentity(chosen),
  );
  const general = snapshot.profiles.find(
    (view) => view.scope.kind === 'GENERAL',
  )!;
  const prefs = snapshot.preferences.filter(
    (row) => scopeIdentity(row.scope) === scopeIdentity(chosen),
  );
  async function response(response: Response) {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    if (!body.style) throw new Error('STYLE_PROFILE_REQUIRED');
    setSnapshot(body.style);
    setDirty(false);
    setStale(false);
    setGeneration((value) => value + 1);
  }
  async function reload() {
    setLastAction('reload');
    setBusy(true);
    setMessage('');
    setError(false);
    try {
      await response(await fetch('/api/style', { cache: 'no-store' }));
      setMessage('Configuración recargada.');
    } catch (error) {
      setError(true);
      setMessage(
        styleEditorMessages[(error as Error).message] ??
          styleEditorMessages.UNAVAILABLE,
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(operation: StyleEditorOperation) {
    setLastAction(operation.action);
    setBusy(true);
    setMessage('');
    setError(false);
    try {
      await response(
        await fetch('/api/style', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(operation),
        }),
      );
      setMessage(
        operation.action === 'confirm'
          ? 'Perfil revisado. Ya puede utilizarse en las siguientes respuestas.'
          : operation.action === 'restore'
            ? 'Ajustes de este ámbito restaurados. Se aplicarán el perfil aprendido y las preferencias heredadas.'
            : 'Preferencias guardadas. Se aplicarán a las siguientes respuestas generadas.',
      );
    } catch (error) {
      setError(true);
      const code = (error as Error).message;
      setStale(
        [
          'STALE_STYLE',
          'STALE_PREFERENCE',
          'CONTEXT_NOT_CURRENT',
          'GENERAL_PROFILE_REQUIRED',
        ].includes(code),
      );
      setMessage(styleEditorMessages[code] ?? styleEditorMessages.UNAVAILABLE);
    } finally {
      setBusy(false);
    }
  }
  const notice = message ? (
    <>
      <p
        role={error ? 'alert' : 'status'}
        aria-live="polite"
        className={error ? 'form-error' : 'form-message'}
      >
        {message}
      </p>
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
    </>
  ) : null;
  return (
    <>
      <Panel title="Tu estilo por destinatario">
        <label className="style-scope-label">
          Perfil o ámbito que quieres consultar
          <select
            value={scopeIdentity(chosen)}
            disabled={busy || dirty}
            onChange={(event) => {
              if (dirty) {
                setMessage(
                  'Guarda o descarta los cambios de este ámbito antes de cambiar a otro.',
                );
                return;
              }
              setSelected(event.target.value);
              setMessage('');
              setStale(false);
            }}
          >
            {[...scopes.entries()]
              .sort(([a], [b]) =>
                a.includes('GENERAL')
                  ? -1
                  : b.includes('GENERAL')
                    ? 1
                    : a.localeCompare(b),
              )
              .map(([key, scope]) => (
                <option key={key} value={key}>
                  {scopeLabel(scope)}
                </option>
              ))}
          </select>
        </label>
        {dirty && (
          <p className="description">
            Guarda o descarta los cambios antes de cambiar de ámbito.
          </p>
        )}
        <p className="description">
          Las preferencias explícitas tienen prioridad sobre el estilo
          aprendido. Si coinciden varios ámbitos, se aplican las del
          destinatario, tipo de relación, dominio y estilo general, en ese
          orden.
        </p>
        <p className="description">
          Estos cambios se aplican a nuevas respuestas. Los borradores ya
          existentes en Gmail no se reescriben.
        </p>
      </Panel>
      <LearnedProfile view={profile ?? general} inherited={!profile} />
      <PreferenceEditor
        key={`${generation}:${scopeIdentity(chosen)}:${snapshot.generalRevision}:${profile?.revision ?? ''}:${profile?.reviewed}:${prefs
          .map((row) => row.revision)
          .sort()
          .join(',')}`}
        scope={chosen}
        profile={profile}
        generalRevision={snapshot.generalRevision}
        preferences={prefs}
        disabled={busy || stale}
        onDirty={setDirty}
        submit={submit}
        notice={lastAction === 'confirm' ? null : notice}
        confirmNotice={lastAction === 'confirm' ? notice : null}
      />
      <ContextComparison profiles={snapshot.profiles} />
    </>
  );
}

function LearnedProfile({
  view,
  inherited,
}: {
  view: StyleProfileView;
  inherited: boolean;
}) {
  const profile = view.profile;
  const items = [
    ['Formalidad', readableStyleValue(profile.formality)],
    ['Longitud habitual', readableStyleValue(profile.average_length)],
    [
      'Tono y calidez',
      readableStyleValue(
        profile.schema_version === 2 ? profile.tone.warmth : undefined,
      ),
    ],
    [
      'Tratamiento',
      readableStyleValue(
        profile.schema_version === 2 ? profile.form_of_address : undefined,
      ),
    ],
    [
      'Franqueza',
      readableStyleValue(
        profile.schema_version === 2 ? profile.tone.directness : undefined,
      ),
    ],
    ['Idioma observado', readableStyleValue(profile.language)],
    [
      'Saludos habituales',
      profile.preferred_greetings.join(' · ') ||
        'Sin una fórmula recurrente observada',
    ],
    [
      'Despedidas habituales',
      profile.preferred_closings.join(' · ') ||
        'Sin una fórmula recurrente observada',
    ],
    [
      'Emojis',
      profile.uses_emojis ? 'Se han observado' : 'No se han observado',
    ],
  ];
  return (
    <Panel
      title={inherited ? 'Perfil general de referencia' : 'Estilo aprendido'}
    >
      <StatusBadge
        tone={!view.current ? 'warning' : view.reviewed ? 'success' : 'warning'}
      >
        {!view.current
          ? 'Perfil contextual no vigente'
          : view.reviewed
            ? 'Perfil revisado'
            : 'Pendiente de revisión'}
      </StatusBadge>
      {inherited && (
        <p className="description">
          No hay un perfil aprendido específico para este ámbito. Se utiliza el
          perfil general como referencia.
        </p>
      )}
      {!view.current && (
        <p className="form-message">
          {view.inactiveReason === 'GENERAL_UNREVIEWED'
            ? 'Revisa y confirma primero el perfil general.'
            : 'El perfil general, las relaciones o la vigencia han cambiado. Este perfil contextual no se aplicará hasta que se vuelva a preparar.'}
        </p>
      )}
      <p className="style-description">{profile.style_description}</p>
      <dl className="style-traits">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <dl className="style-traits style-traits-text">
        <div>
          <dt>Estructura</dt>
          <dd>{profile.structure}</dd>
        </div>
        <div>
          <dt>Puntuación</dt>
          <dd>{profile.punctuation}</dd>
        </div>
        {profile.vocabulary.length > 0 && (
          <div>
            <dt>Expresiones recurrentes</dt>
            <dd>{profile.vocabulary.join(' · ')}</dd>
          </div>
        )}
      </dl>
      <dl className="settings-list">
        <div>
          <dt>Versión</dt>
          <dd>{view.version}</dd>
        </div>
        <div>
          <dt>Correos de la muestra</dt>
          <dd>{view.sampleSize}</dd>
        </div>
        <div>
          <dt>Última generación</dt>
          <dd>
            <DateTime value={view.generatedAt} />
          </dd>
        </div>
      </dl>
      {view.sampleSize < 200 && (
        <p className="description">
          La muestra contiene menos de los 200 ejemplos recomendados; el perfil
          puede representar solo parte de tu estilo.
        </p>
      )}
    </Panel>
  );
}

function PreferenceEditor({
  scope,
  profile,
  generalRevision,
  preferences,
  disabled,
  onDirty,
  submit,
  notice,
  confirmNotice,
}: {
  scope: StyleScope;
  profile: StyleProfileView | undefined;
  generalRevision: string;
  preferences: StoredStylePreference[];
  disabled: boolean;
  onDirty: (dirty: boolean) => void;
  submit: (operation: StyleEditorOperation) => Promise<void>;
  notice: ReactNode;
  confirmNotice: ReactNode;
}) {
  const initial = () => {
    const values = emptyPreferenceDraft();
    for (const row of preferences)
      values[row.preference.key] = row.preference.value;
    return values;
  };
  const [values, setValues] = useState<PreferenceDraft>(initial);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const changed = () => {
    setDirty(true);
    onDirty(true);
    setNote('');
    setNoteError(false);
    setResetting(false);
  };
  const common = {
    scope,
    generalRevision,
    profileRevision: profile?.revision ?? null,
    expectedRevisions: preferences.map((row) => row.revision),
  };
  const discard = () => {
    setValues(initial());
    setText('');
    setNote('Cambios locales descartados.');
    setNoteError(false);
    setDirty(false);
    onDirty(false);
    setResetting(false);
  };
  return (
    <>
      <Panel title="Tus preferencias de escritura">
        <p className="description">
          «Sin ajuste propio» mantiene el estilo aprendido y las preferencias de
          ámbitos más generales. Restaurar elimina solo las preferencias de{' '}
          {scopeLabel(scope).toLocaleLowerCase()}.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit({
              action: 'save',
              ...common,
              preferences: validatePreferenceSet(
                styleFields
                  .filter((field) => values[field.key])
                  .map((field) => ({
                    key: field.key,
                    value: values[field.key],
                  })),
              ),
            });
          }}
        >
          <fieldset className="style-fieldset" disabled={disabled}>
            <legend>Ajustes para {scopeLabel(scope)}</legend>
            <div className="style-fields">
              {styleFields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  <select
                    value={values[field.key]}
                    onChange={(event) => {
                      changed();
                      setValues({ ...values, [field.key]: event.target.value });
                    }}
                  >
                    <option value="">
                      Sin ajuste propio · seguir perfil / heredar
                    </option>
                    {Object.entries(field.options).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label>
              Instrucciones de redacción
              <textarea
                rows={3}
                maxLength={2000}
                value={text}
                onChange={(event) => {
                  changed();
                  setText(event.target.value);
                }}
                placeholder="Usa un tono cercano. Sé breve. No uses emojis."
              />
            </label>
            <p className="description">
              Puedes indicar tono, formalidad, longitud, saludos, despedidas,
              idioma, emojis y ofrecimiento final de ayuda. Usa una instrucción
              por frase. Por ejemplo: «No uses saludos largos», «Responde en
              español» o «Sin despedida». Se convertirán en los ajustes del
              formulario.
            </p>
            <button
              type="button"
              className="button button-secondary"
              disabled={!text.trim()}
              onClick={() => {
                try {
                  const parsed = parseEditorInstructions(text);
                  setValues({
                    ...values,
                    ...Object.fromEntries(
                      parsed.map((preference) => [
                        preference.key,
                        preference.value,
                      ]),
                    ),
                  });
                  setText('');
                  setNoteError(false);
                  setNote(
                    'Instrucciones aplicadas al formulario. Guarda las preferencias para utilizarlas.',
                  );
                } catch (error) {
                  setNoteError(true);
                  setNote(
                    styleEditorMessages[(error as Error).message] ??
                      styleEditorMessages.INVALID_INSTRUCTIONS,
                  );
                }
              }}
            >
              Aplicar instrucciones al formulario
            </button>
            {note && (
              <p
                className={noteError ? 'form-error' : 'form-message'}
                role={noteError ? 'alert' : 'status'}
              >
                {note}
              </p>
            )}
            {text.trim() && (
              <p className="description">
                Aplica las instrucciones al formulario o vacía el campo antes de
                guardar.
              </p>
            )}
            <div className="workspace-actions">
              <button
                className="button"
                type="submit"
                disabled={!dirty || !!text.trim()}
              >
                Guardar preferencias
              </button>
              {dirty && (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={discard}
                >
                  Descartar cambios locales
                </button>
              )}
            </div>
          </fieldset>
        </form>
        {notice}
        {preferences.length > 0 && !dirty && (
          <>
            <button
              className="button button-secondary style-reset"
              type="button"
              disabled={disabled}
              onClick={() => setResetting(!resetting)}
            >
              Restaurar preferencias de este ámbito
            </button>
            {resetting && (
              <div className="form-message">
                <p>
                  Se retirarán los {preferences.length} ajustes explícitos de
                  este ámbito. Se conservarán el perfil aprendido y las
                  preferencias de otros ámbitos.
                </p>
                <div className="workspace-actions">
                  <button
                    className="button"
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      void submit({ action: 'restore', ...common })
                    }
                  >
                    Sí, restaurar este ámbito
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={disabled}
                    onClick={() => setResetting(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>
      {profile && !profile.reviewed && profile.current && (
        <Panel title="Confirma el perfil aprendido">
          <p className="description">
            Comprueba que el resumen representa tu escritura. Al confirmarlo, el
            asistente podrá usarlo junto con tus preferencias explícitas. La
            automatización mantiene su configuración actual.
          </p>
          <label className="style-review-label">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={disabled || dirty}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            He revisado este perfil y representa mi forma de escribir.
          </label>
          {dirty && (
            <p className="description">
              Guarda o descarta los cambios antes de confirmar el perfil.
            </p>
          )}
          <button
            type="button"
            className="button"
            disabled={disabled || dirty || !reviewed}
            onClick={() =>
              void submit({ action: 'confirm', ...common, reviewed: true })
            }
          >
            Confirmar perfil de escritura
          </button>
        </Panel>
      )}
      {confirmNotice}
    </>
  );
}

function ContextComparison({ profiles }: { profiles: StyleProfileView[] }) {
  const contexts = profiles.filter(
    (profile) => profile.scope.kind !== 'GENERAL',
  );
  return (
    <Panel title="Diferencias según el destinatario">
      {contexts.length === 0 ? (
        <p className="description">
          Todavía no hay perfiles específicos por destinatario, dominio o tipo
          de relación. El asistente utiliza tu perfil general y las preferencias
          que hayas configurado.
        </p>
      ) : (
        <>
          <p className="description">
            Estas son las variaciones observadas. Puedes seleccionar cada ámbito
            arriba para consultar su resumen y sus preferencias.
          </p>
          <div className="style-table-scroll">
            <table className="style-comparison">
              <caption>
                Comparación del estilo general y los perfiles contextuales
              </caption>
              <thead>
                <tr>
                  <th scope="col">Ámbito</th>
                  <th scope="col">Formalidad</th>
                  <th scope="col">Calidez</th>
                  <th scope="col">Longitud</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((view) => (
                  <tr key={scopeIdentity(view.scope)}>
                    <th scope="row">{scopeLabel(view.scope)}</th>
                    <td>{readableStyleValue(view.profile.formality)}</td>
                    <td>
                      {readableStyleValue(
                        view.profile.schema_version === 2
                          ? view.profile.tone.warmth
                          : undefined,
                      )}
                    </td>
                    <td>{readableStyleValue(view.profile.average_length)}</td>
                    <td>
                      {!view.current
                        ? 'No vigente'
                        : view.reviewed
                          ? 'Revisado'
                          : 'Pendiente de revisión'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Link className="text-link" href="/onboarding">
        Preparar de nuevo el perfil de escritura →
      </Link>
    </Panel>
  );
}
