"use client";

import AuthGate from '@/components/auth/AuthGate';
import AdminRoleGate from '@/components/auth/AdminRoleGate';
import { ForbiddenView } from '@/components/auth/ForbiddenView';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <AdminRoleGate
        forbiddenFallback={
          <ForbiddenView
            title="Admin Access Required"
            description="Your account does not have permission to access the admin console. If you believe this is an error, contact a system administrator."
          />
        }
      >
        {children}
      </AdminRoleGate>
    </AuthGate>
  );
}