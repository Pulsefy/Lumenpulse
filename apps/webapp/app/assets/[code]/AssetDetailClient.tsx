"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Coins, ExternalLink } from "lucide-react";
import { clientConfig } from "@/lib/config";
import { useStellarConfig } from "@/contexts/StellarConfigContext";
import { useExplorerUrl } from "@/hooks/useExplorerUrl";

export default function AssetDetailClient() {
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const { config } = useStellarConfig();
  const buildExplorerUrl = useExplorerUrl();

  const code = decodeURIComponent(params.code || "");
  const issuer = searchParams.get("issuer") || "";
  const network = config?.network === "mainnet" ? "public" : "testnet";

  const assetExplorerHref = issuer
    ? `${clientConfig.stellarExplorerUrl}/${network}/asset/${code}-${issuer}`
    : `${clientConfig.stellarExplorerUrl}/${network}/asset/${code}`;
  const issuerExplorerHref = issuer
    ? buildExplorerUrl("account", issuer)
    : null;

  return (
    <main className="min-h-screen bg-background px-4 pb-16 pt-24 text-foreground">
      <div className="container mx-auto max-w-3xl">
        <Link
          href="/news"
          className="mb-6 inline-flex items-center gap-2 text-sm text-white/60 transition hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to explore
        </Link>

        <section className="rounded-3xl border border-primary/20 bg-black/70 p-8 shadow-2xl shadow-primary/10 backdrop-blur-xl">
          <div className="mb-6 flex items-center gap-3 text-primary">
            <div className="rounded-2xl bg-primary/15 p-3">
              <Coins className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary/80">
                Stellar asset
              </p>
              <h1 className="text-3xl font-semibold text-white">
                {code || "Unknown"}
              </h1>
            </div>
          </div>

          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-white/45">Asset code</dt>
              <dd className="mt-1 font-mono text-white">{code || "—"}</dd>
            </div>
            <div>
              <dt className="text-white/45">Issuer</dt>
              <dd className="mt-1 break-all font-mono text-white">
                {issuer || "Native / not specified"}
              </dd>
            </div>
          </dl>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={assetExplorerHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/15 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/25"
            >
              View asset on explorer
              <ExternalLink className="h-4 w-4" />
            </a>
            {issuerExplorerHref ? (
              <a
                href={issuerExplorerHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:bg-white/5"
              >
                View issuer
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:bg-white/5"
            >
              Open dashboard
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
