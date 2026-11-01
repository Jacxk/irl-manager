import { Dashboard } from '@/components/dashboard';
import { SettingsContent } from '@/components/settings-content';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <>
      <Dashboard />
      <SettingsContent />
    </>
  );
}
