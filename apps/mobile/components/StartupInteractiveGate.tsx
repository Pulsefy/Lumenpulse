import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { scheduleAfterInteractive } from '../lib/defer-after-interactive';
import { markStartupPhase, markTimeToInteractive } from '../lib/startup-metrics';

type Props = {
  children: ReactNode;
};

/**
 * Marks time-to-interactive after React has painted and the interaction queue
 * is idle. Exposes `testID="app-interactive"` (0×0 sentinel; E2E waits on
 * `__LUMENPULSE_STARTUP__.timeToInteractiveMs`, not visibility).
 */
export function StartupInteractiveGate({ children }: Props) {
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    markStartupPhase('rootLayoutMounted');
    markStartupPhase('firstRender');
    const task = scheduleAfterInteractive(() => {
      markTimeToInteractive();
      setInteractive(true);
    });
    return () => task.cancel();
  }, []);

  return (
    <>
      {children}
      {interactive ? (
        <View
          testID="app-interactive"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: 0, height: 0 }}
        />
      ) : null}
    </>
  );
}
