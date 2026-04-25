"use client";

import { HomeView } from "./home/home-view";
import { useOnboarding } from '@/lib/onboarding';
import { useEffect } from 'react';
import OnboardingModal from '@/components/onboarding/OnboardingModal';

export default function Home() {
  const { state, openOnboarding } = useOnboarding();

  useEffect(() => {
    // Trigger onboarding for first-time unauthenticated users
    if (state.isFirstTime && state.step === 0) {
      openOnboarding();
    }
  }, [state.isFirstTime, state.step, openOnboarding]);

  return (
    <>
      <HomeView />
      <OnboardingModal />
    </>
  );
}
