import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
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
import { useRouter } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';
import { useLocalization } from '../src/context';
import {
  ESTIMATED_FEE_XLM,
  MIN_CONTRIBUTION_AMOUNT,
  TransactionStatus,
  validateContributionAmount,
} from '../lib/stellar';
import { evaluateContributionDraft } from '../lib/contribution-drafts';
import { isTestnetConfigReady } from '../lib/config';
import { storage } from '../lib/storage';

/** How long to wait after the last keystroke before persisting the draft. */
const DRAFT_SAVE_DEBOUNCE_MS = 400;

interface ContributionModalProps {
  visible: boolean;
  projectId: number;
  projectName: string;
  onClose: () => void;
  onSubmit: (amount: string) => Promise<{ transactionHash?: string; errorMessage?: string }>;
}

export default function ContributionModal({
  visible,
  projectId,
  projectName,
  onClose,
  onSubmit,
}: ContributionModalProps) {
  const { colors } = useTheme();
  const { t } = useLocalization();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const draftLoadRequestIdRef = useRef(0);

  const [amount, setAmount] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<TransactionStatus>('idle');
  const [draftRestored, setDraftRestored] = useState(false);
  /** Set once a confirmed contribution consumes the draft. */
  const draftConsumedRef = useRef(false);

  const sanitizeContributionAmount = (text: string) => {
    const cleaned = text.replace(/[^0-9.\-]/g, '');
    const isNegative = cleaned.startsWith('-');
    const numeric = cleaned.replace(/-/g, '');
    const parts = numeric.split('.');
    const normalized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : numeric;
    const formatted = normalized.startsWith('.') ? `0${normalized}` : normalized;

    return isNegative ? `-${formatted}` : formatted;
  };

  const amountHint = t('contribution_modal.amount_hint', {
    min: MIN_CONTRIBUTION_AMOUNT,
    decimals: 7,
  });

  const handleAmountChange = (text: string) => {
    const sanitized = sanitizeContributionAmount(text);
    setAmount(sanitized);

    if (!sanitized || sanitized.endsWith('.')) {
      setValidationError(null);
      return;
    }

    const error = validateContributionAmount(sanitized);
    setValidationError(error);
  };

  const handleClearAmount = () => {
    setAmount('');
    setValidationError(null);
    inputRef.current?.focus();
  };

  const trimmedAmount = amount.trim();
  const isSubmitting = txStatus === 'submitting';
  const isSubmitDisabled =
    isSubmitting || !trimmedAmount || Boolean(validateContributionAmount(trimmedAmount));

  const handleShow = useCallback(() => {
    const requestId = ++draftLoadRequestIdRef.current;

    setTxStatus('idle');
    setDraftRestored(false);
    draftConsumedRef.current = false;
    setAmount('');
    setValidationError(null);

    // Restore a saved draft for this project, if one exists. Restoration
    // only prefills the amount — the user must still review and confirm
    // explicitly; nothing is ever submitted automatically.
    void (async () => {
      try {
        const stored = await storage.getContributionDraft();

        if (requestId !== draftLoadRequestIdRef.current) {
          return;
        }
        if (!stored || stored.projectId !== projectId) {
          return;
        }

        const evaluation = evaluateContributionDraft(stored, {
          isTestnetConfigReady: isTestnetConfigReady(),
          isValidAmount: validateContributionAmount,
        });
        if (!evaluation.resumable) {
          return;
        }

        setAmount(stored.amount);
        setDraftRestored(true);
      } catch {
        // Draft restore is best-effort — fall back to an empty form.
      } finally {
        if (requestId === draftLoadRequestIdRef.current) {
          setTimeout(() => inputRef.current?.focus(), 300);
        }
      }
    })();
  }, [projectId]);

  // Persist (or drop) the draft as the amount changes. A debounced write
  // keeps typing smooth while guaranteeing the draft survives an app restart.
  useEffect(() => {
    const persistDraft = () =>
      storage.storeContributionDraft({
        projectId,
        amount: amount.trim(),
        savedAt: new Date().toISOString(),
      });

    if (!visible || txStatus === 'submitting') {
      // Dismissed mid-typing (before the debounced write fired): flush now so
      // nothing the user entered is lost. After a confirmed contribution the
      // draft was already consumed and must NOT be resurrected here.
      if (!visible && txStatus !== 'submitting' && !draftConsumedRef.current && amount.trim()) {
        void persistDraft();
      }
      return;
    }

    const trimmedAmount = amount.trim();
    if (!trimmedAmount) {
      // Drop immediately (not debounced) so an emptied field can never
      // silently resurrect an old draft after a quick dismissal. Only this
      // project's draft is touched — typing nothing here must not wipe
      // another project's saved draft.
      void storage.getContributionDraft().then((existing) => {
        if (!existing || existing.projectId === projectId) {
          return storage.clearContributionDraft();
        }
        return undefined;
      });
      return;
    }

    const timer = setTimeout(() => {
      if (!draftConsumedRef.current) {
        void persistDraft();
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [amount, visible, projectId, txStatus]);

  const handleConfirm = async () => {
    Keyboard.dismiss();

    const error = validateContributionAmount(amount);
    if (error) {
      setValidationError(error);
      return;
    }

    try {
      setTxStatus('submitting');

      const result = await onSubmit(amount.trim());
      const timestamp = new Date().toISOString();

      // A confirmed contribution no longer needs its draft; failed or
      // rejected attempts keep it so the user can resume later.
      if (result.transactionHash) {
        draftConsumedRef.current = true;
        await storage.clearContributionDraft();
        setDraftRestored(false);
      }

      onClose();

      if (result.transactionHash) {
        router.push({
          pathname: '/transaction-receipt',
          params: {
            txHash: result.transactionHash,
            status: 'success',
            timestamp,
            amount: `${amount.trim()} XLM`,
            txType: 'Payment',
          },
        });
      } else {
        router.push({
          pathname: '/transaction-receipt',
          params: {
            status: 'failed',
            timestamp,
            amount: `${amount.trim()} XLM`,
            txType: 'Payment',
            errorDetail: result.errorMessage || t('errors.transaction_failed'),
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.something_went_wrong');
      onClose();
      router.push({
        pathname: '/transaction-receipt',
        params: {
          status: 'failed',
          timestamp: new Date().toISOString(),
          amount: `${amount.trim()} XLM`,
          txType: 'Payment',
          errorDetail: message,
        },
      });
    }
  };

  const handleDismiss = () => {
    if (txStatus === 'submitting') return;
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={handleShow}
      onRequestClose={handleDismiss}
      accessibilityViewIsModal={true}
    >
      <TouchableWithoutFeedback onPress={handleDismiss}>
        <View style={styles.overlay} accessible accessibilityLabel={t('contribution_modal.title')}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardView}
          >
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
                <View style={styles.sheetHeader}>
                  <Text
                    style={[styles.sheetTitle, { color: colors.text }]}
                    accessible
                    accessibilityRole="header"
                  >
                    {t('contribution_modal.title')}
                  </Text>
                  <TouchableOpacity
                    onPress={handleDismiss}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                  >
                    <Ionicons name="close" size={24} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.projectLabel, { color: colors.textSecondary }]} accessible>
                  {projectName}
                </Text>

                {draftRestored && (
                  <View
                    style={styles.draftNoticeRow}
                    accessible
                    accessibilityLabel={t('contribution_draft.restored_notice')}
                  >
                    <Ionicons name="save-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.draftNoticeText, { color: colors.textSecondary }]}>
                      {t('contribution_draft.restored_notice')}
                    </Text>
                  </View>
                )}

                <View
                  style={[
                    styles.inputWrapper,
                    {
                      borderColor: validationError ? colors.danger : colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  accessible
                  accessibilityLabel={t('contribution_modal.amount_label')}
                  accessibilityRole="text"
                >
                  <Text style={[styles.currencyLabel, { color: colors.textSecondary }]} accessible>
                    XLM
                  </Text>
                  <TextInput
                    ref={inputRef}
                    style={[styles.amountInput, { color: colors.text }]}
                    placeholder="0.00"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                    value={amount}
                    onChangeText={handleAmountChange}
                    editable={!isSubmitting}
                    maxLength={15}
                    accessibilityLabel={t('contribution_modal.amount_label')}
                    accessibilityHint={t('contribution_modal.amount_label')}
                    accessibilityRole="text"
                  />
                  {amount.length > 0 && !isSubmitting && (
                    <TouchableOpacity
                      onPress={handleClearAmount}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      accessibilityRole="button"
                      accessibilityLabel={t('contribution_modal.clear_amount')}
                    >
                      <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>

                {validationError ? (
                  <Text style={[styles.errorText, { color: colors.danger }]} accessible>
                    {validationError}
                  </Text>
                ) : (
                  <Text style={[styles.hintText, { color: colors.textSecondary }]} accessible>
                    {amountHint}
                  </Text>
                )}

                <View style={styles.feeRow}>
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color={colors.textSecondary}
                    accessibilityLabel={t('contribution_modal.estimated_fee', {
                      amount: ESTIMATED_FEE_XLM,
                    })}
                  />
                  <Text style={[styles.feeText, { color: colors.textSecondary }]} accessible>
                    {t('contribution_modal.estimated_fee', { amount: ESTIMATED_FEE_XLM })}
                  </Text>
                </View>

                <Text style={[styles.disclaimer, { color: colors.textSecondary }]} accessible>
                  {t('contribution_modal.disclaimer')}
                </Text>

                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: isSubmitDisabled ? colors.border : colors.accent },
                  ]}
                  onPress={handleConfirm}
                  disabled={isSubmitDisabled}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isSubmitDisabled }}
                  accessibilityLabel={
                    isSubmitting
                      ? t('contribution_modal.submitting')
                      : t('contribution_modal.submit')
                  }
                >
                  {isSubmitting ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator
                        color="#ffffff"
                        size="small"
                        accessible
                        accessibilityLabel={t('common.loading')}
                      />
                      <Text style={[styles.primaryButtonText, { marginLeft: 8 }]} accessible>
                        {t('contribution_modal.submitting')}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryButtonText} accessible>
                      {t('contribution_modal.submit')}
                    </Text>
                  )}
                </TouchableOpacity>
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
  projectLabel: {
    fontSize: 14,
    marginBottom: 20,
  },
  draftNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -12,
    marginBottom: 14,
  },
  draftNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 6,
  },
  currencyLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginRight: 10,
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '700',
    paddingVertical: 0,
  },
  hintText: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
    marginLeft: 4,
  },
  errorText: {
    fontSize: 13,
    marginBottom: 4,
    marginLeft: 4,
  },
  feeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
    gap: 6,
  },
  feeText: {
    fontSize: 13,
  },
  disclaimer: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 20,
  },
  primaryButton: {
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
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
});
