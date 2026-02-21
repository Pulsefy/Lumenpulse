"use client";

import Link from "next/link";
import { StarsAnimation } from "@/components/stars-animation";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden">
      {/* Use the app's default background */}
      <div className="absolute inset-0 z-0">
        <StarsAnimation />
      </div>

      {/* Concentric circles for visual effect */}
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full border border-slate-700/30"
            style={{
              width: `${(i + 1) * 15}%`,
              height: `${(i + 1) * 15}%`,
              opacity: 1 - i * 0.15,
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 text-center">
        <h1 className="text-[120px] md:text-[180px] font-bold text-white leading-none font-heading">
          404
        </h1>

        <p className="text-lg text-white/80 mb-8">
          It looks like you&apos;re lost...
        </p>

        <div>
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-gradient-to-r from-primary to-[#db74cf] rounded-lg text-white font-medium hover:shadow-lg hover:shadow-primary/20 transition-all"
          >
            GO BACK HOME
          </Link>
        </div>
      </div>
    </div>
  );
}

