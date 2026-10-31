import { DeletionStatusScreen } from './deletion-status';
export const metadata = {
  title: 'Eliminación de cuenta · Auto Email',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default function AccountDeletionPage() {
  return <DeletionStatusScreen />;
}
