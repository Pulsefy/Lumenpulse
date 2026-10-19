import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getPrivacySettings,
  setBackgroundRefreshEnabled,
  type PrivacySettings,
} from '../lib/privacy-settings';
import { syncBackgroundRefreshWithSettings } from '../lib/background-refresh';
import { reportError } from '../lib/error-reporting';

export default function PrivacyScreen() {
  const [settings, setSettings] = useState<PrivacySettingsInterface | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    getPrivacySettings().then((value) => {
      if (mounted) {
        setSettings(value);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const onToggleBackgroundRefresh = useCallback(async (enabled: boolean) => {
    setSaving(true);
    try {
      const next = await setBackgroundRefreshEnabled(enabled);
      setSettings(next);
      await syncBackgroundRefreshWithSettings();
    } catch (error) {
      reportError(error, { scope: 'privacy-screen-toggle-background-refresh' });
    } finally {
      setSaving(false);
    }
  }, []);

  if (!settings) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Privacy</Text>
        <Text style={styles.sectionTitle}>Background refresh</Text>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Watchlist &amp; portfolio</Text>
            <Text style={styles.rowHint}>
              Refresh in the background when on Wi-Fi and while battery is not low.
            </Text>
          </View>
          <Switch
            value={settings.backgroundRefreshEnabled}
            onValueChange={onToggleBackgroundRefresh}
            disabled={saving}
            accessibilityLabel="Background refresh"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 24 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: '#666',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowText: { flex: 1, paddingRight: 12 },
  rowLabel: { fontSize: 16, color: '#000' },
  rowHint: { fontSize: 13, color: '#666', marginTop: 4 },
});
