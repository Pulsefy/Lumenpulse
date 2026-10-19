import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useLocalization } from '../../src/context';
import { useExports } from '../../hooks/useExports';
import {
  EXPORT_OPTIONS,
  ExportJob,
  ExportOption,
  ExportStatus,
  ExportType,
  getExportDisplayStatus,
} from '../../lib/exports';

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

function getTypeLabel(type: ExportType, t: (key: string, fallback?: string) => string): string {
  switch (type) {
    case 'tax_transactions':
      return t('settings.exports.tax_transactions', 'Transaction History');
    case 'portfolio_history':
      return t('settings.exports.portfolio_history', 'Portfolio History');
    case 'onchain_analytics':
      return 'On-Chain Analytics';
    case 'round_analytics':
      return 'Round Analytics';
    default:
      return type;
  }
}

export default function ExportsScreen() {
  const { colors, t } = useLocalization();
  const router = useRouter();
  const {
    jobs,
    isLoading,
    isPolling,
    downloadingId,
    requestingType,
    error,
    refresh,
    requestExport,
    downloadExport,
    isTypePending,
  } = useExports();

  const handleRequest = async (type: ExportType) => {
    await requestExport(type);
  };

  const getStatusBadgeConfig = (status: ExportStatus) => {
    switch (status) {
      case 'completed':
        return {
          label: t('settings.exports.status_completed', 'Ready'),
          icon: 'checkmark-circle-outline' as const,
          textColor: colors.success,
          bgColor: colors.success + '20',
          borderColor: colors.success + '40',
        };
      case 'failed':
        return {
          label: t('settings.exports.status_failed', 'Failed'),
          icon: 'alert-circle-outline' as const,
          textColor: colors.danger,
          bgColor: colors.danger + '20',
          borderColor: colors.danger + '40',
        };
      case 'processing':
        return {
          label: t('settings.exports.status_processing', 'Processing'),
          icon: 'sync-outline' as const,
          textColor: colors.accent,
          bgColor: colors.accent + '20',
          borderColor: colors.accent + '40',
        };
      case 'pending':
        return {
          label: t('settings.exports.status_pending', 'Pending'),
          icon: 'time-outline' as const,
          textColor: '#eab308',
          bgColor: 'rgba(234, 179, 8, 0.15)',
          borderColor: 'rgba(234, 179, 8, 0.3)',
        };
      case 'expired':
        return {
          label: t('settings.exports.status_expired', 'Expired'),
          icon: 'hourglass-outline' as const,
          textColor: colors.textSecondary,
          bgColor: colors.card,
          borderColor: colors.border,
        };
      default:
        return {
          label: status,
          icon: 'document-text-outline' as const,
          textColor: colors.textSecondary,
          bgColor: colors.card,
          borderColor: colors.border,
        };
    }
  };

  const renderRequestCard = (option: ExportOption) => {
    const pending = isTypePending(option.type);
    const isBusy = requestingType === option.type;
    const title = t(option.titleKey, option.type === 'tax_transactions' ? 'Transaction History' : 'Portfolio History');
    const desc = t(
      option.descKey,
      option.type === 'tax_transactions'
        ? 'Complete transaction history for tax and accounting.'
        : 'Portfolio snapshots with asset balances and valuations over time.',
    );

    return (
      <View
        key={option.type}
        style={[styles.optionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.optionHeader}>
          <View style={[styles.optionIconShell, { backgroundColor: colors.card }]}>
            <Ionicons name={option.icon as any} size={22} color={colors.accent} />
          </View>
          <View style={styles.optionCopy}>
            <View style={styles.optionTitleRow}>
              <Text style={[styles.optionTitle, { color: colors.text }]} accessible>
                {title}
              </Text>
              {pending && (
                <View
                  style={[styles.pendingPill, { backgroundColor: 'rgba(234, 179, 8, 0.15)' }]}
                  accessible
                  accessibilityLabel="Pending export in progress"
                >
                  <Ionicons name="time-outline" size={12} color="#eab308" />
                  <Text style={[styles.pendingPillText, { color: '#eab308' }]}>
                    {t('settings.exports.status_pending', 'Pending')}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.optionDesc, { color: colors.textSecondary }]} accessible>
              {desc}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          testID={`request-export-${option.type}`}
          style={[
            styles.requestButton,
            {
              backgroundColor: pending ? colors.card : colors.accent,
              borderColor: pending ? colors.border : colors.accent,
              opacity: pending || isBusy ? 0.6 : 1,
            },
          ]}
          onPress={() => handleRequest(option.type)}
          disabled={pending || isBusy}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={
            pending
              ? `${title}: ${t('settings.exports.already_in_progress', 'Export in progress')}`
              : `${t('settings.exports.request_export', 'Request Export')}: ${title}`
          }
          accessibilityState={{ disabled: pending || isBusy }}
        >
          {isBusy ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons
                name={pending ? 'hourglass-outline' : 'cloud-download-outline'}
                size={16}
                color={pending ? colors.textSecondary : '#ffffff'}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.requestButtonText,
                  { color: pending ? colors.textSecondary : '#ffffff' },
                ]}
              >
                {pending
                  ? t('settings.exports.export_in_progress', 'Export in Progress')
                  : t('settings.exports.request_export', 'Request Export')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderJobItem = ({ item }: { item: ExportJob }) => {
    const displayStatus = getExportDisplayStatus(item);
    const badge = getStatusBadgeConfig(displayStatus);
    const isDownloading = downloadingId === item.id;
    const isPendingOrProcessing = displayStatus === 'pending' || displayStatus === 'processing';
    const isCompleted = displayStatus === 'completed';
    const isFailed = displayStatus === 'failed';
    const isExpired = displayStatus === 'expired';

    const typeTitle = getTypeLabel(item.type, t);

    return (
      <View
        testID={`export-job-${item.id}`}
        style={[
          styles.jobCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: isExpired ? 0.75 : 1,
          },
        ]}
      >
        <View style={styles.jobTopRow}>
          <View style={styles.jobTypeWrap}>
            <Text style={[styles.jobTitle, { color: colors.text }]} accessible>
              {typeTitle}
            </Text>
            <Text style={[styles.jobDate, { color: colors.textSecondary }]} accessible>
              {formatDate(item.createdAt)}
            </Text>
          </View>

          {/* Status Badge */}
          <View
            testID={`export-status-${displayStatus}-${item.id}`}
            style={[
              styles.statusBadge,
              { backgroundColor: badge.bgColor, borderColor: badge.borderColor },
            ]}
            accessible
            accessibilityLabel={`Status: ${badge.label}`}
          >
            {isPendingOrProcessing ? (
              <ActivityIndicator size="small" color={badge.textColor} style={{ marginRight: 4 }} />
            ) : (
              <Ionicons name={badge.icon} size={14} color={badge.textColor} style={{ marginRight: 4 }} />
            )}
            <Text style={[styles.statusText, { color: badge.textColor }]}>{badge.label}</Text>
          </View>
        </View>

        {/* Action Row */}
        <View style={styles.jobBottomRow}>
          {isCompleted && (
            <TouchableOpacity
              testID={`export-download-${item.id}`}
              style={[
                styles.downloadButton,
                { backgroundColor: colors.accent + '20', borderColor: colors.accent },
              ]}
              onPress={() => downloadExport(item.id)}
              disabled={isDownloading}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`${t('settings.exports.download', 'Download')} ${typeTitle}`}
              accessibilityHint="Opens the system share sheet to save or send the export file"
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <>
                  <Ionicons
                    name={Platform.OS === 'web' ? 'download-outline' : 'share-outline'}
                    size={16}
                    color={colors.accent}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.downloadButtonText, { color: colors.accent }]}>
                    {Platform.OS === 'web'
                      ? t('settings.exports.download', 'Download')
                      : t('settings.exports.share_title', 'Share File')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {isFailed && (
            <TouchableOpacity
              testID={`export-retry-${item.id}`}
              style={[
                styles.retryButton,
                { backgroundColor: colors.danger + '15', borderColor: colors.danger + '40' },
              ]}
              onPress={() => handleRequest(item.type)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Retry export ${typeTitle}`}
            >
              <Ionicons name="refresh-outline" size={14} color={colors.danger} style={{ marginRight: 4 }} />
              <Text style={[styles.retryButtonText, { color: colors.danger }]}>
                {t('common.retry', 'Retry')}
              </Text>
            </TouchableOpacity>
          )}

          {isExpired && (
            <Text
              testID={`export-expired-label-${item.id}`}
              style={[styles.expiredNote, { color: colors.textSecondary }]}
              accessible
            >
              {t('settings.exports.expired_desc', 'Download expired (valid for 24h)')}
            </Text>
          )}

          {isPendingOrProcessing && (
            <Text style={[styles.processingNote, { color: colors.textSecondary }]} accessible>
              {displayStatus === 'processing'
                ? 'Building export data...'
                : 'Queued for processing...'}
            </Text>
          )}
        </View>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.listHeader}>
      <Text style={[styles.sectionIntro, { color: colors.textSecondary }]} accessible>
        {t(
          'settings.exports.request_export_desc',
          'Request an asynchronous export of your transaction history or portfolio records. Completed files can be downloaded or shared directly via the system share sheet.',
        )}
      </Text>

      {/* Request Options */}
      <View style={styles.optionsSection}>{EXPORT_OPTIONS.map(renderRequestCard)}</View>

      {/* History Header */}
      <View style={styles.historyHeaderRow}>
        <View style={styles.historyTitleWrap}>
          <Text style={[styles.sectionTitle, { color: colors.text }]} accessible accessibilityRole="header">
            {t('settings.exports.history_title', 'Export History')}
          </Text>
          {isPolling && (
            <View
              testID="polling-indicator"
              style={[styles.pollingBadge, { backgroundColor: colors.card, borderColor: colors.border }]}
              accessible
              accessibilityLabel="Polling active export jobs"
            >
              <ActivityIndicator size="small" color={colors.accent} style={{ transform: [{ scale: 0.7 }] }} />
              <Text style={[styles.pollingText, { color: colors.accent }]}>
                Checking status...
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          testID="refresh-exports-button"
          style={[styles.refreshIconButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={refresh}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('settings.exports.refresh', 'Refresh exports')}
        >
          <Ionicons name="refresh-outline" size={16} color={colors.text} />
        </TouchableOpacity>
      </View>

      {error && jobs.length === 0 && (
        <View style={[styles.errorCard, { backgroundColor: colors.danger + '15', borderColor: colors.danger + '40' }]}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
        </View>
      )}
    </View>
  );

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 12 }]}>
            Loading exports...
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer} testID="no-exports-empty-state">
        <View style={[styles.emptyIconShell, { backgroundColor: colors.surface }]}>
          <Ionicons name="document-text-outline" size={32} color={colors.textSecondary} />
        </View>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]} accessible>
          {t('settings.exports.no_exports', 'No exports yet. Request your first export above.')}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Screen Top Bar */}
      <View style={[styles.navHeader, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} accessible accessibilityRole="header">
          {t('settings.exports.title', 'Data Exports')}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={renderJobItem}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && jobs.length > 0}
            onRefresh={refresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
    paddingBottom: 48,
  },
  listHeader: {
    marginBottom: 16,
  },
  sectionIntro: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  optionsSection: {
    gap: 12,
    marginBottom: 24,
  },
  optionCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  optionIconShell: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  optionCopy: {
    flex: 1,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  optionDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  pendingPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  requestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  requestButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 12,
  },
  historyTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  pollingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  pollingText: {
    fontSize: 11,
    fontWeight: '500',
  },
  refreshIconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  jobCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  jobTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  jobTypeWrap: {
    flex: 1,
    marginRight: 8,
  },
  jobTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  jobDate: {
    fontSize: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  jobBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  downloadButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  retryButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  expiredNote: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  processingNote: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  emptyIconShell: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 240,
    lineHeight: 20,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
  },
});
