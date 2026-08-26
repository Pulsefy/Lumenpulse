import { Metadata } from 'next';
import AuthGate from '@/components/auth/AuthGate';

export const metadata: Metadata = {
  title: 'Admin Console | Lumenpulse',
  description: 'Secure admin interface for contract operations with environment safety rails.',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      {children}
    </AuthGate>
  );
}