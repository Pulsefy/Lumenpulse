"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { LoginForm } from "@/components/auth/login-form";
import { BlockchainGrid } from "@/components/blockchain-grid";
import { MultilingualWelcome } from "@/components/ui/multilingual-welcome";
import { containerFadeIn } from "@/lib/text-animations";

export default function LoginPage() {
  const welcomeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (welcomeRef.current) {
      // Animate welcome container elements using our reusable animation
      containerFadeIn(welcomeRef.current);
    }
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden">
      {/* Abstract lines - hidden on small screens */}
      <div className="absolute inset-0 z-0 opacity-20 hidden md:block">
        <div className="absolute top-1/4 left-1/3 w-[600px] h-[1px] bg-white/30 rotate-45"></div>
        <div className="absolute top-1/3 left-1/4 w-[400px] h-[1px] bg-white/30 rotate-[30deg]"></div>
        <div className="absolute top-2/3 left-1/2 w-[300px] h-[1px] bg-white/30 -rotate-[60deg]"></div>
      </div>

      <div className="w-full max-w-6xl h-auto md:h-[600px] bg-black/40 backdrop-blur-sm rounded-2xl overflow-hidden flex flex-col md:flex-row shadow-2xl relative z-10 border border-white/10">
        {/* Left side - Welcome message with blockchain visualization */}
        <div
          ref={welcomeRef}
          className="w-full md:w-1/2 p-6 md:p-12 flex flex-col justify-center relative order-1"
        >
          <div className="absolute top-2 md:top-2  md:left-1">
            <Link href="/" className="flex items-center">
              <div
                className="relative"
                style={{ zIndex: 50, isolation: "isolate" }}
              >
                <Image
                  src="/assets/lumenpulse-04.svg"
                  alt="Lumenpulse"
                  width={240}
                  height={82}
                  className="h-16 md:h-24 w-auto"
                  priority
                  style={{
                    filter: "none",
                    opacity: 1,
                    mixBlendMode: "normal",
                  }}
                />
              </div>
            </Link>
          </div>

          {/* Dynamic multilingual welcome component */}
          <div className="mt-12 md:mt-0">
            <MultilingualWelcome />
          </div>

          {/* Using the reusable blockchain grid component */}
          <div className="h-40 md:h-64 w-full mb-4">
            <BlockchainGrid />
          </div>
        </div>

        {/* Right side - Login form */}
        <div className="w-full md:w-1/2 bg-black/50 backdrop-blur-sm p-6 md:p-12 flex flex-col justify-center order-2">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}



