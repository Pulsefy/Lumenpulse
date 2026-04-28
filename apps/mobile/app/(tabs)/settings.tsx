import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useLocalization } from '../../src/context';
import {
  authenticateBiometricPrompt,
  getBiometricLockEnabled,
  isBiometricEnrolled,
  isBiometricLockSupported,
  setBiometricLockEnabled,
} from '../../lib/biometric-lock';

const THEME_OPTIONS: { label: string; value: 'system' | 'light' | 'dark'; icon: string }[] = [
  { label: 'System', value: 'system', icon: 'phone-portrait-outline' },
  { label: 'Light', value: 'light', icon: 'sunny-outline' },
  { label: 'Dark', value: 'dark', icon: 'moon-outline' },
];

export default function SettingsScreen() {
  const { logout, isAuthenticated } = useAuth();
  const { colors, setThemeMode, resolvedMode } = useLocalization();
  const { t } = useLocalization();
  const router = useRouter();
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(true);
  const [biometricSaving, setBiometricSaving] = useState(false);

  const appVersion = '1.0.0';
  const appEnv = 'development';

  useEffect(() => {
    const loadBiometricPreference = async () => {
      const enabled = await getBiometricLockEnabled();
      setBiometricEnabled(enabled);
      setBiometricLoading(false);
    };

    loadBiometricPreference();
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/auth/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleBiometricToggle = async (nextValue: boolean) => {
    if (biometricSaving) return;

    setBiometricSaving(true);

    try {
      if (nextValue) {
        const supported = await isBiometricLockSupported();
        if (!supported) {
          Alert.alert(
            t('settings.biometric_lock.not_supported'),
            t('settings.biometric_lock.not_supported_message'),
          );
          return;
        }

        const enrolled = await isBiometricEnrolled();
        if (!enrolled) {
          Alert.alert(
            t('settings.biometric_lock.no_biometrics'),
            t('settings.biometric_lock.no_biometrics_message'),
          );
          return;
        }

        const result = await authenticateBiometricPrompt(t('settings.biometric_lock.confirm_biometric'));
        if (!result.success) return;
      }

      await setBiometricLockEnabled(nextValue);
      setBiometricEnabled(nextValue);
    } catch (error) {
      console.error('Error updating biometric lock setting:', error);
      Alert.alert(
        t('settings.biometric_lock.update_failed'),
        t('settings.biometric_lock.update_failed_message'),
      );
    } finally {
      setBiometricSaving(false);
    }
  };

  const handleThemeChange = (value: 'system' | 'light' | 'dark') => {
    setThemeMode(value);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
          {t('settings.title')}
        </Text>

        <View
          style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={t('settings.account_preferences')}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="options-outline" size={20} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]} accessible>
              {t('settings.account_preferences')}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.navRow}
            activeOpacity={0.75}
            onPress={() => router.push('/settings/manage-accounts')}
            accessibilityRole="link"
            accessibilityLabel={t('settings.manage_accounts.title')}
            accessibilityHint={t('settings.manage_accounts.description')}
          >
            <View style={styles.navRowCopy}>
              <View style={[styles.navIconShell, { backgroundColor: colors.card }]}>
                <Ionicons name="wallet-outline" size={18} color={colors.accent} />
              </View>
              <View style={styles.navTextWrap}>
                <Text style={[styles.navTitle, { color: colors.text }]} accessible>
                  {t('settings.manage_accounts.title')}
                </Text>
                <Text style={[styles.navDescription, { color: colors.textSecondary }]} accessible>
                  {t('settings.manage_accounts.description')}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <TouchableOpacity
            style={styles.navRow}
            activeOpacity={0.75}
            onPress={() => router.push('/settings/notification-settings')}
            accessibilityRole="link"
            accessibilityLabel={t('settings.notification_settings.title')}
            accessibilityHint={t('settings.notification_settings.description')}
          >
            <View style={styles.navRowCopy}>
              <View style={[styles.navIconShell, { backgroundColor: colors.card }]}>
                <Ionicons name="notifications-outline" size={18} color={colors.accent} />
              </View>
              <View style={styles.navTextWrap}>
                <Text style={[styles.navTitle, { color: colors.text }]} accessible>
                  {t('settings.notification_settings.title')}
                </Text>
                <Text style={[styles.navDescription, { color: colors.textSecondary }]} accessible>
                  {t('settings.notification_settings.description')}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.preferenceRow}>
            <View style={styles.navRowCopy}>
              <View style={[styles.navIconShell, { backgroundColor: colors.card }]}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.accent} />
              </View>
              <View style={styles.navTextWrap}>
                <Text style={[styles.navTitle, { color: colors.text }]} accessible>
                  {t('settings.biometric_lock.enable')}
                </Text>
                <Text style={[styles.navDescription, { color: colors.textSecondary }]} accessible>
                  {t('settings.biometric_lock.description')}
                </Text>
              </View>
            </View>

            {biometricLoading || biometricSaving ? (
              <ActivityIndicator color={colors.accent} accessibilityLabel={t('common.loading')} />
            ) : (
              <Switch
                value={biometricEnabled}
                onValueChange={handleBiometricToggle}
                trackColor={{ false: colors.cardBorder, true: colors.accent }}
                thumbColor="#ffffff"
                accessibilityLabel={t('settings.biometric_lock.enable')}
                accessibilityRole="switch"
              />
            )}
          </View>
        </View>

        <View
          style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={t('settings.appearance')}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="color-palette-outline" size={20} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]} accessible>
              {t('settings.appearance')}
            </Text>
          </View>

          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((opt) => {
              const isActive = resolvedMode === opt.value;
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
                  onPress={() => handleThemeChange(opt.value)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`${opt.label} theme`}
                >
                  <Ionicons
                    name={opt.icon as any}
                    size={20}
                    color={isActive ? '#ffffff' : colors.textSecondary}
                  />
                  <Text style={[styles.themeLabel, { color: isActive ? '#ffffff' : colors.text }]} accessible>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View
          style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={t('settings.app_info')}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]} accessible>
              {t('settings.app_info')}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]} accessible>
              {t('settings.version')}
            </Text>
            <Text style={[styles.infoValue, { color: colors.text }]} accessible>
              {appVersion}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]} accessible>
              {t('settings.environment')}
            </Text>
            <View
              style={[styles.envBadge, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              accessible
            >
              <Text style={[styles.envBadgeText, { color: colors.accent }]}>
                {appEnv === 'production' ? t('settings.environment_production') : t('settings.environment_contributor')}
              </Text>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]} accessible>
              {t('settings.platform')}
            </Text>
            <Text style={[styles.infoValue, { color: colors.text }]} accessible>
              Lumenpulse Mobile
            </Text>
          </View>
        </View>

        {isAuthenticated && (
          <TouchableOpacity
            style={[styles.logoutButton, { backgroundColor: colors.danger }]}
            onPress={handleLogout}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('settings.logout')}
            accessibilityHint="Sign out of your account"
          >
            <Ionicons name="log-out-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
            <Text style={styles.logoutButtonText} accessible>{t('settings.logout')}</Text>
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
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  navRowCopy: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navIconShell: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTextWrap: {
    flex: 1,
  },
  navTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  navDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
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
    marginVertical: 14,
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
