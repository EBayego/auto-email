'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RetryButton({ reset }: { reset?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="button button-secondary"
      disabled={pending}
      onClick={() =>
        startTransition(() => {
          router.refresh();
          reset?.();
        })
      }
    >
      {pending ? 'Cargando…' : 'Volver a intentar'}
    </button>
  );
}
