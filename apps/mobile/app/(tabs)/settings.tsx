import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useRouter } from 'expo-router';
import { ThemeMode } from '../../theme/colors';

const THEME_OPTIONS: { label: string; value: ThemeMode; icon: string }[] = [
  { label: 'System', value: 'system', icon: 'phone-portrait-outline' },
  { label: 'Light', value: 'light', icon: 'sunny-outline' },
  { label: 'Dark', value: 'dark', icon: 'moon-outline' },
];

export default function SettingsScreen() {
  const { logout, isAuthenticated } = useAuth();
  const { colors, mode, setMode } = useTheme();
  const router = useRouter();

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const appEnv = Constants.expoConfig?.extra?.environment ?? 'development';

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/auth/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>

        {/* ── Theme Section ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="color-palette-outline" size={20} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Appearance</Text>
          </View>

          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((opt) => {
              const isActive = mode === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.themeOption,
                    {
                      backgroundColor: isActive ? colors.accent : colors.card,
                      borderColor: isActive ? colors.accent : colors.cardBorder,
                    },
                  ]}
                  onPress={() => setMode(opt.value)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={opt.icon as any}
                    size={20}
                    color={isActive ? '#ffffff' : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.themeLabel,
                      { color: isActive ? '#ffffff' : colors.text },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── App Info Section ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>App Info</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Version</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>{appVersion}</Text>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Environment</Text>
            <View style={[styles.envBadge, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Text style={[styles.envBadgeText, { color: colors.accent }]}>
                {appEnv === 'production' ? 'Production' : 'Contributor Build'}
              </Text>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Platform</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>Lumenpulse Mobile</Text>
          </View>
        </View>

        {/* ── Logout ── */}
        {isAuthenticated && (
          <TouchableOpacity
            style={[styles.logoutButton, { backgroundColor: colors.danger }]}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Ionicons name="log-out-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
            <Text style={styles.logoutButtonText}>Log Out</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 24,
    letterSpacing: -0.5,
  },

  /* Sections */
  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },

  /* Theme Selector */
  themeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  themeLabel: {
    fontSize: 13,
    fontWeight: '600',
  },

  /* App Info */
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  infoLabel: {
    fontSize: 15,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '500',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  envBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  envBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },

  /* Logout */
  logoutButton: {
    flexDirection: 'row',
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  logoutButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
});
