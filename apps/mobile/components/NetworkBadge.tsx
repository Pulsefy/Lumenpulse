import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEnvironment } from '../contexts/EnvironmentContext';
import { useLocalization } from '../src/context';

export default function NetworkBadge() {
  const { environmentConfig } = useEnvironment();
  const { colors } = useLocalization();
  const insets = useSafeAreaInsets();
  const isMainnet = environmentConfig.id === 'mainnet';

  return (
    <View
      pointerEvents="none"
      style={[
        styles.badge,
        {
          backgroundColor: isMainnet ? colors.danger : colors.success,
          borderColor: colors.background,
          shadowColor: colors.shadow,
          top: insets.top + 8,
        },
      ]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Active network: ${environmentConfig.label}`}
    >
      <Text style={[styles.badgeText, { color: colors.onStatus }]}>{environmentConfig.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: 12,
    zIndex: 100,
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
});
