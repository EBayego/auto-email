import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="welcome">
      <section className="welcome-content" aria-labelledby="page-title">
        <p className="eyebrow">Asistente para Gmail</p>
        <h1 id="page-title">Auto Email</h1>
        <p className="intro">
          Tu forma de comunicarte.
          <br />
          La última palabra, siempre tuya.
        </p>
        <p className="description">
          Un espacio para preparar respuestas con tu estilo y revisarlas en
          Gmail antes de enviarlas.
        </p>
        <Link className="button welcome-action" href="/login">
          Acceder a mi cuenta
        </Link>
      </section>
    </main>
  );
}
