"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface OnboardingState {
  isFirstTime: boolean;
  step: number; // 0 = not shown, 1-3 = active step, 4 = completed
  isOpen: boolean;
  progress: number;
}

interface OnboardingContextType {
  state: OnboardingState;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  nextStep: () => void;
  prevStep: () => void;
  completeOnboarding: () => void;
  skipOnboarding: () => void;
  resetOnboarding: () => void; // for dev
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OnboardingState>({
    isFirstTime: true,
    step: 0,
    isOpen: false,
    progress: 0,
  });

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('lumenpulse_onboarding');
        if (saved) {
          const parsed = JSON.parse(saved);
          setState({
            isFirstTime: parsed.isFirstTime ?? true,
            step: parsed.step ?? 0,
            isOpen: parsed.isOpen ?? false,
            progress: parsed.progress ?? 0,
          });
        }
      } catch {
        // Invalid storage, reset to defaults
        localStorage.removeItem('lumenpulse_onboarding');
      }
    }
  }, []);

  // Persist to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('lumenpulse_onboarding', JSON.stringify(state));
      } catch {
        // Ignore storage errors
      }
    }
  }, [state]);

  const openOnboarding = () => {
    setState(prev => ({ ...prev, isOpen: true, step: 1, progress: 33 }));
  };

  const closeOnboarding = () => {
    setState(prev => ({ ...prev, isOpen: false }));
  };

  const nextStep = () => {
    setState(prev => {
      const newStep = Math.min(prev.step + 1, 4);
      const newProgress = (newStep / 4) * 100;
      return { ...prev, step: newStep, progress: newProgress };
    });
  };

  const prevStep = () => {
    setState(prev => ({ ...prev, step: Math.max(prev.step - 1, 1) }));
  };

  const completeOnboarding = () => {
    setState({ isFirstTime: false, step: 4, isOpen: false, progress: 100 });
  };

  const skipOnboarding = () => {
    setState(prev => ({ ...prev, isFirstTime: false, step: 4, isOpen: false, progress: 100 }));
  };

  const resetOnboarding = () => {
    localStorage.removeItem('lumenpulse_onboarding');
    setState({ isFirstTime: true, step: 0, isOpen: false, progress: 0 });
  };

  return (
    <OnboardingContext.Provider
      value={{
        state,
        openOnboarding,
        closeOnboarding,
        nextStep,
        prevStep,
        completeOnboarding,
        skipOnboarding,
        resetOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

