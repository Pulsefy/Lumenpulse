import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ReviewerGate from '../../components/ReviewerGate';
import { useLocalization } from '../../src/context';
import { flushModerationDecisions, moderationDecisions } from '../../lib/moderation-decisions';
import {
  DecisionHistoryEntry,
  DecisionSyncState,
  MAX_RATIONALE_LENGTH,
  ModerationAction,
  formatReportAge,
  validateRationale,
} from '../../lib/moderation-decisions-core';
import { mutationQueue } from '../../lib/mutation-queue';

const STATE_LABEL_KEYS: Record<DecisionSyncState, string> = {
  queued: 'moderation.history_queued',
  syncing: 'moderation.history_syncing',
  failed: 'moderation.history_failed',
  applied: 'moderation.history_applied',
};

const STATE_COLORS: Record<DecisionSyncState, 'accent' | 'warning' | 'danger' | 'success'> = {
  queued: 'accent',
  syncing: 'warning',
  failed: 'danger',
  applied: 'success',
};

export default function ModerationReportScreen() {
  return (
    <ReviewerGate>
      <ModerationReport />
    </ReviewerGate>
  );
}

function ModerationReport() {
  const { colors, t } = useLocalization();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string;
    targetType?: string;
    targetId?: string;
    reason?: string;
    description?: string;
    createdAt?: string;
    reviewNotes?: string;
  }>();

  const reportId = typeof params.id === 'string' ? params.id : '';
  const targetType = typeof params.targetType === 'string' ? params.targetType : '';
  const targetId = typeof params.targetId === 'string' ? params.targetId : '';
  const reason = typeof params.reason === 'string' ? params.reason : '';
  const description = typeof params.description === 'string' ? params.description : '';
  const createdAt = typeof params.createdAt === 'string' ? params.createdAt : '';
  const reviewNotes = typeof params.reviewNotes === 'string' ? params.reviewNotes : '';

  const [rationale, setRationale] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<ModerationAction | null>(null);
  const [history, setHistory] = useState<DecisionHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const refreshHistory = useCallback(async () => {
    if (!reportId) {
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    try {
      const entries = await moderationDecisions.getHistory(reportId);
      setHistory(entries);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    const unsubscribe = mutationQueue.subscribe(() => {
      void refreshHistory();
    });
    void refreshHistory();
    void flushModerationDecisions();
    return unsubscribe;
  }, [refreshHistory]);

  const submitDecision = useCallback(
    async (action: ModerationAction) => {
      if (!reportId || busyAction) {
        return;
      }

      const validation = validateRationale(rationale);
      if (validation) {
        setNotice(null);
        setFormError(t(`moderation.${validation}`));
        return;
      }

      setBusyAction(action);
      setFormError(null);
      setNotice(null);

      try {
        const result = await moderationDecisions.submitDecision({ reportId, action, rationale });

        if (!result.ok) {
          if (result.validationError && result.validationError !== 'unknown_action') {
            setFormError(t(`moderation.${result.validationError}`));
          } else {
            setFormError(result.error ?? t('moderation.decision_failed'));
          }
        } else {
          setFormError(null);
          setRationale('');
          setNotice(
            result.queued ? t('moderation.decision_queued') : t('moderation.decision_recorded'),
          );
        }
      } catch {
        setFormError(t('moderation.decision_failed'));
      } finally {
        setBusyAction(null);
        await refreshHistory();
      }
    },
    [busyAction, rationale, reportId, refreshHistory, t],
  );

  const actionLabel = useCallback(
    (action: ModerationAction) => t(`moderation.actions.${action}`),
    [t],
  );

  const renderActionButton = (action: ModerationAction, tone: string) => (
    <TouchableOpacity
      testID={`moderation-action-${action}`}
      style={[styles.actionButton, { borderColor: tone, opacity: busyAction ? 0.6 : 1 }]}
      onPress={() => void submitDecision(action)}
      disabled={busyAction !== null}
      accessibilityRole="button"
      accessibilityLabel={`${actionLabel(action)}: ${t('moderation.rationale_label')}`}
      accessibilityState={{ disabled: busyAction !== null }}
    >
      <Text style={[styles.actionButtonText, { color: tone }]}>{actionLabel(action)}</Text>
    </TouchableOpacity>
  );

  const renderHistoryEntry = (entry: DecisionHistoryEntry) => {
    const tone = colors[STATE_COLORS[entry.state]];
    return (
      <View
        key={entry.id}
        testID={`moderation-history-${entry.id}`}
        style={[
          styles.historyCard,
          { backgroundColor: colors.surface, borderColor: colors.cardBorder },
        ]}
      >
        <View style={styles.historyHeader}>
          <Text style={[styles.historyAction, { color: colors.text }]} accessible>
            {actionLabel(entry.action)}
          </Text>
          <View style={[styles.historyBadge, { borderColor: tone }]}>
            <Text style={[styles.historyBadgeText, { color: tone }]}>
              {t(STATE_LABEL_KEYS[entry.state])}
            </Text>
          </View>
        </View>
        <Text style={[styles.historyMeta, { color: colors.textSecondary }]} accessible>
          {formatReportAge(entry.createdAt)}
        </Text>
        <Text style={[styles.historyRationale, { color: colors.textSecondary }]} accessible>
          {entry.rationale}
        </Text>
        {entry.state === 'failed' && entry.error ? (
          <Text style={[styles.historyError, { color: colors.danger }]} accessible>
            {entry.error}
          </Text>
        ) : null}
      </View>
    );
  };

  const ageLabel = useMemo(() => (createdAt ? formatReportAge(createdAt) : ''), [createdAt]);

  if (!reportId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.danger }]} accessible>
            {t('errors.something_went_wrong')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/moderation'))}
          accessibilityRole="button"
          accessibilityLabel={t('transaction_receipt.back')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} accessibilityRole="header">
          {t('moderation.report_details')}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]} accessibilityRole="header">
              {t('moderation.content')}
            </Text>
            <Text style={[styles.cardValue, { color: colors.text }]} accessible>
              {`${t(`moderation.target_types.${targetType}`, targetType || 'other')} · ${targetId || '—'}`}
            </Text>

            <Text style={[styles.cardLabel, { color: colors.textSecondary }]} accessible>
              {t('moderation.reason')}
            </Text>
            <Text style={[styles.cardValue, { color: colors.text }]} accessible>
              {t(`moderation.reasons.${reason}`, reason ? reason.replace(/_/g, ' ') : '—')}
            </Text>

            <Text style={[styles.cardLabel, { color: colors.textSecondary }]} accessible>
              {t('moderation.reported_at')}
            </Text>
            <Text style={[styles.cardValue, { color: colors.text }]} accessible>
              {ageLabel}
            </Text>

            <Text style={[styles.cardLabel, { color: colors.textSecondary }]} accessible>
              {t('moderation.description')}
            </Text>
            <Text style={[styles.cardValue, { color: colors.text }]} accessible>
              {description || t('moderation.no_description')}
            </Text>

            {reviewNotes ? (
              <>
                <Text style={[styles.cardLabel, { color: colors.textSecondary }]} accessible>
                  {t('moderation.history_title')}
                </Text>
                <Text style={[styles.cardValue, { color: colors.text }]} accessible>
                  {reviewNotes}
                </Text>
              </>
            ) : null}
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]} accessibilityRole="header">
              {t('moderation.decision_section')}
            </Text>

            <Text style={[styles.cardLabel, { color: colors.textSecondary }]} accessible>
              {t('moderation.rationale_label')}
            </Text>
            <TextInput
              testID="moderation-rationale-input"
              style={[
                styles.rationaleInput,
                {
                  color: colors.text,
                  backgroundColor: colors.card,
                  borderColor: formError ? colors.danger : colors.border,
                },
              ]}
              multiline
              maxLength={MAX_RATIONALE_LENGTH}
              value={rationale}
              onChangeText={(value) => {
                setRationale(value);
                if (formError) {
                  setFormError(null);
                }
              }}
              placeholder={t('moderation.rationale_placeholder')}
              placeholderTextColor={colors.textSecondary}
              accessibilityLabel={t('moderation.rationale_label')}
            />

            {formError ? (
              <Text style={[styles.formError, { color: colors.danger }]} accessible>
                {formError}
              </Text>
            ) : null}

            {notice ? (
              <Text style={[styles.notice, { color: colors.accent }]} accessible>
                {notice}
              </Text>
            ) : null}

            <View style={styles.actionRow}>
              {renderActionButton('approve', colors.success)}
              {renderActionButton('reject', colors.danger)}
              {renderActionButton('escalate', colors.warning)}
            </View>

            {busyAction ? (
              <ActivityIndicator color={colors.accent} accessibilityLabel={t('common.loading')} />
            ) : null}
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]} accessibilityRole="header">
              {t('moderation.history_title')}
            </Text>

            {historyLoading ? (
              <ActivityIndicator color={colors.accent} />
            ) : history.length === 0 ? (
              <Text style={[styles.cardValue, { color: colors.textSecondary }]} accessible>
                {t('moderation.history_empty')}
              </Text>
            ) : (
              history.map(renderHistoryEntry)
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  scrollContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 40,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardLabel: {
    fontSize: 12,
    marginTop: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardValue: {
    fontSize: 14,
    lineHeight: 20,
  },
  rationaleInput: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    textAlignVertical: 'top',
    marginTop: 4,
  },
  formError: {
    fontSize: 13,
    marginTop: 6,
  },
  notice: {
    fontSize: 13,
    marginTop: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    gap: 4,
    marginTop: 8,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  historyAction: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  historyBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  historyMeta: {
    fontSize: 12,
  },
  historyRationale: {
    fontSize: 13,
    lineHeight: 18,
  },
  historyError: {
    fontSize: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
