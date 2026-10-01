import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useLocalization } from '../src/context';
import {
  formatMutationQueueStatus,
  shouldSurfaceMutationQueue,
  type MutationQueueSummary,
} from './mutation-queue-core';
import { mutationQueue } from './mutation-queue';

const EMPTY_SUMMARY: MutationQueueSummary = {
  pending: 0,
  replaying: 0,
  failed: 0,
  conflicted: 0,
  total: 0,
  needsAttention: 0,
};

/**
 * Compact status banner for offline state and queued mutations.
 *
 * It is rendered once from the root layout and stays mounted, so it also
 * shows failures/conflicts that happen while the device is online. Tapping it
 * opens the full queue screen where a mutation can be retried, discarded or
 * a conflict resolved.
 */
export function OfflineIndicator() {
  const router = useRouter();
  const { colors } = useLocalization();
  const [isOffline, setIsOffline] = useState(false);
  const [summary, setSummary] = useState<MutationQueueSummary>(EMPTY_SUMMARY);

  const refreshSummary = useCallback(() => {
    void mutationQueue
      .getSummary()
      .then(setSummary)
      .catch(() => setSummary(EMPTY_SUMMARY));
  }, []);

  useEffect(() => {
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      setIsOffline(!state.isConnected);
    });
    const unsubscribeQueue = mutationQueue.subscribe(refreshSummary);
    refreshSummary();

    return () => {
      unsubscribeNetInfo();
      unsubscribeQueue();
    };
  }, [refreshSummary]);

  if (!shouldSurfaceMutationQueue(summary, isOffline)) {
    return null;
  }

  const status = formatMutationQueueStatus(summary, { isOffline });
  const backgroundColor =
    summary.needsAttention > 0 ? colors.danger : isOffline ? colors.warning : colors.accent;

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor }]}
      onPress={() => router.push('/settings/mutation-queue')}
      activeOpacity={0.85}
      accessible
      accessibilityRole="button"
      accessibilityLabel={status}
      accessibilityHint="Opens the offline changes screen"
    >
      <Ionicons
        name={summary.needsAttention > 0 ? 'alert-circle-outline' : 'cloud-offline-outline'}
        size={16}
        color="#ffffff"
      />
      <Text style={styles.text} numberOfLines={2} accessible={false}>
        {status}
      </Text>
      <Ionicons name="chevron-forward" size={16} color="#ffffff" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    // Keep the trailing chevron clear of the absolutely positioned NetworkBadge.
    paddingRight: 80,
    gap: 6,
  },
  text: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
});
