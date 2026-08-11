import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SupportConsole } from '@/components/admin/support/SupportConsole';
import { getAuthContext } from '@/lib/server/auth/auth';

export const metadata: Metadata = {
  title: 'Support Console',
};

export default async function AdminSupportPage() {
  const ctx = await getAuthContext({ headers: await headers() });
  if (!ctx.userId || !ctx.user) redirect('/signin');
  if (!(ctx.user as unknown as { isAdmin?: boolean }).isAdmin) redirect('/app');
  return <SupportConsole />;
}
