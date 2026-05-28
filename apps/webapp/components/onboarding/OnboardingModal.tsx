"use client";

import { useEffect, useRef, useCallback, useState } from 'react';
import { useOnboarding } from '@/lib/onboarding';
import { useStellarWallet } from '@/app/providers';
import { useStellarConfig } from '@/contexts/StellarConfigContext';
import { signTransaction } from '@stellar/freighter-api';
import { StellarApiService } from '@/lib/api-services';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import gsap from 'gsap';

const X = dynamic(() => import('lucide-react').then((mod) => mod.X), { ssr: false });
const ChevronRight = dynamic(() => import('lucide-react').then((mod) => mod.ChevronRight), { ssr: false });
const Wallet = dynamic(() => import('lucide-react').then((mod) => mod.Wallet), { ssr: false });
const ShieldCheck = dynamic(() => import('lucide-react').then((mod) => mod.ShieldCheck), { ssr: false });
const Rocket = dynamic(() => import('lucide-react').then((mod) => mod.Rocket), { ssr: false });

const steps = [
  {
    title: 'Welcome to LumenPulse',
    description: 'Your trusted source for real-time decentralized crypto news and insights, powered by the Stellar blockchain.',
    icon: Rocket,
    key: 'value',
  },
  {
    title: 'Link Your Account',
    description: 'Connect your Stellar wallet or create a free email account to save your preferences and access personalized features.',
    icon: Wallet,
    key: 'account',
  },
  {
    title: 'Start Exploring',
    description: 'Dive into the dashboard, browse verified news, track Stellar balances, and stay ahead of crypto trends.',
    icon: ShieldCheck,
    key: 'explore',
  },
];

