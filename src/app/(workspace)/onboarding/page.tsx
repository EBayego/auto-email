import { requireAccount, getWorkspaceGmail } from '@/app/_lib/workspace';
import Link from 'next/link';
import { getOnboardingAccess } from '@/app/_lib/onboarding';
import { gmailOAuthMessages } from '@/modules/gmail/messages';
import { PageHeader, UnavailableState } from '../components';
import type { WorkspaceSearchParams } from '../notices';
import { OnboardingFlow } from './onboarding-flow';

export const metadata = { title: 'Primeros pasos · Auto Email' };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: WorkspaceSearchParams;
}) {
  await requireAccount();
  const [gmail, onboarding] = await Promise.allSettled([
    getWorkspaceGmail(),
    getOnboardingAccess().then((access) => access.get()),
  ]);
  const params = await searchParams;
  const code = typeof params.gmail === 'string' ? params.gmail : '';
  const message = Object.hasOwn(gmailOAuthMessages, code)
    ? gmailOAuthMessages[code as keyof typeof gmailOAuthMessages]
    : null;
  return (
    <>
      <PageHeader
        title="Un asistente a tu medida."
        description="Elige el alcance, conecta Gmail y prepara tu perfil de escritura paso a paso."
      />
      {message && (
        <p
          className={code === 'CONNECTED' ? 'form-message' : 'form-error'}
          role={code === 'CONNECTED' ? 'status' : 'alert'}
        >
          {message}
          {code === 'DISCONNECT_PENDING' && (
            <>
              {' '}
              <Link href="/settings">Gestionar la desconexión</Link>
            </>
          )}
        </p>
      )}
      {gmail.status === 'fulfilled' && onboarding.status === 'fulfilled' ? (
        <OnboardingFlow
          gmail={gmail.value}
          initial={onboarding.value}
          today={new Date().toISOString().slice(0, 10)}
        />
      ) : (
        <UnavailableState>
          No podemos cargar la configuración de Gmail. Vuelve a intentarlo antes
          de continuar.
        </UnavailableState>
      )}
    </>
  );
}
