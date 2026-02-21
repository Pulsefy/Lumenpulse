"use client";

import { useState } from "react";
import { Mail } from "lucide-react";

interface ResetPasskeyFormProps {
  onSubmitAction: (data: any) => void;
  isLoading: boolean;
  onBackToSignInAction: () => void;
}

export function ResetPasskeyForm({
  onSubmitAction,
  isLoading,
  onBackToSignInAction,
}: ResetPasskeyFormProps) {
  const [email, setEmail] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitAction({ email });
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2 form-element">
          <label htmlFor="resetEmail" className="text-white">
            Email Address
          </label>
          <div className="relative">
            <input
              id="resetEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-4 py-3 pl-10 rounded-md bg-[#111]/80 text-white border border-[#db74cf]/30 focus:outline-none focus:ring-2 focus:ring-[#db74cf]/50 backdrop-blur-sm transition-all"
              required
            />
            <div className="absolute left-3 top-3.5 text-[#db74cf]/50">
              <Mail size={16} />
            </div>
          </div>
        </div>

        <button
          type="submit"
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
              "Send Reset Link"
            )}
          </span>
        </button>
      </form>

      <div className="text-center text-gray-400 form-element">
        <p>
          Remember your passkey?{" "}
          <button
            type="button"
            onClick={onBackToSignInAction}
            className="text-blue-500 hover:text-[#db74cf] focus:outline-none"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}

