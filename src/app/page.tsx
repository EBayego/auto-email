import Link from 'next/link';
import { validationOffer } from '@/modules/commercial/offer';
import { serviceContactEmail } from '@/config/contact';
import { ProductDemo } from './product-demo';

export default function HomePage() {
  return (
    <main className="landing">
      <header className="landing-header">
        <Link className="brand" href="/">
          Auto Email
        </Link>
        <nav aria-label="Información del producto">
          <a href="#demo">Ver demostración</a>
          <a href="#oferta">La propuesta</a>
          <Link href="/login">Acceder</Link>
        </nav>
      </header>
      <section
        className="welcome-content landing-hero"
        aria-labelledby="page-title"
      >
        <p className="eyebrow">Asistente para Gmail</p>
        <h1 id="page-title">Auto Email</h1>
        <p className="intro">
          Tu forma de comunicarte.
          <br />
          La última palabra, siempre tuya.
        </p>
        <p className="description">
          Conecta Gmail para preparar borradores de respuesta con tu estilo y
          con los documentos que tú elijas. Revisa cada propuesta en Gmail antes
          de enviarla. Auto Email no envía correos automáticamente.
        </p>
        <p className="landing-audience">
          Para profesionales que responden consultas repetitivas y trabajan con
          documentación propia.
        </p>
        <p className="description">
          Con tu autorización, se consulta el contexto necesario de Gmail y se
          comunica a OpenAI para preparar las respuestas. Puedes retirar el
          permiso, desconectar Gmail y borrar tus datos desde Ajustes.
        </p>
        <p className="form-message" role="status">
          Acceso en pruebas para usuarios autorizados. La apertura pública está
          pendiente de la verificación de Google.
        </p>
        <div className="landing-actions">
          <a className="button" href="#demo">
            Ver cómo funciona
          </a>
          <Link className="button button-secondary" href="/login">
            Acceder a mi cuenta
          </Link>
        </div>
      </section>
      <section className="landing-section" aria-labelledby="value-title">
        <p className="eyebrow">Contexto, estilo y control</p>
        <h2 id="value-title">Llegar a la respuesta con menos pasos.</h2>
        <div className="landing-grid">
          <article>
            <span className="landing-number">01</span>
            <h3>Tu contexto</h3>
            <p>
              Consulta el hilo y las fuentes autorizadas para preparar una
              respuesta fundamentada. Si falta información, el caso puede pasar
              a revisión.
            </p>
          </article>
          <article>
            <span className="landing-number">02</span>
            <h3>Tu forma de escribir</h3>
            <p>
              Revisas el perfil aprendido y eliges tono, idioma y preferencias.
              La personalización pertenece a tu cuenta.
            </p>
          </article>
          <article>
            <span className="landing-number">03</span>
            <h3>Tu última palabra</h3>
            <p>
              La propuesta aparece en Gmail como borrador. Puedes corregirla,
              descartarla o enviarla después de comprobarla.
            </p>
          </article>
        </div>
      </section>
      <ProductDemo />
      <section
        className="landing-section landing-offer"
        id="oferta"
        aria-labelledby="offer-title"
      >
        <div>
          <p className="eyebrow">Primera oferta · en preparación</p>
          <h2 id="offer-title">{validationOffer.name}</h2>
          <p className="landing-copy">
            Una propuesta para validar el servicio con profesionales, con
            alcance acotado y configuración guiada.
          </p>
          <p className="offer-price">
            {validationOffer.priceEur} €{' '}
            <span>/ {validationOffer.periodDays} días por cuenta</span>
          </p>
          <p className="field-help">
            Más los impuestos aplicables, que se concretarán antes de aceptar.
            Sin renovación automática.
          </p>
          <p className="landing-copy">
            Contratación y cobro todavía no disponibles. La oferta está sujeta a
            la preparación del servicio, las autorizaciones aplicables y la
            aceptación de sus condiciones.
          </p>
        </div>
        <div className="offer-details">
          <ul>
            <li>{validationOffer.gmailAccounts} cuenta Gmail por persona.</li>
            <li>
              Configuración inicial de hasta{' '}
              {validationOffer.initialDailyDraftLimit} borradores al día, con
              revisión humana.
            </li>
            <li>
              Hasta {validationOffer.documentLimit} documentos de{' '}
              {validationOffer.documentMegabytes} MB: PDF con texto, TXT o DOCX.
            </li>
            <li>
              Una sesión guiada de hasta {validationOffer.onboardingMinutes}{' '}
              minutos y soporte por un canal privado acordado.
            </li>
            <li>
              Estilo, fuentes, exclusiones y límites configurables desde la
              aplicación.
            </li>
          </ul>
          <p className="field-help">
            La generación depende de que el correo sea elegible y de que exista
            contexto suficiente. El límite inicial es una configuración de uso,
            no una garantía de cantidad de respuestas.
          </p>
          <p>
            El alcance inicial incluye Gmail y los documentos que subas. Las
            integraciones con CRM, Outlook y Drive, el OCR y los desarrollos a
            medida quedan fuera de esta propuesta.
          </p>
        </div>
      </section>
      <section className="landing-section" aria-labelledby="start-title">
        <p className="eyebrow">Una incorporación guiada</p>
        <h2 id="start-title">Primero, comprobar que encaja.</h2>
        <ol className="landing-onboarding">
          <li>
            <h3>Acordar el alcance</h3>
            <p>
              Identificar consultas, documentos y exclusiones, y revisar las
              condiciones antes de conectar la cuenta.
            </p>
          </li>
          <li>
            <h3>Preparar tu cuenta</h3>
            <p>
              Autorizar Gmail, revisar el estilo y configurar fuentes y límites
              con la automatización en pausa.
            </p>
          </li>
          <li>
            <h3>Probar y decidir</h3>
            <p>
              Evaluar ejemplos autorizados y revisar las primeras propuestas.
              Continuar solo si aporta valor y puedes mantener el control.
            </p>
          </li>
        </ol>
      </section>
      <footer className="landing-footer">
        <span>Auto Email · Borradores que tú revisas.</span>
        <a href={`mailto:${serviceContactEmail}`}>
          Soporte: {serviceContactEmail}
        </a>
        <Link href="/privacy">Privacidad y condiciones</Link>
      </footer>
    </main>
  );
}
