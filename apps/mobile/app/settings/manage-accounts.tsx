import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BarCodeScanner, BarCodeScannerResult } from 'expo-barcode-scanner';
import { LinkedStellarAccount, usersApi } from '../../lib/api';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocalization } from '../../src/context';

const STELLAR_PUBLIC_KEY_REGEX = /\bG[A-Z2-7]{55}\b/;

const truncateKey = (value: string) => `${value.slice(0, 6)}…${value.slice(-6)}`;

const extractPublicKey = (payload: string): string | null => {
  const directMatch = payload.match(STELLAR_PUBLIC_KEY_REGEX);
  if (directMatch?.[0]) {
    return directMatch[0];
  }

  try {
    const decoded = decodeURIComponent(payload);
    const decodedMatch = decoded.match(STELLAR_PUBLIC_KEY_REGEX);
    return decodedMatch?.[0] ?? null;
  } catch {
    return null;
  }
};

export default function ManageAccountsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useLocalization();
  const [accounts, setAccounts] = useState<LinkedStellarAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nickname, setNickname] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [scanLocked, setScanLocked] = useState(false);

  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    [accounts],
  );

  const loadAccounts = useCallback(async () => {
    const response = await usersApi.getLinkedAccounts();

    if (!response.success) {
      Alert.alert(
        t('errors.error'),
        response.error?.message ?? t('errors.couldnt_load', { item: 'accounts' }),
      );
      return;
    }

    setAccounts(response.data ?? []);
  }, [t]);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      await loadAccounts();
      setLoading(false);
    };

    bootstrap();
  }, [loadAccounts]);

  const openScanner = async () => {
    const permission = await BarCodeScanner.requestPermissionsAsync();
    const granted = permission.status === 'granted';
    setPermissionGranted(granted);

    if (!granted) {
      Alert.alert(
        t('settings.manage_accounts.camera_permission'),
        t('settings.manage_accounts.camera_permission_message'),
      );
      return;
    }

    setScanLocked(false);
    setScannerOpen(true);
  };

  const handleScanned = async ({ data }: BarCodeScannerResult) => {
    if (scanLocked || submitting) {
      return;
    }

    setScanLocked(true);
    const publicKey = extractPublicKey(data);

    if (!publicKey) {
      Alert.alert(
        t('settings.manage_accounts.unsupported_qr'),
        t('settings.manage_accounts.unsupported_qr_message'),
      );
      setScanLocked(false);
      return;
    }

    setScannerOpen(false);
    setSubmitting(true);

    const response = await usersApi.linkStellarAccount({
      publicKey,
      label: nickname.trim() || undefined,
    });

    setSubmitting(false);
    setScanLocked(false);

    if (!response.success) {
      Alert.alert(
        t('settings.manage_accounts.could_not_link'),
        response.error?.message ?? t('errors.could_not_link'),
      );
      return;
    }

    setNickname('');
    await loadAccounts();
    Alert.alert(
      t('settings.manage_accounts.account_linked'),
      `${truncateKey(publicKey)} ${t('settings.manage_accounts.account_linked_message')}`,
    );
  };

  const handleRemove = (account: LinkedStellarAccount) => {
    Alert.alert(
      t('settings.manage_accounts.remove_confirm'),
      t('settings.manage_accounts.remove_message', {
        account: account.label || truncateKey(account.publicKey),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.manage_accounts.remove'),
          style: 'destructive' as const,
          onPress: () => {
            void (async () => {
              setSubmitting(true);
              const response = await usersApi.removeLinkedAccount(account.id);
              setSubmitting(false);

              if (!response.success) {
                Alert.alert(
                  t('errors.error'),
                  response.error?.message ?? t('errors.could_not_remove', { item: 'account' }),
                );
                return;
              }

              await loadAccounts();
            })();
          },
        },
      ],
    );
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAccounts();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity
            style={[styles.headerButton, { backgroundColor: colors.card }]}
            onPress={() => router.back()}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            accessibilityHint="Go back to previous screen"
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
              {t('settings.manage_accounts.title')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]} accessible>
              {t('settings.manage_accounts.description')}
            </Text>
          </View>
        </View>

        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={t('settings.manage_accounts.add_account_title')}
        >
          <View style={styles.cardHeader}>
            <Ionicons name="qr-code-outline" size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]} accessible>
              {t('settings.manage_accounts.add_account_title')}
            </Text>
          </View>

          <Text style={[styles.helperText, { color: colors.textSecondary }]} accessible>
            {t('settings.manage_accounts.nickname_hint')}
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.cardBorder,
                color: colors.text,
              },
            ]}
            value={nickname}
            onChangeText={setNickname}
            placeholder={t('settings.manage_accounts.nickname_placeholder')}
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel={t('settings.manage_accounts.nickname_label')}
            accessibilityHint={t('settings.manage_accounts.nickname_hint')}
            accessibilityRole="text"
          />

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.accent }]}
            onPress={openScanner}
            activeOpacity={0.85}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel={t('settings.manage_accounts.scan_qr_label')}
            accessibilityHint={t('settings.manage_accounts.scan_qr_hint')}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" accessibilityLabel={t('common.loading')} />
            ) : (
              <>
                <Ionicons name="scan-outline" size={18} color="#ffffff" />
                <Text style={styles.primaryButtonText} accessible>
                  {t('settings.manage_accounts.scan_qr_label')}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={[styles.noteText, { color: colors.textSecondary }]} accessible>
            {t('settings.manage_accounts.scan_to_attach')}
          </Text>
        </View>

        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={t('settings.manage_accounts.linked_accounts')}
        >
          <View style={styles.sectionRow}>
            <View style={styles.cardHeader}>
              <Ionicons name="wallet-outline" size={20} color={colors.accent} />
              <Text style={[styles.cardTitle, { color: colors.text }]} accessible>
                {t('settings.manage_accounts.linked_accounts')}
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleRefresh}
              disabled={refreshing}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('common.retry')}
              accessibilityHint="Refresh linked accounts"
            >
              {refreshing ? (
                <ActivityIndicator size="small" color={colors.accent} accessibilityLabel={t('common.loading')} />
              ) : (
                <Ionicons name="refresh-outline" size={20} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.accent} accessibilityLabel={t('common.loading')} />
            </View>
          ) : sortedAccounts.length === 0 ? (
            <View style={[styles.emptyState, { backgroundColor: colors.card }]} accessible accessibilityLabel="No linked accounts">
              <Ionicons name="wallet-outline" size={22} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]} accessible accessibilityRole="header">
                {t('settings.manage_accounts.no_linked_accounts')}
              </Text>
              <Text style={[styles.emptyDescription, { color: colors.textSecondary }]} accessible>
                {t('settings.manage_accounts.scan_to_attach')}
              </Text>
            </View>
          ) : (
            sortedAccounts.map((account, index) => (
              <View key={account.id}>
                {index > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                <View style={styles.accountRow} accessible accessibilityLabel={`${account.label || 'Linked account'}: ${truncateKey(account.publicKey)}`}>
                  <View style={styles.accountCopy}>
                    <Text style={[styles.accountLabel, { color: colors.text }]} accessible>
                      {account.label?.trim() || 'Linked account'}
                    </Text>
                    <Text style={[styles.accountKey, { color: colors.textSecondary }]} accessible>
                      {truncateKey(account.publicKey)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.removeButton, { borderColor: colors.danger }]}
                    onPress={() => handleRemove(account)}
                    activeOpacity={0.8}
                    disabled={submitting}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('settings.manage_accounts.remove')} ${account.label || truncateKey(account.publicKey)}`}
                    accessibilityHint="Remove this linked account"
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    <Text style={[styles.removeButtonText, { color: colors.danger }]} accessible>
                      {t('settings.manage_accounts.remove')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        <Modal
          visible={scannerOpen}
          animationType="slide"
          onRequestClose={() => setScannerOpen(false)}
          accessibilityViewIsModal={true}
        >
          <SafeAreaView style={[styles.scannerContainer, { backgroundColor: '#000000' }]}>
            <View style={styles.scannerHeader}>
              <TouchableOpacity
                style={styles.scannerClose}
                onPress={() => setScannerOpen(false)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Ionicons name="close" size={24} color="#ffffff" />
              </TouchableOpacity>
              <Text style={styles.scannerTitle} accessible accessibilityRole="header">
                {t('settings.manage_accounts.scan_qr_label')}
              </Text>
              <View style={styles.scannerClose} />
            </View>

            {permissionGranted === false ? (
              <View style={styles.permissionFallback} accessible accessibilityLabel="Camera permission required">
                <Text style={styles.permissionFallbackText} accessible>
                  {t('settings.manage_accounts.camera_permission_message')}
                </Text>
              </View>
            ) : (
              <BarCodeScanner
                onBarCodeScanned={handleScanned}
                style={StyleSheet.absoluteFillObject}
                barCodeTypes={[BarCodeScanner.Constants.BarCodeType.qr]}
              />
            )}

            <View style={styles.scannerFooter}>
              <Text style={styles.scannerHint} accessible>
                {t('settings.manage_accounts.scanner_hint')}
              </Text>
            </View>
          </SafeAreaView>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  helperText: {
    fontSize: 13,
    marginBottom: 10,
  },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 12,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  noteText: {
    fontSize: 12,
    lineHeight: 18,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  loadingWrap: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyState: {
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptyDescription: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 14,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    paddingVertical: 14,
  },
  accountCopy: {
    flex: 1,
    gap: 4,
  },
  accountLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  accountKey: {
    fontSize: 13,
  },
  removeButton: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 40,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  removeButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  scannerContainer: {
    flex: 1,
  },
  scannerHeader: {
    zIndex: 2,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scannerClose: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  scannerFooter: {
    position: 'absolute',
    bottom: 32,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    borderRadius: 16,
    padding: 16,
  },
  scannerHint: {
    color: '#ffffff',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  permissionFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  permissionFallbackText: {
    color: '#ffffff',
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 22,
  },
});
