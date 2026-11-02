'use client';

import { useState } from 'react';

export function ProductDemo() {
  const [step, setStep] = useState(0);
  const [missingSource, setMissingSource] = useState(false);
  return (
    <section className="landing-section" id="demo" aria-labelledby="demo-title">
      <p className="eyebrow">Del correo a la propuesta</p>
      <h2 id="demo-title">Pruébalo con un ejemplo.</h2>
      <p className="landing-copy">
        Demostración con datos ficticios. No conecta Gmail, no llama a una IA y
        no crea borradores reales.
      </p>
      <ol className="demo-progress" aria-label="Pasos de la demostración">
        {['Llega una consulta', 'Se comprueba el contexto', 'Tú decides'].map(
          (title, index) => (
            <li key={title} aria-current={step === index ? 'step' : undefined}>
              <span>0{index + 1}</span> {title}
            </li>
          ),
        )}
      </ol>
      <div className="demo-panel" aria-live="polite" aria-atomic="true">
        {step === 0 && (
          <>
            <p className="eyebrow">Mensaje de ejemplo</p>
            <h3>Consulta sobre el servicio Atlas</h3>
            <p>Hola, ¿cuánto cuesta Atlas y en qué horario podéis atenderme?</p>
            <p>Gracias, Ana.</p>
            <p className="field-help">
              Empresa y consulta ficticias para esta demostración.
            </p>
          </>
        )}
        {step === 1 && (
          <>
            <p className="eyebrow">Fuente elegida por el usuario</p>
            <h3>
              {missingSource
                ? 'Falta una tarifa vigente'
                : 'Ficha de Atlas · ejemplo ficticio'}
            </h3>
            <p>
              {missingSource
                ? 'Hay una consulta de precio, pero no disponemos de una fuente que lo confirme. La propuesta necesita revisión.'
                : 'Atlas: 125 euros. Atención de lunes a viernes, de 9:00 a 18:00. El usuario ha elegido esta ficha como referencia.'}
            </p>
            <p className="field-help">
              El precio de Atlas pertenece al ejemplo; no es el precio de Auto
              Email.
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <p className="eyebrow">
              {missingSource ? 'Revisión necesaria' : 'Propuesta de borrador'}
            </p>
            <h3>
              {missingSource
                ? 'Se detiene la propuesta.'
                : 'Una respuesta que puedes revisar.'}
            </h3>
            {missingSource ? (
              <p>
                Falta una tarifa vigente que respalde el precio. En este ejemplo
                no se crea ningún borrador. El titular debe comprobar la
                información y atender la consulta.
              </p>
            ) : (
              <>
                <p className="demo-draft">
                  {
                    'Hola, Ana:\n\nAtlas cuesta 125 euros. Podemos atenderte de lunes a viernes, de 9:00 a 18:00.\n\nUn saludo.'
                  }
                </p>
                <p className="field-help">
                  En el producto, la propuesta se guarda como borrador en Gmail.
                  Compruebas destinatario, datos y contenido antes de enviarla
                  tú.
                </p>
              </>
            )}
          </>
        )}
      </div>
      <label className="demo-option">
        <input
          type="checkbox"
          checked={missingSource}
          onChange={(event) => {
            setMissingSource(event.target.checked);
            setStep(0);
          }}
        />
        Probar qué ocurre si falta la tarifa
      </label>
      <div className="landing-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          Anterior
        </button>
        {step < 2 ? (
          <button
            type="button"
            className="button"
            onClick={() => setStep(step + 1)}
          >
            {step === 0 ? 'Ver el contexto' : 'Ver el resultado'}
          </button>
        ) : (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setStep(0)}
          >
            Repetir demostración
          </button>
        )}
      </div>
    </section>
  );
}
