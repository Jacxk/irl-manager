import { readSettings } from '@/lib/settings';
import { Login } from '@/components/login';
export const dynamic = 'force-dynamic';
export default async function LoginPage() {
  const { values: s } = await readSettings();
  return (
    <Login
      registrationEnabled={s.registrationEnabled}
      minPasswordLength={s.minPasswordLength}
      instanceName={s.instanceName}
      loginMessage={s.loginMessage}
      logoUrl={s.logoUrl}
    />
  );
}
