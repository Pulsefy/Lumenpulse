import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import ReviewerGate from '../../components/ReviewerGate';
import { useLocalization } from '../../src/context';
import { flushModerationDecisions } from '../../lib/moderation-decisions';
import { formatReportAge } from '../../lib/moderation-decisions-core';
import { ContentReport, ReportStatus, moderationApi } from '../../lib/moderation';

export default function ModerationQueueScreen() {
  return (
    <ReviewerGate>
      <ModerationQueue />
    </ReviewerGate>
  );
}

function ModerationQueue() {
  const { colors, t } = useLocalization();
  const router = useRouter();

  const [reports, setReports] = useState<ContentReport[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await moderationApi.getModerationQueue({
          status: ReportStatus.PENDING,
          limit: 50,
        });

        if (response.success && response.data) {
          setReports(response.data.reports);
          setTotal(response.data.total);
        } else {
          setError(response.error?.message ?? t('moderation.load_error'));
        }
      } catch {
        setError(t('moderation.load_error'));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      void load(false);
      void flushModerationDecisions();
    }, [load]),
  );

  const openReport = (report: ContentReport) => {
    router.push({
      pathname: '/moderation/[id]',
      params: {
        id: report.id,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        description: report.description ?? '',
        createdAt: report.createdAt,
        reviewNotes: report.reviewNotes ?? '',
      },
    });
  };

  const renderReport = ({ item }: { item: ContentReport }) => (
    <TouchableOpacity
      testID={`moderation-report-${item.id}`}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
      activeOpacity={0.75}
      onPress={() => openReport(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.targetType} report, ${item.reason}, ${formatReportAge(item.createdAt)}`}
      accessibilityHint="Opens the report details and moderation actions"
    >
      <View style={styles.cardHeader}>
        <Text
          style={[styles.cardTarget, { color: colors.text }]}
          numberOfLines={1}
          accessible
          accessibilityRole="header"
        >
          {`${t(`moderation.target_types.${item.targetType}`, item.targetType)} · ${item.targetId}`}
        </Text>
        <Text style={[styles.cardAge, { color: colors.textSecondary }]} accessible>
          {formatReportAge(item.createdAt)}
        </Text>
      </View>

      <View style={styles.reasonRow}>
        <View style={[styles.reasonBadge, { backgroundColor: colors.warning + '22' }]}>
          <Text style={[styles.reasonBadgeText, { color: colors.warning }]} accessible>
            {t(`moderation.reasons.${item.reason}`, item.reason.replace(/_/g, ' '))}
          </Text>
        </View>
        <Text style={[styles.cardStatus, { color: colors.textSecondary }]} accessible>
          {t(`moderation.statuses.${item.status}`, item.status.replace(/_/g, ' '))}
        </Text>
      </View>

      {item.description ? (
        <Text
          style={[styles.cardDescription, { color: colors.textSecondary }]}
          numberOfLines={2}
          accessible
        >
          {item.description}
        </Text>
      ) : (
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]} accessible>
          {t('moderation.no_description')}
        </Text>
      )}
    </TouchableOpacity>
  );

  const renderBody = () => {
    if (isLoading && reports.length === 0) {
      return (
        <View style={styles.center} accessible accessibilityLabel={t('common.loading')}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      );
    }

    if (error && reports.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.danger }]} accessible>
            {error}
          </Text>
          <TouchableOpacity
            testID="moderation-retry"
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
            onPress={() => void load(false)}
            accessibilityRole="button"
            accessibilityLabel={t('moderation.retry')}
          >
            <Text style={[styles.retryButtonText, { color: colors.onAccent }]}>
              {t('moderation.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        renderItem={renderReport}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void load(true)}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="checkmark-done-outline" size={32} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]} accessible>
              {t('moderation.empty')}
            </Text>
          </View>
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/settings'))}
          accessibilityRole="button"
          accessibilityLabel={t('transaction_receipt.back')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: colors.text }]} accessibilityRole="header">
            {t('moderation.title')}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} accessible>
            {total > 0 ? t('moderation.pending_count', { count: total }) : t('moderation.subtitle')}
          </Text>
        </View>
      </View>

      {error && reports.length > 0 ? (
        <Text style={[styles.errorBanner, { color: colors.danger }]} accessible>
          {error}
        </Text>
      ) : null}

      {renderBody()}
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
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  listContent: {
    padding: 16,
    gap: 12,
    flexGrow: 1,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardTarget: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  cardAge: {
    fontSize: 12,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reasonBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reasonBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardStatus: {
    fontSize: 12,
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  errorBanner: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  retryButton: {
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
