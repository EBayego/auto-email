'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const sections = [
  ['/dashboard', 'Resumen', '01'],
  ['/onboarding', 'Primeros pasos', '02'],
  ['/style', 'Mi estilo', '03'],
  ['/knowledge', 'Conocimiento', '04'],
  ['/activity', 'Actividad', '05'],
  ['/analytics', 'Métricas', '06'],
  ['/settings', 'Ajustes', '07'],
] as const;

export function WorkspaceNavigation() {
  const pathname = usePathname();
  return (
    <nav className="workspace-nav" aria-label="Navegación principal">
      {sections.map(([href, label, number]) => (
        <Link
          key={href}
          href={href}
          aria-current={
            pathname === href || pathname.startsWith(`${href}/`)
              ? 'page'
              : undefined
          }
        >
          <span className="nav-number" aria-hidden="true">
            {number}
          </span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
