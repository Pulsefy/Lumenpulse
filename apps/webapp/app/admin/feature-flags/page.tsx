import { Metadata } from 'next';
import FeatureFlagsConsoleClient from './FeatureFlagsConsoleClient';

export const metadata: Metadata = {
  title: 'Feature Flags | Admin Console | Lumenpulse',
  description: 'Toggle feature flags, adjust rollouts and review change history.',
};

export default function FeatureFlagsPage() {
  return <FeatureFlagsConsoleClient />;
}
