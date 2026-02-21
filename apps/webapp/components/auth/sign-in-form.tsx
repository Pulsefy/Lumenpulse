"use client";

import { useState, memo } from "react";
import { Mail, Lock, Eye, EyeOff, Shield, Wallet, Key } from "lucide-react";

// The utility functions can stay
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format large numbers
export const formatNumber = (num: number) => {
  if (num >= 1000000000000) {
    return `$${(num / 1000000000000).toFixed(2)}T`;
  } else if (num >= 1000000000) {
    return `$${(num / 1000000000).toFixed(2)}B`;
  } else if (num >= 1000000) {
    return `$${(num / 1000000).toFixed(2)}M`;
  } else {
    return `$${num.toFixed(2)}`;
  }
};

// Props interface
interface SignInFormProps {
  onSubmitAction: (data: any) => void;
  isLoading: boolean;
  onForgotPassword?: () => void;
}

// Create the SignInForm component
function SignInFormComponent({
  onSubmitAction,
  isLoading,
  onForgotPassword,
}: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [passkey, setPasskey] = useState("");
  const [showPasskey, setShowPasskey] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitAction({ email, passkey });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Secured Connection Badge - Repositioned to right */}
      <div className="mb-4 flex items-center justify-end form-element">
        <div className="bg-[#111]/80 border border-green-500/30 rounded-full px-3 py-1.5 flex items-center space-x-2 shadow-sm shadow-green-500/20 backdrop-blur-sm">
          <Shield size={14} className="text-green-500" />
          <span className="text-xs font-medium text-green-500">
            Secured Connection
          </span>
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
        </div>
      </div>

      <div className="space-y-2 form-element">
        <label htmlFor="email" className="text-white">
          Email
        </label>
        <div className="relative">
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            className="w-full px-4 py-3 pl-10 rounded-md bg-[#111]/80 text-white border border-[#db74cf]/30 focus:outline-none focus:ring-2 focus:ring-[#db74cf]/50 backdrop-blur-sm transition-all"
            required
          />
          <div className="absolute left-3 top-3.5 text-[#db74cf]/50">
            <Mail size={16} />
          </div>
        </div>
      </div>

      <div className="space-y-2 form-element">
        <label htmlFor="passkey" className="text-white">
          Passkey
        </label>
        <div className="relative">
          <input
            id="passkey"
            type={showPasskey ? "text" : "password"}
            value={passkey}
            onChange={(e) => setPasskey(e.target.value)}
            placeholder="••••••••••••••••"
            className="w-full px-4 py-3 pl-10 rounded-md bg-[#111]/80 text-white border border-[#db74cf]/30 focus:outline-none focus:ring-2 focus:ring-[#db74cf]/50 backdrop-blur-sm transition-all"
            required
          />
          <div className="absolute left-3 top-3.5 text-[#db74cf]/50">
            <Key size={16} />
          </div>
          <button
            type="button"
            onClick={() => setShowPasskey(!showPasskey)}
            className="absolute right-3 top-3.5 text-gray-400 hover:text-white"
          >
            {showPasskey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {onForgotPassword && (
        <div className="text-right form-element">
          <button
            type="button"
            onClick={onForgotPassword}
            className="text-sm text-blue-500 hover:text-[#db74cf] focus:outline-none flex items-center justify-end space-x-1 ml-auto"
          >
            <Key size={12} />
            <span>Reset passkey</span>
          </button>
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-3 mt-4 text-white bg-gradient-to-r from-blue-500 to-[#db74cf] rounded-md hover:opacity-90 transition-all focus:outline-none focus:ring-2 focus:ring-[#db74cf]/50 form-element disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
      >
        <Wallet size={18} />
        <span>{isLoading ? "Connecting..." : "Connect Wallet"}</span>
      </button>
    </form>
  );
}

// Export the memoized component as default
const SignInForm = memo(SignInFormComponent);
export default SignInForm;

