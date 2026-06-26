"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Menu, X, Layers, Users, LayoutDashboard, Trophy, ShieldCheck } from "lucide-react";
import { WalletButton } from "./wallet-button";
import { ThemeSelector } from "./theme-selector";
import { WalletSwitcher } from "@/components/wallet-switcher";
import { useStellarConfig } from "@/contexts/StellarConfigContext";
import { useExplorerUrl } from "@/hooks/useExplorerUrl";

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { config } = useStellarConfig();
  const buildExplorerUrl = useExplorerUrl();
  const isTestnet = config?.network === "testnet";
  const vaultContractId = config?.contracts?.crowdfundVault;

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-primary/20">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex-shrink-0 -ml-2">
            <Link href="/" className="flex items-center">
              <Image
                src="/assets/lumenpulse-03.svg"
                alt="LumenPulse Logo"
                width={36}
                height={36}
                className="h-28 w-auto ml-2 my-auto"
                priority
              />
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-6 ml-auto mr-6">
            <Link
              href="/news"
              className="px-3 py-2 text-sm font-medium text-white hover:text-white transition-all flex items-center gap-2 group relative"
            >
              <Layers className="w-4 h-4 text-primary group-hover:text-white transition-colors" />
              <span className="group-hover:translate-x-0.5 transition-transform">
                Explore
              </span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="/community"
              className="px-3 py-2 text-sm font-medium text-white hover:text-white transition-all flex items-center gap-2 group relative"
            >
              <Users className="w-4 h-4 text-primary group-hover:text-white transition-colors" />
              <span className="group-hover:translate-x-0.5 transition-transform">
                Community
              </span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="/grants"
              className="px-3 py-2 text-sm font-medium text-white hover:text-white transition-all flex items-center gap-2 group relative"
            >
              <Trophy className="w-4 h-4 text-primary group-hover:text-white transition-colors" />
              <span className="group-hover:translate-x-0.5 transition-transform">
                Grants
              </span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="/verification"
              className="px-3 py-2 text-sm font-medium text-white hover:text-white transition-all flex items-center gap-2 group relative"
            >
              <ShieldCheck className="w-4 h-4 text-primary group-hover:text-white transition-colors" />
              <span className="group-hover:translate-x-0.5 transition-transform">
                Verify
              </span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="/verification"
              className="px-3 py-2 text-sm font-medium text-white hover:text-white transition-all flex items-center gap-2 group relative"
            >
              <ShieldCheck className="w-4 h-4 text-primary group-hover:text-white transition-colors" />
              <span className="group-hover:translate-x-0.5 transition-transform">
                Verify
              </span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="/dashboard"
              className="px-3 py-2 text-sm font-medium text-white hover:text-white transition-all flex items-center gap-2 group relative"
            >
              <LayoutDashboard className="w-4 h-4 text-primary group-hover:text-white transition-colors" />
              <span className="group-hover:translate-x-0.5 transition-transform">
                Dashboard
              </span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
          </div>

          {/* Theme Selector */}
          <div className="hidden md:block mr-4">
            <ThemeSelector variant="segmented" />
          </div>

          {/* Testnet badge + Contract link + Wallet Button */}
          <div className="hidden md:flex items-center gap-2">
            {isTestnet && (
              <span
                id="testnet-badge-desktop"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Testnet
              </span>
            )}
            {vaultContractId && (
              <a
                href={buildExplorerUrl("contract", vaultContractId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-primary/10 text-primary/70 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors"
                title="View Crowdfund Vault contract on explorer"
              >
                Vault ↗
              </a>
            )}
            <WalletButton />
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="text-primary p-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {isMenuOpen && (
        <div className="md:hidden bg-black/95 border-t border-primary/20 backdrop-blur-xl">
          <div className="container mx-auto px-4 py-4 space-y-2">
            <Link
              href="/news"
              className="flex items-center gap-3 p-3 rounded-lg text-white hover:bg-white/5 transition-all relative group"
              onClick={() => setIsMenuOpen(false)}
            >
              <Layers className="w-5 h-5 text-primary" />
              <span>Explore</span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="/community"
              className="flex items-center gap-3 p-3 rounded-lg text-white hover:bg-white/5 transition-all relative group"
              onClick={() => setIsMenuOpen(false)}
            >
              <Users className="w-5 h-5 text-primary" />
              <span>Community</span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="/grants"
              className="flex items-center gap-3 p-3 rounded-lg text-white hover:bg-white/5 transition-all relative group"
              onClick={() => setIsMenuOpen(false)}
            >
              <Trophy className="w-5 h-5 text-primary" />
              <span>Grants</span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="/verification"
              className="flex items-center gap-3 p-3 rounded-lg text-white hover:bg-white/5 transition-all relative group"
              onClick={() => setIsMenuOpen(false)}
            >
              <ShieldCheck className="w-5 h-5 text-primary" />
              <span>Verify</span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="/verification"
              className="flex items-center gap-3 p-3 rounded-lg text-white hover:bg-white/5 transition-all relative group"
              onClick={() => setIsMenuOpen(false)}
            >
              <ShieldCheck className="w-5 h-5 text-primary" />
              <span>Verify</span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="/dashboard"
              className="flex items-center gap-3 p-3 rounded-lg text-white hover:bg-white/5 transition-all relative group"
              onClick={() => setIsMenuOpen(false)}
            >
              <LayoutDashboard className="w-5 h-5 text-primary" />
              <span>Dashboard</span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>

            {/* Testnet badge + Contract link + Wallet connect in mobile menu */}
            <div className="w-full mt-2 flex flex-col items-center gap-2">
              {isTestnet && (
                <span
                  id="testnet-badge-mobile"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Testnet
                </span>
              )}
              {vaultContractId && (
              <a
                href={buildExplorerUrl("contract", vaultContractId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-primary/10 text-primary/70 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors"
              >
                View Vault Contract ↗
              </a>
            )}
            <WalletButton className="w-full justify-center" />
            </div>

            {/* Theme Selector in mobile menu */}
            <div className="w-full mt-4 pt-4 border-t border-primary/20">
              <div className="flex justify-center">
                <ThemeSelector variant="segmented" />
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