export default function OnboardingModal() {
  const { state, nextStep, prevStep, closeOnboarding, completeOnboarding, skipOnboarding } = useOnboarding();
  const { status: walletStatus, connect: connectWallet, publicKey } = useStellarWallet();
  const { config } = useStellarConfig();
  const modalRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);

  const [linkingState, setLinkingState] = useState<'idle' | 'fetching_challenge' | 'signing' | 'linking' | 'success' | 'error'>('idle');
  const [linkingError, setLinkingError] = useState<string | null>(null);

  // Auto-advance logic (optional, lightweight)
  useEffect(() => {
    if (state.step >= 1 && state.step <= 3) {
      const timeout = setTimeout(() => {
        if (state.isOpen) nextStep();
      }, 4000);
      return () => clearTimeout(timeout);
    }
  }, [state.step, state.isOpen, nextStep]);

  // GSAP entrance animation matching auth style
  useEffect(() => {
    if (modalRef.current && state.isOpen) {
      gsap.fromTo(modalRef.current, 
        { scale: 0.9, opacity: 0, y: 30 },
        { scale: 1, opacity: 1, y: 0, duration: 0.4, ease: 'back.out(1.7)' }
      );
    }
  }, [state.isOpen]);

  // Step change animation
  useEffect(() => {
    if (stepRef.current && state.step >= 1 && state.step <= 3) {
      gsap.fromTo(stepRef.current, 
        { x: 50, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.5, ease: 'power2.out' }
      );
    }
  }, [state.step]);

  const handleLinkWallet = useCallback(async () => {
    if (!publicKey) return;
    setLinkingState('fetching_challenge');
    setLinkingError(null);
    try {
      const challengeRes = await StellarApiService.getChallenge(publicKey);
      const challengeXDR = challengeRes.challenge;

      setLinkingState('signing');
      const networkPassphrase = config?.networkPassphrase;
      const result = await signTransaction(challengeXDR, { networkPassphrase });
      
      if (result.error) {
        throw new Error(result.error);
      }

      setLinkingState('linking');
      await StellarApiService.linkAccount(publicKey, result.signedTxXdr, "Onboarding Wallet");

      setLinkingState('success');
      setTimeout(() => {
        nextStep();
        setLinkingState('idle');
      }, 1500);
    } catch (err: any) {
      console.error('Wallet linking error:', err);
      setLinkingState('error');
      setLinkingError(err.message || 'Failed to sign or verify challenge.');
    }
  }, [publicKey, config, nextStep]);

  const handleNextOrConnect = useCallback(() => {
    if (state.step === 2) {
      if (walletStatus !== 'connected') {
        connectWallet();
      } else {
        handleLinkWallet();
      }
    } else {
      nextStep();
    }
  }, [state.step, walletStatus, connectWallet, nextStep, handleLinkWallet]);

  const handlePrimaryAction = useCallback(() => {
    if (state.step === 3) {
      completeOnboarding();
    } else {
      handleNextOrConnect();
    }
  }, [state.step, handleNextOrConnect, completeOnboarding]);

  if (!state.isOpen || state.step < 1 || state.step > steps.length) return null;

  const currentStep = steps[state.step - 1];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div 
        ref={modalRef}
        className="relative w-full max-w-md bg-gradient-to-b from-gray-900/95 to-gray-800/95 backdrop-blur-xl border border-gray-700/50 rounded-2xl shadow-2xl shadow-black/50 max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800/50">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-[#db74cf] rounded-full animate-pulse" />
            <span className="text-sm font-medium text-gray-400">
              Step {state.step} of 3
            </span>
          </div>
          <button
            onClick={closeOnboarding}
            className="p-2 text-gray-500 hover:text-white hover:bg-gray-800/50 rounded-xl transition-all duration-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div ref={stepRef} className="space-y-4 text-center">
            <div className="mx-auto w-20 h-20 bg-gradient-to-r from-[#db74cf]/20 to-blue-500/20 rounded-2xl flex items-center justify-center border border-[#db74cf]/30">
              <currentStep.icon className="w-10 h-10 text-[#db74cf]" />
            </div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-200 bg-clip-text text-transparent">
              {currentStep.title}
            </h2>
            <p className="text-gray-400 leading-relaxed">
              {currentStep.description}
            </p>
          </div>

          {/* Progress Bar */}
          <div className="mt-8 w-full bg-gray-800/50 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-[#db74cf] to-blue-500 h-2 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${state.progress}%` }}
            />
          </div>

          {/* Link Error Message */}
          {state.step === 2 && (linkingState === 'error' || linkingError) && (
            <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl text-center">
              {linkingError || "An error occurred during wallet verification."}
            </div>
          )}

          {/* Skip Button */}
          {state.step < 3 && linkingState === 'idle' && (
            <button
              onClick={skipOnboarding}
              className="mt-6 w-full text-sm text-gray-500 hover:text-gray-300 transition-colors py-2"
            >
              Skip for now
            </button>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 pt-0 border-t border-gray-800/50 space-y-2">
          {state.step > 1 && linkingState === 'idle' && (
            <button
              onClick={prevStep}
              className="w-full text-gray-400 hover:text-white transition-colors py-2 text-sm"
            >
              Back
            </button>
          )}
          <button
            onClick={handlePrimaryAction}
            disabled={linkingState !== 'idle' && linkingState !== 'error'}
            className="w-full bg-gradient-to-r from-[#db74cf] to-blue-500 hover:from-[#db74cf]/90 hover:to-blue-500/90 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-1"
          >
            {state.step === 2 ? (
              walletStatus !== 'connected' ? 'Connect Wallet' :
              linkingState === 'fetching_challenge' ? 'Requesting Challenge...' :
              linkingState === 'signing' ? 'Please Sign in Freighter...' :
              linkingState === 'linking' ? 'Verifying Ownership...' :
              linkingState === 'success' ? 'Linked Successfully!' :
              'Verify & Link Wallet'
            ) : state.step === 3 ? 'Get Started' : 'Next'}
            {(linkingState === 'idle' || linkingState === 'error') && (
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            )}
          </button>

          {state.step === 2 && linkingState === 'idle' && (
            <div className="pt-2">
              <Link href="/auth/login" className="text-xs text-gray-500 hover:text-gray-300 block text-center">
                Or use email signup →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

