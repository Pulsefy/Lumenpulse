import { Metadata } from 'next';
import AdminActionsClient from './AdminActionsClient';

export const metadata: Metadata = {
  title: 'Contract Actions | Admin Console',
  description: 'Execute contract operations with confirmation safeguards.',
};

export default function AdminActionsPage() {
  return <AdminActionsClient />;
}