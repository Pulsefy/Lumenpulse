import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useLocalization } from '../src/context';
import { moderationApi, ReportReason, ReportType } from '../lib/moderation';

interface ReportContentModalProps {
  visible: boolean;
  targetType: ReportType;
  targetId: string;
  targetLabel: string;
  onClose: () => void;
}

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

interface CategoryOption {
  value: ReportReason;
  labelKey: string;
  fallbackLabel: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    value: ReportReason.SPAM,
    labelKey: 'report_modal.category_spam',
    fallbackLabel: 'Spam',
    icon: 'megaphone-outline',
  },
  {
    value: ReportReason.FRAUD,
    labelKey: 'report_modal.category_fraud',
    fallbackLabel: 'Fraud or scam',
    icon: 'warning-outline',
  },
  {
    value: ReportReason.MISLEADING_INFO,
    labelKey: 'report_modal.category_misleading',
    fallbackLabel: 'Misleading info',
    icon: 'alert-circle-outline',
  },
  {
    value: ReportReason.INAPPROPRIATE_CONTENT,
    labelKey: 'report_modal.category_inappropriate',
    fallbackLabel: 'Inappropriate content',
    icon: 'eye-off-outline',
  },
  {
    value: ReportReason.COPYRIGHT_VIOLATION,
    labelKey: 'report_modal.category_copyright',
    fallbackLabel: 'Copyright violation',
    icon: 'document-text-outline',
  },
  {
    value: ReportReason.OTHER,
    labelKey: 'report_modal.category_other',
    fallbackLabel: 'Other',
    icon: 'ellipsis-horizontal-outline',
  },
];

const REASON_MAX_LENGTH = 280;

