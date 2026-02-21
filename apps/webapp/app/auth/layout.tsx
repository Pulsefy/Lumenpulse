"use client";

import { StarsBackground } from "@/components/stars-background";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-black">
      <div className="fixed inset-0 z-[-1]">
        <StarsBackground />
      </div>
      <main className="flex-grow relative z-[1]">{children}</main>
    </div>
  );
}

