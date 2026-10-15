"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CryptoTable } from "@/components/crypto-table";
import { NewsSection } from "@/components/news-section";
import { Tags } from "lucide-react";

function EcosystemBanner() {
  const searchParams = useSearchParams();
  const tag = searchParams.get("tag");
  const category = searchParams.get("category");
  if (!tag && !category) return null;
  return (
    <div className="mb-6 flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-white">
      <Tags className="h-4 w-4 text-primary" />
      <span>
        Showing ecosystem {tag ? "tag" : "category"}{" "}
        <strong className="text-primary">{tag || category}</strong> from global
        search.
      </span>
    </div>
  );
}

export default function NewsPage() {
  const formatNumber = (num: number): string => {
    if (num >= 1e12) {
      return (num / 1e12).toFixed(2) + "T";
    } else if (num >= 1e9) {
      return (num / 1e9).toFixed(2) + "B";
    } else if (num >= 1e6) {
      return (num / 1e6).toFixed(2) + "M";
    } else if (num >= 1e3) {
      return (num / 1e3).toFixed(2) + "K";
    } else {
      return num.toFixed(2);
    }
  };

  return (
    <div className="bg-background pt-20">
      <div className="container mx-auto px-4 py-4">
        <Suspense fallback={null}>
          <EcosystemBanner />
        </Suspense>
        <div className="w-full mb-6">
          <CryptoTable formatNumberAction={formatNumber} />
        </div>
        <div className="w-full">
          <NewsSection />
        </div>
      </div>
    </div>
  );
}
