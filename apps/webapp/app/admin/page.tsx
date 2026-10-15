import { Metadata } from 'next';
import AdminConsoleClient from './AdminConsoleClient';

export const metadata: Metadata = {
  title: 'Admin Console | Lumenpulse',
  description: 'Secure admin interface for contract operations.',
};

export default function AdminPage() {
  return <AdminConsoleClient />;
}