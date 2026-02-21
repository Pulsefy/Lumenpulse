"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AuthApiService } from "@/lib/auth-service";
import { useToast } from "@/hooks/use-toast";
import { Key, Lock, Shield } from "lucide-react";
import Link from "next/link";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const t = searchParams.get("token");
    if (t) setToken(t);
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Mismatch",
        description: "Passwords do not match.",
      });
      return;
    }

    if (newPassword.length < 8) {
      toast({
        variant: "destructive",
        title: "Invalid Password",
        description: "Password must be at least 8 characters long.",
      });
      return;
    }

    setIsLoading(true);
    try {
      await AuthApiService.resetPassword({ token, newPassword });
      toast({
        title: "Success",
        description: "Password has been reset successfully. You can now sign in.",
      });
      router.push("/auth/login");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to reset password.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-black relative overflow-hidden">
      <div className="w-full max-w-md bg-[#111] border border-white/10 rounded-2xl p-8 shadow-2xl relative z-10">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/10 mb-4">
            <Shield className="text-blue-500" size={32} />
          </div>
          <h2 className="text-3xl font-bold text-white mb-2">New Passkey</h2>
          <p className="text-gray-400">Set your new secure access credentials</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-white text-sm">Reset Token</label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your token here"
              className="w-full px-4 py-3 rounded-md bg-black border border-white/10 text-white focus:border-blue-500 outline-none transition-all"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-white text-sm">New Passkey</label>
            <div className="relative">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full px-4 py-3 pl-10 rounded-md bg-black border border-white/10 text-white focus:border-blue-500 outline-none transition-all"
                required
              />
              <div className="absolute left-3 top-3.5 text-gray-500">
                <Key size={16} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-white text-sm">Confirm Passkey</label>
            <div className="relative">
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full px-4 py-3 pl-10 rounded-md bg-black border border-white/10 text-white focus:border-blue-500 outline-none transition-all"
                required
              />
              <div className="absolute left-3 top-3.5 text-gray-500">
                <Lock size={16} />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-gradient-to-r from-blue-500 to-[#db74cf] text-white rounded-md font-bold hover:opacity-90 transition-all disabled:opacity-50"
          >
            {isLoading ? "Resetting..." : "Reset Passkey"}
          </button>
        </form>

        <div className="mt-8 text-center">
          <Link href="/auth/login" className="text-sm text-gray-500 hover:text-white transition-colors">
            Back to Sign In
          </Link>
        </div>
      </div>
      
      {/* Background blobs */}
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px]"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#db74cf]/10 rounded-full blur-[120px]"></div>
    </div>
  );
}