export default function ReportContentModal({
  visible,
  targetType,
  targetId,
  targetLabel,
  onClose,
}: ReportContentModalProps) {
  const { colors } = useTheme();
  const { t } = useLocalization();

  const [selectedCategory, setSelectedCategory] = useState<ReportReason | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetState = useCallback(() => {
    setSelectedCategory(null);
    setReasonText('');
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  const handleDismiss = useCallback(() => {
    if (status === 'submitting') return;
    onClose();
    // Reset after the close animation has had a moment to run.
    setTimeout(resetState, 250);
  }, [status, onClose, resetState]);

  const handleSubmit = async () => {
    if (!selectedCategory || status === 'submitting') return;

    setStatus('submitting');
    setErrorMessage(null);

    try {
      const response = await moderationApi.createReport({
        targetType,
        targetId,
        reason: selectedCategory,
        description: reasonText.trim() || `${targetLabel} reported`,
      });

      if (response.success) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(response.error?.message || t('report_modal.generic_error'));
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : t('report_modal.generic_error'));
    }
  };

  const isSubmitDisabled = !selectedCategory || status === 'submitting';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleDismiss}
      accessibilityViewIsModal={true}
    >
      <TouchableWithoutFeedback onPress={handleDismiss}>
        <View style={styles.overlay} accessible accessibilityLabel={t('report_modal.title')}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardView}
          >
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
                {status === 'success' ? (
                  // ── Success state ────────────────────────────────────────
                  <View style={styles.resultWrap} accessible accessibilityLiveRegion="polite">
                    <Ionicons name="checkmark-circle" size={48} color={colors.success} />
                    <Text
                      style={[styles.resultTitle, { color: colors.text }]}
                      accessibilityRole="header"
                    >
                      {t('report_modal.success_title')}
                    </Text>
                    <Text style={[styles.resultBody, { color: colors.textSecondary }]}>
                      {t('report_modal.success_body')}
                    </Text>
                    <TouchableOpacity
                      style={[styles.primaryButton, { backgroundColor: colors.accent }]}
                      onPress={handleDismiss}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.done')}
                    >
                      <Text style={styles.primaryButtonText}>{t('common.done')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  // ── Category + reason capture ────────────────────────────
                  <>
                    <View style={styles.sheetHeader}>
                      <Text
                        style={[styles.sheetTitle, { color: colors.text }]}
                        accessible
                        accessibilityRole="header"
                      >
                        {t('report_modal.title')}
                      </Text>
                      <TouchableOpacity
                        onPress={handleDismiss}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        disabled={status === 'submitting'}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.close')}
                      >
                        <Ionicons name="close" size={24} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>

                    <Text
                      style={[styles.targetLabel, { color: colors.textSecondary }]}
                      numberOfLines={1}
                      accessible
                    >
                      {targetLabel}
                    </Text>

                    <Text
                      style={[styles.fieldLabel, { color: colors.text }]}
                      accessible
                      accessibilityRole="header"
                    >
                      {t('report_modal.category_label')}
                    </Text>
                    <View style={styles.categoryGrid}>
                      {CATEGORY_OPTIONS.map((option) => {
                        const isSelected = selectedCategory === option.value;
                        return (
                          <TouchableOpacity
                            key={option.value}
                            style={[
                              styles.categoryChip,
                              {
                                backgroundColor: isSelected ? colors.accent + '22' : colors.card,
                                borderColor: isSelected ? colors.accent : colors.cardBorder,
                              },
                            ]}
                            onPress={() => setSelectedCategory(option.value)}
                            activeOpacity={0.7}
                            disabled={status === 'submitting'}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isSelected }}
                            accessibilityLabel={t(option.labelKey, {
                              defaultValue: option.fallbackLabel,
                            })}
                          >
                            <Ionicons
                              name={option.icon}
                              size={15}
                              color={isSelected ? colors.accent : colors.textSecondary}
                            />
                            <Text
                              style={[
                                styles.categoryChipText,
                                { color: isSelected ? colors.accent : colors.text },
                              ]}
                              numberOfLines={1}
                            >
                              {t(option.labelKey, { defaultValue: option.fallbackLabel })}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text
                      style={[styles.fieldLabel, { color: colors.text, marginTop: 18 }]}
                      accessible
                      accessibilityRole="header"
                    >
                      {t('report_modal.reason_label')}
                    </Text>
                    <TextInput
                      style={[
                        styles.reasonInput,
                        {
                          color: colors.text,
                          borderColor: colors.border,
                          backgroundColor: colors.card,
                        },
                      ]}
                      placeholder={t('report_modal.reason_placeholder')}
                      placeholderTextColor={colors.textSecondary}
                      value={reasonText}
                      onChangeText={(text) => setReasonText(text.slice(0, REASON_MAX_LENGTH))}
                      editable={status !== 'submitting'}
                      multiline
                      numberOfLines={3}
                      maxLength={REASON_MAX_LENGTH}
                      accessibilityLabel={t('report_modal.reason_label')}
                      accessibilityHint={t('report_modal.reason_placeholder')}
                    />
                    <Text style={[styles.charCount, { color: colors.textSecondary }]}>
                      {reasonText.length}/{REASON_MAX_LENGTH}
                    </Text>

                    {status === 'error' && errorMessage && (
                      <View style={styles.errorRow} accessible accessibilityLiveRegion="assertive">
                        <Ionicons name="alert-circle" size={16} color={colors.danger} />
                        <Text style={[styles.errorText, { color: colors.danger }]}>
                          {errorMessage}
                        </Text>
                      </View>
                    )}

                    <TouchableOpacity
                      style={[
                        styles.primaryButton,
                        { backgroundColor: isSubmitDisabled ? colors.border : colors.danger },
                      ]}
                      onPress={handleSubmit}
                      disabled={isSubmitDisabled}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isSubmitDisabled }}
                      accessibilityLabel={
                        status === 'submitting'
                          ? t('report_modal.submitting')
                          : t('report_modal.submit')
                      }
                    >
                      {status === 'submitting' ? (
                        <View style={styles.loadingRow}>
                          <ActivityIndicator color="#ffffff" size="small" />
                          <Text style={[styles.primaryButtonText, { marginLeft: 8 }]}>
                            {t('report_modal.submitting')}
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.primaryButtonText}>{t('report_modal.submit')}</Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  keyboardView: {
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  targetLabel: {
    fontSize: 14,
    marginBottom: 18,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  reasonInput: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 4,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
  },
  primaryButton: {
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultWrap: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  resultTitle: {
    fontSize: 19,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 6,
    textAlign: 'center',
  },
  resultBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
  },
});
