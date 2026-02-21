"use client";

import Link from "next/link";
import { Code, Database, Shield } from "lucide-react";

interface FooterLinkProps {
  href: string;
  color: "blue" | "purple" | "pink";
  children: React.ReactNode;
  icon?: React.ReactNode;
  addToLinkRef?: (el: HTMLAnchorElement | null) => void;
}

export function FooterLink({
  href,
  color,
  children,
  icon,
  addToLinkRef,
}: FooterLinkProps) {
  const colorMap = {
    blue: "bg-blue-400",
    purple: "bg-purple-400",
    pink: "bg-pink-400",
  };

  return (
    <Link
      ref={addToLinkRef}
      href={href}
      className="text-foreground/60 hover:text-foreground transition-colors text-sm flex items-center group"
    >
      {icon ? (
        icon
      ) : (
        <div
          className={`w-1 h-1 ${colorMap[color]} rounded-full mr-2 flex-shrink-0 animate-pulse`}
        ></div>
      )}
      {children}
    </Link>
  );
}

interface FooterLinksGroupProps {
  addToLinkRef?: (el: HTMLAnchorElement | null) => void;
}

export function FooterLinksGroup({ addToLinkRef }: FooterLinksGroupProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 md:gap-8 md:mt-4">
      <div className="col-span-1">
        <div className="flex flex-col space-y-3 sm:space-y-4">
          <FooterLink href="/" color="blue" addToLinkRef={addToLinkRef}>
            Home
          </FooterLink>
          <FooterLink href="/about" color="purple" addToLinkRef={addToLinkRef}>
            About
          </FooterLink>
          <FooterLink href="/news" color="pink" addToLinkRef={addToLinkRef}>
            News
          </FooterLink>
        </div>
      </div>

      <div className="col-span-1">
        <div className="flex flex-col space-y-3 sm:space-y-4">
          <FooterLink
            href="/privacy"
            color="purple"
            addToLinkRef={addToLinkRef}
          >
            Privacy Policy
          </FooterLink>
          <FooterLink href="/terms" color="pink" addToLinkRef={addToLinkRef}>
            Terms of Use
          </FooterLink>
          <FooterLink href="/sitemap" color="blue" addToLinkRef={addToLinkRef}>
            Sitemap
          </FooterLink>
        </div>
      </div>

      <div className="col-span-1">
        <div className="flex flex-col space-y-3 sm:space-y-4">
          <FooterLink
            href="/api"
            color="blue"
            addToLinkRef={addToLinkRef}
            icon={
              <Code
                size={14}
                className="mr-2 text-blue-400 group-hover:text-foreground transition-colors"
              />
            }
          >
            API Documentation
          </FooterLink>
          <FooterLink
            href="/developers"
            color="purple"
            addToLinkRef={addToLinkRef}
            icon={
              <Database
                size={14}
                className="mr-2 text-purple-400 group-hover:text-foreground transition-colors"
              />
            }
          >
            Developers
          </FooterLink>
          <FooterLink
            href="/status"
            color="pink"
            addToLinkRef={addToLinkRef}
            icon={
              <Shield
                size={14}
                className="mr-2 text-pink-400 group-hover:text-foreground transition-colors"
              />
            }
          >
            Network Status
          </FooterLink>
        </div>
      </div>
    </div>
  );
}

