"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  Github,
  Twitter,
  Linkedin,
  ExternalLink,
  Database,
  Shield,
  Code,
  Hexagon,
} from "lucide-react";
import { initFooterAnimations } from "@/lib/footer-animations";
import { FooterLinksGroup } from "@/components/ui/footer-links";

export function Footer() {
  const footerRef = useRef<HTMLElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<(HTMLAnchorElement | null)[]>([]);
  const dotsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const socialRef = useRef<(HTMLAnchorElement | null)[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Mark component as mounted to prevent hydration mismatch
    setMounted(true);

    // Use the extracted animation function with a small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (typeof window !== "undefined") {
        initFooterAnimations(logoRef, linksRef, dotsRef, socialRef);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Function to add elements to refs with proper typing
  const addToLinkRef = (el: HTMLAnchorElement | null) => {
    if (el && !linksRef.current.includes(el)) {
      linksRef.current.push(el);
    }
  };

  const addToDotRef = (el: HTMLSpanElement | null) => {
    if (el && !dotsRef.current.includes(el)) {
      dotsRef.current = [...dotsRef.current, el];
    }
  };

  const addToSocialRef = (el: HTMLAnchorElement | null) => {
    if (el && !socialRef.current.includes(el)) {
      socialRef.current.push(el);
    }
  };

  // Fixed positions for hexagons to avoid hydration mismatches
  const hexagonPositions = [
    { top: "10%", left: "20%" },
    { top: "30%", left: "10%" },
    { top: "50%", left: "15%" },
    { top: "70%", left: "25%" },
    { top: "20%", left: "60%" },
    { top: "40%", left: "70%" },
    { top: "60%", left: "80%" },
    { top: "80%", left: "65%" },
    { top: "25%", left: "40%" },
    { top: "75%", left: "45%" },
  ];

  const hexagonSizes = [40, 50, 60, 70, 80, 45, 55, 65, 75, 85];
  const hexagonRotations = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270];

  return (
    <footer
      ref={footerRef}
      className="bg-background border-t border-primary/10 py-8 mt-auto relative overflow-hidden"
      suppressHydrationWarning
    >
      {/* Only render complex elements after mounting to prevent hydration issues */}
      {mounted && (
        <div className="absolute inset-0 z-0 opacity-10">
          <div className="absolute top-1/4 left-1/4 w-1 h-1 bg-blue-400 rounded-full animate-pulse"></div>
          <div
            className="absolute top-1/3 left-1/2 w-1 h-1 bg-purple-400 rounded-full animate-pulse"
            style={{ animationDelay: "0.5s" }}
          ></div>
          <div
            className="absolute top-2/3 left-3/4 w-1 h-1 bg-pink-400 rounded-full animate-pulse"
            style={{ animationDelay: "1s" }}
          ></div>
          <div
            className="absolute top-1/2 left-1/4 w-1 h-1 bg-blue-400 rounded-full animate-pulse"
            style={{ animationDelay: "1.5s" }}
          ></div>
          <div
            className="absolute top-3/4 left-1/2 w-1 h-1 bg-purple-400 rounded-full animate-pulse"
            style={{ animationDelay: "2s" }}
          ></div>

          {/* Hexagon grid pattern */}
          <div className="absolute inset-0 opacity-5">
            {hexagonPositions.map((position, i) => (
              <div
                key={i}
                className="absolute footer-hexagon"
                style={{
                  top: position.top,
                  left: position.left,
                  transform: `rotate(${hexagonRotations[i]}deg)`,
                }}
              >
                <Hexagon size={hexagonSizes[i]} strokeWidth={0.5} />
              </div>
            ))}
          </div>

          {/* Connection lines */}
          <svg
            className="absolute inset-0 w-full h-full"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            style={{ pointerEvents: "none" }}
          >
            <line
              x1="20%"
              y1="20%"
              x2="40%"
              y2="30%"
              stroke="currentColor"
              strokeWidth="0.5"
              strokeOpacity="0.2"
              className="text-primary connection-line"
            />
            <line
              x1="40%"
              y1="30%"
              x2="60%"
              y2="20%"
              stroke="currentColor"
              strokeWidth="0.5"
              strokeOpacity="0.2"
              className="text-primary connection-line"
            />
            <line
              x1="60%"
              y1="20%"
              x2="80%"
              y2="40%"
              stroke="currentColor"
              strokeWidth="0.5"
              strokeOpacity="0.2"
              className="text-primary connection-line"
            />
            <line
              x1="30%"
              y1="60%"
              x2="50%"
              y2="70%"
              stroke="currentColor"
              strokeWidth="0.5"
              strokeOpacity="0.2"
              className="text-primary connection-line"
            />
            <line
              x1="50%"
              y1="70%"
              x2="70%"
              y2="60%"
              stroke="currentColor"
              strokeWidth="0.5"
              strokeOpacity="0.2"
              className="text-primary connection-line"
            />
          </svg>
        </div>
      )}

      <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col md:flex-row justify-between mb-8">
          <div
            ref={logoRef}
            className="mb-6 md:mb-0 flex flex-col justify-start pl-0"
          >
            <div className="mb-2">
              <div className="relative z-50 isolation-isolate flex justify-start">
                <Image
                  src="/assets/lumenpulse-04.svg"
                  alt="Lumenpulse"
                  width={360}
                  height={160}
                  className="h-16 sm:h-20 md:h-24 w-auto object-contain object-left"
                  priority
                  style={{
                    filter: "none",
                    opacity: 1,
                    mixBlendMode: "normal",
                    backgroundColor: "transparent",
                    position: "relative",
                    zIndex: 50,
                  }}
                />
              </div>
            </div>
            <div className="h-px w-40 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 mb-5 relative z-20"></div>
            <p className="text-foreground/70 text-sm max-w-xs leading-relaxed relative z-20">
              Delivering real-time blockchain intelligence and cutting edge
              insights for the next generation of decentralized finance, powered
              by a community driven platform with token-based incentives.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 md:gap-8 md:mt-4">
            <div className="col-span-1">
              <div className="flex flex-col space-y-3 sm:space-y-4">
                <Link
                  ref={addToLinkRef}
                  href="/"
                  className="text-foreground/60 hover:text-foreground transition-colors text-sm flex items-center group"
                >
                  <div className="w-1 h-1 bg-blue-400 rounded-full mr-2 flex-shrink-0"></div>
                  Home
                </Link>
                <Link
                  ref={addToLinkRef}
                  href="/about"
                  className="text-foreground/60 hover:text-foreground transition-colors text-sm flex items-center group"
                >
                  <div className="w-1 h-1 bg-purple-400 rounded-full mr-2 flex-shrink-0"></div>
                  About
                </Link>
                <Link
                  ref={addToLinkRef}
                  href="/news"
                  className="text-foreground/60 hover:text-foreground transition-colors text-sm flex items-center group"
                >
                  <div className="w-1 h-1 bg-pink-400 rounded-full mr-2 flex-shrink-0"></div>
                  News
                </Link>
              </div>
            </div>

            <div className="col-span-1">
              <div className="flex flex-col space-y-3 sm:space-y-4">
                <Link
                  ref={addToLinkRef}
                  href="/privacy"
                  className="text-foreground/60 hover:text-foreground transition-colors text-sm flex items-center group"
                >
                  <div className="w-1 h-1 bg-purple-400 rounded-full mr-2 flex-shrink-0"></div>
                  Privacy Policy
                </Link>
                <Link
                  ref={addToLinkRef}
                  href="/terms"
                  className="text-foreground/60 hover:text-foreground transition-colors text-sm flex items-center group"
                >
                  <div className="w-1 h-1 bg-pink-400 rounded-full mr-2 flex-shrink-0"></div>
                  Terms of Use
                </Link>
                <Link
                  ref={addToLinkRef}
                  href="/sitemap"
                  className="text-foreground/60 hover:text-foreground transition-colors text-sm flex items-center group"
                >
                  <div className="w-1 h-1 bg-blue-400 rounded-full mr-2 flex-shrink-0"></div>
                  Sitemap
                </Link>
              </div>
            </div>

            <div className="col-span-1">
              <div className="flex flex-col space-y-3 sm:space-y-4">
                <Link
                  ref={addToLinkRef}
                  href="/api"
                  className="text-foreground/60 hover:text-foreground transition-colors text-sm flex items-center group"
                >
                  <Code
                    size={14}
                    className="mr-2 text-blue-400 group-hover:text-foreground transition-colors"
                  />
                  API Documentation
                </Link>
                <Link
                  ref={addToLinkRef}
                  href="/developers"
                  className="text-foreground/60 hover:text-foreground transition-colors text-sm flex items-center group"
                >
                  <Database
                    size={14}
                    className="mr-2 text-purple-400 group-hover:text-foreground transition-colors"
                  />
                  Developers
                </Link>
                <Link
                  ref={addToLinkRef}
                  href="/status"
                  className="text-foreground/60 hover:text-foreground transition-colors text-sm flex items-center group"
                >
                  <Shield
                    size={14}
                    className="mr-2 text-pink-400 group-hover:text-foreground transition-colors"
                  />
                  Network Status
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Social icons and copyright section */}
        <div className="flex flex-col md:flex-row justify-between items-center pt-6 border-t border-primary/5">
          <p className="text-foreground/60 text-xs mb-4 md:mb-0 relative z-20">
            © {new Date().getFullYear()} Lumenpulse. All rights reserved.
          </p>

          <div className="flex space-x-3 sm:space-x-4">
            <Link
              href="https://twitter.com"
              target="_blank"
              className="bg-foreground/5 hover:bg-foreground/10 p-2 rounded-full transition-colors group relative z-20"
              ref={addToSocialRef}
            >
              <Twitter
                size={18}
                className="text-foreground/60 group-hover:text-foreground transition-colors"
              />
            </Link>
            <Link
              href="https://github.com"
              target="_blank"
              className="bg-foreground/5 hover:bg-foreground/10 p-2 rounded-full transition-colors group relative z-20"
              ref={addToSocialRef}
            >
              <Github
                size={18}
                className="text-foreground/60 group-hover:text-foreground transition-colors"
              />
            </Link>
            <Link
              href="https://linkedin.com"
              target="_blank"
              className="bg-foreground/5 hover:bg-foreground/10 p-2 rounded-full transition-colors group relative z-20"
              ref={addToSocialRef}
            >
              <Linkedin
                size={18}
                className="text-foreground/60 group-hover:text-foreground transition-colors"
              />
            </Link>
            <Link
              href="https://discord.com"
              target="_blank"
              className="bg-foreground/5 hover:bg-foreground/10 p-2 rounded-full transition-colors group relative z-20"
              ref={addToSocialRef}
            >
              <ExternalLink
                size={18}
                className="text-foreground/60 group-hover:text-foreground transition-colors"
              />
            </Link>
          </div>
        </div>

        {/* Blockchain-inspired decorative element */}
        {mounted && (
          <div className="relative mt-8 h-1">
            <div className="absolute left-0 w-full h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent"></div>
            <div className="absolute left-1/4 w-1 h-1 rounded-full bg-blue-500 animate-pulse"></div>
            <div
              className="absolute left-1/2 w-1 h-1 rounded-full bg-purple-500 animate-pulse"
              style={{ animationDelay: "0.5s" }}
            ></div>
            <div
              className="absolute left-3/4 w-1 h-1 rounded-full bg-pink-500 animate-pulse"
              style={{ animationDelay: "1s" }}
            ></div>
          </div>
        )}
      </div>
    </footer>
  );
}


