import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import AuthGate from "@/components/auth/AuthGate";
import { VerificationReviewWorkspace } from "@/components/verification/VerificationReviewWorkspace";

export const metadata: Metadata = {
  title: "Verification Review - LumenPulse",
  description: "Reviewer workspace for incoming contributor and project verification requests.",
  robots: { index: false, follow: false },
};

export default function VerificationReviewPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <section className="relative pt-32 pb-10 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="flex items-center gap-3 mb-4">
            <ClipboardCheck className="w-7 h-7 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Verification review</h1>
          </div>
          <p className="text-foreground/50 text-base max-w-xl leading-relaxed">
            Review incoming verification requests, check their evidence and community vote, and
            record a decision with a rationale. Oldest requests are listed first.
          </p>
        </div>
      </section>
      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-4xl">
          <AuthGate>
            <VerificationReviewWorkspace />
          </AuthGate>
        </div>
      </section>
    </div>
  );
}
