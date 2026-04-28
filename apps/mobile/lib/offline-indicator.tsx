import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { useLocalization } from '../src/context';

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);
  const { colors } = useLocalization();

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!state.isConnected);
    });

    return unsubscribe;
  }, []);

  if (!isOffline) {
    return null;
  }

  return (
    <View
      style={[styles.container, { backgroundColor: colors.danger }]}
      accessible
      accessibilityLabel="No internet connection"
      accessibilityRole="alert"
    >
      <Ionicons name="cloud-offline-outline" size={16} color="#ffffff" />
      <Text style={styles.text} accessible>
        No internet connection
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  text: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
});
