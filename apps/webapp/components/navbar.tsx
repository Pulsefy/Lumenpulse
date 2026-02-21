"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Menu, X, Layers, Users, LayoutDashboard } from "lucide-react";
import { WalletButton } from "./wallet-button";

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-primary/20">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex-shrink-0 -ml-2">
            <Link href="/" className="flex items-center">
              <Image
                src="/assets/lumenpulse-03.svg"
                alt="Lumenpulse Logo"
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
              href="#"
              className="px-3 py-2 text-sm font-medium text-white hover:text-white transition-all flex items-center gap-2 group relative"
            >
              <Users className="w-4 h-4 text-primary group-hover:text-white transition-colors" />
              <span className="group-hover:translate-x-0.5 transition-transform">
                Community
              </span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="#"
              className="px-3 py-2 text-sm font-medium text-white hover:text-white transition-all flex items-center gap-2 group relative"
            >
              <LayoutDashboard className="w-4 h-4 text-primary group-hover:text-white transition-colors" />
              <span className="group-hover:translate-x-0.5 transition-transform">
                Dashboard
              </span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
          </div>

          {/* Wallet Button */}
          <div className="hidden md:block">
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
              href="#"
              className="flex items-center gap-3 p-3 rounded-lg text-white hover:bg-white/5 transition-all relative group"
              onClick={() => setIsMenuOpen(false)}
            >
              <Users className="w-5 h-5 text-primary" />
              <span>Community</span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>
            <Link
              href="#"
              className="flex items-center gap-3 p-3 rounded-lg text-white hover:bg-white/5 transition-all relative group"
              onClick={() => setIsMenuOpen(false)}
            >
              <LayoutDashboard className="w-5 h-5 text-primary" />
              <span>Dashboard</span>
              <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#db74cf] transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100"></span>
            </Link>

            {/* Wallet connect in mobile menu */}
            <div className="w-full mt-2">
              <WalletButton className="w-full justify-center" />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}


