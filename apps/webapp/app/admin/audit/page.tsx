import { Metadata } from 'next';
import AuditLogsClient from './AuditLogsClient';

export const metadata: Metadata = {
  title: 'Audit Logs | Admin Console',
  description: 'View and filter admin action audit logs.',
};

export default function AuditLogsPage() {
  return <AuditLogsClient />;
}