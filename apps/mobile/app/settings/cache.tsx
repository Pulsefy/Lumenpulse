import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useDataPreloader } from '../../components/DataPreloader';
import { cache } from '../../lib/cache';

export default function CacheSettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { preloadData, clearCache } = useDataPreloader();
  const [loading, setLoading] = useState(false);

  const handleClearCache = () => {
    Alert.alert(
      'Clear Cache',
      'This will remove all cached data. You may experience slower loading times until data is re-cached.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await clearCache();
              Alert.alert('Success', 'Cache cleared successfully');
            } catch {
              Alert.alert('Error', 'Failed to clear cache');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const handlePreloadData = async () => {
    setLoading(true);
    try {
      await preloadData();
      Alert.alert('Success', 'Critical data preloaded for offline use');
    } catch {
      Alert.alert('Error', 'Failed to preload data');
    } finally {
      setLoading(false);
    }
  };

  const SettingItem = ({
    icon,
    title,
    subtitle,
    onPress,
    destructive = false,
  }: {
    icon: string;
    title: string;
    subtitle: string;
    onPress: () => void;
    destructive?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.settingItem, { backgroundColor: colors.surface }]}
      onPress={onPress}
      disabled={loading}
    >
      <View style={styles.settingIcon}>
        <Ionicons
          name={icon as any}
          size={24}
          color={destructive ? colors.danger : colors.accent}
        />
      </View>
      <View style={styles.settingContent}>
        <Text style={[styles.settingTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.settingSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Cache Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Data Management</Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
            Manage cached data for offline access and improved performance
          </Text>
        </View>

        <SettingItem
          icon="download-outline"
          title="Preload Critical Data"
          subtitle="Download portfolio, news, and assets for offline use"
          onPress={handlePreloadData}
        />

        <SettingItem
          icon="trash-outline"
          title="Clear All Cache"
          subtitle="Remove all cached data to free up storage space"
          onPress={handleClearCache}
          destructive
        />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>How Caching Works</Text>
          <View style={[styles.infoBox, { backgroundColor: colors.surface }]}>
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              • Data is automatically cached when you use the app{'\n'}• Cached data is shown
              instantly while fresh data loads{'\n'}• Pull to refresh updates cached data{'\n'}•
              Data expires automatically to stay current{'\n'}• Works offline with previously cached
              data
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Cache Status</Text>
          <View style={[styles.statusBox, { backgroundColor: colors.surface }]}>
            <View style={styles.statusItem}>
              <Ionicons
                name={cache.isOnlineStatus() ? 'wifi' : 'wifi-outline'}
                size={20}
                color={cache.isOnlineStatus() ? colors.success : colors.danger}
              />
              <Text style={[styles.statusText, { color: colors.text }]}>
                {cache.isOnlineStatus() ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
  },
  settingIcon: {
    marginRight: 12,
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  settingSubtitle: {
    fontSize: 14,
  },
  infoBox: {
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
  },
  statusBox: {
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
});
