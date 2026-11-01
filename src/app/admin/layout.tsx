import { redirect } from 'next/navigation';
import { instanceAccess, ApiError } from '@/lib/access';
import { Admin } from '@/components/admin';
export const dynamic = 'force-dynamic';
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await instanceAccess();
  } catch (e) {
    if (e instanceof ApiError) redirect(e.status === 401 ? '/login' : '/');
    throw e;
  }
  return <Admin>{children}</Admin>;
}
