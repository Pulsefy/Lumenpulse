"use client";

import { useState, useRef, useEffect } from "react";
import {
  User,
  Mail,
  Key,
  Lock,
  UserPlus,
  Shield,
  RefreshCw,
} from "lucide-react";
import gsap from "gsap";

interface SignUpFormProps {
  onSubmitAction: (data: any) => void;
  isLoading: boolean;
  onToggleFormAction?: () => void;
}

// In the component function
export function SignUpForm({
  onSubmitAction,
  isLoading,
  onToggleFormAction,
}: SignUpFormProps) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isEncrypted, setIsEncrypted] = useState(true);
  const silkRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    // Animate silk elements
    silkRef.current.forEach((silk, index) => {
      if (silk) {
        gsap.to(silk, {
          x: `${Math.sin(index) * 50}`,
          y: `${Math.cos(index) * 30}`,
          opacity: 0.3 + Math.random() * 0.4,
          duration: 15 + Math.random() * 10,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          delay: index * 0.5,
        });
      }
    });

    // Store a reference to the current silk elements for cleanup
    const currentSilkRefs = [...silkRef.current];

    return () => {
      // Clean up animations using the stored reference
      currentSilkRefs.forEach((silk) => {
        if (silk) {
          gsap.killTweensOf(silk);
        }
      });
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitAction({ username, email, password, confirmPassword });
  };

  // Find where onToggleForm is being used and replace it with onToggleFormAction
  // For example, in the return statement:
  return (
    <div className="space-y-6">
      {/* Silk background elements */}
      <div
        ref={(el) => (silkRef.current[0] = el)}
        className="absolute -right-20 top-10 w-40 h-60 bg-gradient-to-br from-blue-500/10 to-[#db74cf]/10 rounded-full blur-3xl"
      ></div>
      <div
        ref={(el) => (silkRef.current[1] = el)}
        className="absolute -right-10 top-40 w-60 h-40 bg-gradient-to-tr from-[#db74cf]/10 to-blue-500/10 rounded-full blur-3xl"
      ></div>
      <div
        ref={(el) => (silkRef.current[2] = el)}
        className="absolute right-20 -top-20 w-40 h-40 bg-gradient-to-br from-blue-500/10 to-[#db74cf]/10 rounded-full blur-3xl"
      ></div>

      <div className="overflow-y-auto max-h-[450px] hide-scrollbar pt-4">
        <form
          id="signup-form"
          onSubmit={handleSubmit}
          className="space-y-4 relative z-10 px-2 pt-2"
        >
          <div className="space-y-2 form-element">
            <label htmlFor="username" className="text-white">
              Username
            </label>
            <div className="relative">
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="satoshi_nakamoto"
                className="w-full px-4 py-3 pl-10 rounded-md bg-[#111]/80 text-white border border-[#db74cf]/30 focus:outline-none focus:ring-2 focus:ring-[#db74cf]/50 backdrop-blur-sm transition-all"
              />
              <div className="absolute left-3 top-3.5 text-[#db74cf]/50">
                <User size={16} />
              </div>
            </div>
          </div>

          <div className="space-y-2 form-element">
            <label htmlFor="email" className="text-white">
              Email Address
            </label>
            <div className="relative">
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-4 py-3 pl-10 rounded-md bg-[#111]/80 text-white border border-[#db74cf]/30 focus:outline-none focus:ring-2 focus:ring-[#db74cf]/50 backdrop-blur-sm transition-all"
              />
              <div className="absolute left-3 top-3.5 text-[#db74cf]/50">
                <Mail size={16} />
              </div>
            </div>
          </div>

          <div className="space-y-2 form-element">
            <label htmlFor="password" className="text-white">
              Create Passkey
            </label>
            <div className="relative">
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full px-4 py-3 pl-10 rounded-md bg-[#111]/80 text-white border border-[#db74cf]/30 focus:outline-none focus:ring-2 focus:ring-[#db74cf]/50 backdrop-blur-sm transition-all"
              />
              <div className="absolute left-3 top-3.5 text-[#db74cf]/50">
                <Key size={16} />
              </div>
            </div>
          </div>

          <div className="space-y-2 form-element">
            <label htmlFor="confirmPassword" className="text-white">
              Confirm Passkey
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full px-4 py-3 pl-10 rounded-md bg-[#111]/80 text-white border border-[#db74cf]/30 focus:outline-none focus:ring-2 focus:ring-[#db74cf]/50 backdrop-blur-sm transition-all"
              />
              <div className="absolute left-3 top-3.5 text-[#db74cf]/50">
                <Lock size={16} />
              </div>
            </div>
          </div>
        </form>
      </div>

      <div className="sticky bottom-0 pt-4 pb-2 bg-black/80 backdrop-blur-md z-20">
        <button
          type="submit"
          form="signup-form"
          disabled={isLoading}
          className="w-full py-3 bg-gradient-to-r from-blue-500 to-[#db74cf] text-white rounded-md transition-all flex items-center justify-center gap-2 relative overflow-hidden shadow-lg shadow-blue-500/20 form-element"
        >
          <span className="relative z-10 flex items-center">
            {isLoading ? (
              <svg
                className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            ) : (
              <>
                <UserPlus size={18} className="mr-2" />
                Create Account
              </>
            )}
          </span>
        </button>

        <div className="text-center text-gray-400 form-element">
          <p>
            Already have a wallet?{" "}
            <button
              type="button"
              onClick={onToggleFormAction}
              className="text-blue-500 hover:text-[#db74cf] focus:outline-none"
            >
              Sign in
            </button>
          </p>
        </div>
      </div>

      <style jsx>{`
        .hide-scrollbar {
          -ms-overflow-style: none; /* IE and Edge */
          scrollbar-width: none; /* Firefox */
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none; /* Chrome, Safari and Opera */
        }
      `}</style>
    </div>
  );
}

