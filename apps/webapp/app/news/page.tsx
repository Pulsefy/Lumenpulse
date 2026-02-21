"use client";

import { useState, useEffect } from "react";
import { CryptoTable } from "@/components/crypto-table";
import { NewsSection } from "@/components/news-section";

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
        {/* Crypto Market Rankings (full width) */}
        <div className="w-full mb-6">
          <CryptoTable formatNumberAction={formatNumber} />
        </div>
        {/* End of Crypto Market Rankings */}

        {/* News Section (full width) */}
        <div className="w-full">
          <NewsSection />
        </div>
      </div>
    </div>
  );
}

