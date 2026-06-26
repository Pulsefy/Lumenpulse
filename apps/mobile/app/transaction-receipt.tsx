import React, { useState } from 'react';
import {
  Clipboard,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';
import { useLocalization } from '../src/context';
import { buildExplorerUrl } from '../lib/stellar';

/**
 * TransactionReceiptScreen
 *
 * Route params (all strings via expo-router search params):
 *   txHash      – transaction hash (optional – may be absent on failure before broadcast)
 *   status      – 'success' | 'failed' | 'pending'
 *   timestamp   – ISO 8601 string
 *   amount      – formatted amount string (e.g. "10.5 XLM"), optional
 *   txType      – human-readable tx type (e.g. "Payment"), optional
 *   errorDetail – error message on failure, optional
 *
 * Can be reached:
 *   1. From ContributionModal after submit completes.
 *   2. From TransactionHistoryScreen when tapping an item (revisit).
 */
export default function TransactionReceiptScreen() {
  const { colors } = useTheme();
  const { t } = useLocalization();
  const router = useRouter();

  const params = useLocalSearchParams<{
    txHash?: string;
    status?: string;
    timestamp?: string;
    amount?: string;
    txType?: string;
    errorDetail?: string;
  }>();

  const {
    txHash,
    status = 'pending',
    timestamp,
    amount,
    txType,
    errorDetail,
  } = params;

  const [hashCopied, setHashCopied] = useState(false);

  const isSuccess = status === 'success';
  const isFailed = status === 'failed';

  const statusColor = isSuccess
    ? colors.success
    : isFailed
    ? colors.danger
    : colors.warning;

  const statusIcon: React.ComponentProps<typeof Ionicons>['name'] = isSuccess
    ? 'checkmark-circle'
    : isFailed
    ? 'close-circle'
    : 'time';

  const statusLabel = isSuccess
    ? t('transaction_receipt.status_success')
    : isFailed
    ? t('transaction_receipt.status_failed')
    : t('transaction_receipt.status_pending');

  const formattedTimestamp = timestamp
    ? new Date(timestamp).toLocaleString()
    : null;

  const handleCopyHash = () => {
    if (!txHash) return;
    Clipboard.setString(txHash);
    setHashCopied(true);
    setTimeout(() => setHashCopied(false), 2000);
  };

  const handleOpenExplorer = () => {
    if (!txHash) return;
    Linking.openURL(buildExplorerUrl(txHash)).catch(() => null);
  };

  const handleDone = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/transaction-history');
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={handleDone}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('transaction_receipt.back')}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} accessibilityRole="header">
          {t('transaction_receipt.title')}
        </Text>
        {/* Spacer to centre title */}
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Status Hero */}
        <View
          style={[styles.hero, { backgroundColor: statusColor + '15', borderColor: statusColor + '40' }]}
          accessible
          accessibilityLabel={statusLabel}
        >
          <Ionicons name={statusIcon} size={56} color={statusColor} />
          <Text style={[styles.heroLabel, { color: statusColor }]}>{statusLabel}</Text>
        </View>

        {/* Detail rows */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          {/* Network */}
          <Row label={t('transaction_receipt.network')} value={t('transaction_receipt.testnet')} colors={colors} />

          {/* Timestamp */}
          {formattedTimestamp && (
            <Row label={t('transaction_receipt.timestamp')} value={formattedTimestamp} colors={colors} />
          )}

          {/* Type */}
          {txType ? (
            <Row label={t('transaction_receipt.type')} value={txType} colors={colors} />
          ) : null}

          {/* Amount */}
          {amount ? (
            <Row label={t('transaction_receipt.amount')} value={amount} colors={colors} bold />
          ) : null}

          {/* Error detail for failed tx */}
          {isFailed && errorDetail ? (
            <Row label={t('transaction_receipt.error_detail')} value={errorDetail} colors={colors} danger />
          ) : null}

          {/* TX Hash */}
          <View style={[styles.row, styles.rowLast]}>
            <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>
              {t('transaction_receipt.hash')}
            </Text>
            {txHash ? (
              <TouchableOpacity
                style={styles.hashRow}
                onPress={handleCopyHash}
                accessibilityRole="button"
                accessibilityLabel={
                  hashCopied
                    ? t('transaction_receipt.hash_copied')
                    : t('transaction_receipt.copy_hash')
                }
              >
                <Text
                  style={[styles.hashText, { color: colors.accent }]}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {txHash}
                </Text>
                <Ionicons
                  name={hashCopied ? 'checkmark' : 'copy-outline'}
                  size={16}
                  color={hashCopied ? colors.success : colors.accent}
                  style={{ marginLeft: 6 }}
                />
              </TouchableOpacity>
            ) : (
              <Text style={[styles.rowValue, { color: colors.textSecondary }]}>
                {t('transaction_receipt.no_hash')}
              </Text>
            )}
          </View>
        </View>

        {/* Explorer link */}
        {txHash && (
          <TouchableOpacity
            style={[styles.explorerButton, { borderColor: colors.accent }]}
            onPress={handleOpenExplorer}
            accessibilityRole="link"
            accessibilityLabel={t('transaction_receipt.view_explorer')}
          >
            <Text style={[styles.explorerText, { color: colors.accent }]}>
              {t('transaction_receipt.view_explorer')}
            </Text>
            <Ionicons name="open-outline" size={16} color={colors.accent} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        )}

        {/* Done button */}
        <TouchableOpacity
          style={[styles.doneButton, { backgroundColor: colors.accent }]}
          onPress={handleDone}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('transaction_receipt.done')}
        >
          <Text style={styles.doneButtonText}>{t('transaction_receipt.done')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Row sub-component ────────────────────────────────────────────────────────

function Row({
  label,
  value,
  colors,
  bold,
  danger,
}: {
  label: string;
  value: string;
  colors: any;
  bold?: boolean;
  danger?: boolean;
}) {
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          { color: danger ? colors.danger : colors.text },
          bold && { fontWeight: '700' },
        ]}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  hero: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 32,
    gap: 12,
  },
  heroLabel: {
    fontSize: 18,
    fontWeight: '700',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowLabel: {
    fontSize: 13,
    flex: 1,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  hashRow: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  hashText: {
    fontSize: 13,
    fontFamily: 'monospace',
    flex: 1,
    textAlign: 'right',
  },
  explorerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
  },
  explorerText: {
    fontSize: 15,
    fontWeight: '600',
  },
  doneButton: {
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
