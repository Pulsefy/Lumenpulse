"use client";

import Link from "next/link";
import { Shield, Home, ArrowLeft } from "lucide-react";

interface ForbiddenViewProps {
  title?: string;
  description?: string;
  showBackLink?: boolean;
  backHref?: string;
}

export function ForbiddenView({
  title = "Access Denied",
  description = "You do not have permission to access this area.",
  showBackLink = true,
  backHref = "/",
}: ForbiddenViewProps) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center py-12 px-4">
      <div className="text-center max-w-md mx-auto">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 mb-6">
          <Shield className="w-8 h-8 text-red-400" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">{title}</h1>
        <p className="text-sm text-foreground/50 mb-8">{description}</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {showBackLink && (
            <Link
              href={backHref}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium text-foreground/80 hover:text-foreground transition-colors border border-white/10"
            >
              <ArrowLeft className="w-4 h-4" />
              Go back
            </Link>
          )}
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-sm font-bold text-black transition-colors"
          >
            <Home className="w-4 h-4" />
            Return to home
          </Link>
        </div>
      </div>
    </div>
  );
}
