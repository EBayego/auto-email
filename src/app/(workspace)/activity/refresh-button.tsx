'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
export function ActivityRefresh() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className="button button-secondary"
      disabled={pending}
      aria-busy={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? 'Actualizando…' : 'Actualizar actividad'}
    </button>
  );
}
