import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { useLocalization } from '../src/context';

export default function OfflineBanner() {
  const { isConnected, isInternetReachable } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const { colors } = useLocalization();

  if (isConnected && isInternetReachable) return null;

  const message = !isConnected
    ? 'No network connection. Some features may be unavailable.'
    : 'No internet access. Please check your connection.';

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { top: insets.top }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.banner, { backgroundColor: colors.danger || '#c0392b' }]}>
        <Text style={styles.text}>{message}</Text>
        <TouchableOpacity onPress={() => {}} accessibilityRole="button">
          <Text style={styles.retry}>{'Dismiss'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 200,
    alignItems: 'center',
  },
  banner: {
    marginHorizontal: 12,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: 200,
  },
  text: {
    color: '#fff',
    flex: 1,
    marginRight: 8,
  },
  retry: {
    color: '#fff',
    fontWeight: '700',
  },
});
