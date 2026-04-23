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
      Alert.alert('Could not load accounts', response.error?.message ?? 'Try again in a moment.');
      return;
    }

    setAccounts(response.data ?? []);
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      await loadAccounts();
      setLoading(false);
    };

    void bootstrap();
  }, [loadAccounts]);

  const openScanner = async () => {
    const permission = await BarCodeScanner.requestPermissionsAsync();
    const granted = permission.status === 'granted';
    setPermissionGranted(granted);

    if (!granted) {
      Alert.alert(
        'Camera permission required',
        'Allow camera access to scan a Stellar public key QR code.',
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
        'Unsupported QR payload',
        'Scan a Stellar public key QR code or a QR payload containing one.',
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
        'Could not link account',
        response.error?.message ?? 'The account could not be linked.',
      );
      return;
    }

    setNickname('');
    await loadAccounts();
    Alert.alert('Account linked', `${truncateKey(publicKey)} is now available in Settings.`);
  };

  const handleRemove = (account: LinkedStellarAccount) => {
    Alert.alert(
      'Remove linked account',
      `Remove ${account.label || truncateKey(account.publicKey)} from this profile?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setSubmitting(true);
              const response = await usersApi.removeLinkedAccount(account.id);
              setSubmitting(false);

              if (!response.success) {
                Alert.alert(
                  'Could not remove account',
                  response.error?.message ?? 'The account could not be removed.',
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
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>Manage Accounts</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Link Stellar public keys with QR, then remove them if you no longer want them attached
              to this profile.
            </Text>
          </View>
        </View>

        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.cardHeader}>
            <Ionicons name="qr-code-outline" size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Add Account</Text>
          </View>

          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Optional nickname for the next scanned account.
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
            placeholder="e.g. Trading Wallet"
            placeholderTextColor={colors.textSecondary}
          />

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.accent }]}
            onPress={openScanner}
            activeOpacity={0.85}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="scan-outline" size={18} color="#ffffff" />
                <Text style={styles.primaryButtonText}>Scan QR to Add Account</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={[styles.noteText, { color: colors.textSecondary }]}>
            The scanner accepts a raw Stellar public key or a QR payload that contains one.
          </Text>
        </View>

        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.sectionRow}>
            <View style={styles.cardHeader}>
              <Ionicons name="wallet-outline" size={20} color={colors.accent} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Linked Accounts</Text>
            </View>

            <TouchableOpacity onPress={handleRefresh} disabled={refreshing} activeOpacity={0.8}>
              {refreshing ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="refresh-outline" size={20} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : sortedAccounts.length === 0 ? (
            <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
              <Ionicons name="wallet-outline" size={22} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No linked accounts yet
              </Text>
              <Text style={[styles.emptyDescription, { color: colors.textSecondary }]}>
                Scan a Stellar account QR code above to attach it to this profile.
              </Text>
            </View>
          ) : (
            sortedAccounts.map((account, index) => (
              <View key={account.id}>
                {index > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                <View style={styles.accountRow}>
                  <View style={styles.accountCopy}>
                    <Text style={[styles.accountLabel, { color: colors.text }]}>
                      {account.label?.trim() || 'Linked account'}
                    </Text>
                    <Text style={[styles.accountKey, { color: colors.textSecondary }]}>
                      {truncateKey(account.publicKey)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.removeButton, { borderColor: colors.danger }]}
                    onPress={() => handleRemove(account)}
                    activeOpacity={0.8}
                    disabled={submitting}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    <Text style={[styles.removeButtonText, { color: colors.danger }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal
        visible={scannerOpen}
        animationType="slide"
        onRequestClose={() => setScannerOpen(false)}
      >
        <SafeAreaView style={[styles.scannerContainer, { backgroundColor: '#000000' }]}>
          <View style={styles.scannerHeader}>
            <TouchableOpacity
              style={styles.scannerClose}
              onPress={() => setScannerOpen(false)}
              activeOpacity={0.85}
            >
              <Ionicons name="close" size={24} color="#ffffff" />
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>Scan account QR</Text>
            <View style={styles.scannerClose} />
          </View>

          {permissionGranted === false ? (
            <View style={styles.permissionFallback}>
              <Text style={styles.permissionFallbackText}>
                Camera permission is required to scan account QR codes.
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
            <Text style={styles.scannerHint}>
              Point the camera at a Stellar public key QR code.
            </Text>
          </View>
        </SafeAreaView>
      </Modal>
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
