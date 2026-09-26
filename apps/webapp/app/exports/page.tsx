"use client";

import { ExportsPage } from '@/components/exports/ExportsPage';
import AuthGate from '@/components/auth/AuthGate';

export default function ExportsRoute() {
  return (
    <AuthGate>
      <ExportsPage />
    </AuthGate>
  );
}