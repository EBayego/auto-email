import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link href="/" className="brand">
          Auto Email
        </Link>
        {children}
      </section>
    </main>
  );
}
