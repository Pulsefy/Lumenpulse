import { InteractionManager } from 'react-native';

/**
 * Schedules work that must not compete with first paint (issue #1576).
 */
export function scheduleAfterInteractive(work: () => void): { cancel: () => void } {
  const task = InteractionManager.runAfterInteractions(() => {
    work();
  });
  return {
    cancel: () => {
      task.cancel();
    },
  };
}
