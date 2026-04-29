import React, { useCallback, useRef, useState } from 'react';
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
import { useTheme } from '../contexts/ThemeContext';
import { useLocalization } from '../src/context';
import {
  ESTIMATED_FEE_XLM,
  TransactionStatus,
  buildExplorerUrl,
  validateContributionAmount,
} from '../lib/stellar';

interface ContributionModalProps {
  visible: boolean;
  projectName: string;
  onClose: () => void;
  onSubmit: (amount: string) => Promise<{ transactionHash?: string; errorMessage?: string }>;
}

export default function ContributionModal({
  visible,
  projectName,
  onClose,
  onSubmit,
}: ContributionModalProps) {
  const { colors } = useTheme();
  const { t } = useLocalization();
  const inputRef = useRef<TextInput>(null);

  const [amount, setAmount] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<TransactionStatus>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const handleShow = useCallback(() => {
    setAmount('');
    setValidationError(null);
    setTxStatus('idle');
    setTxHash(null);
    setTxError(null);
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const handleAmountChange = (text: string) => {
    const sanitized = text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    setAmount(sanitized);
    if (validationError) setValidationError(null);
  };

  const handleConfirm = async () => {
    Keyboard.dismiss();

    const error = validateContributionAmount(amount);
    if (error) {
      setValidationError(error);
      return;
    }

    try {
      setTxStatus('submitting');
      setTxError(null);

      const result = await onSubmit(amount.trim());

      if (result.transactionHash) {
        setTxHash(result.transactionHash);
        setTxStatus('confirmed');
      } else {
        setTxError(result.errorMessage || t('errors.transaction_failed'));
        setTxStatus('failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.something_went_wrong');
      setTxError(message);
      setTxStatus('failed');
    }
  };

  const handleDismiss = () => {
    if (txStatus === 'submitting') return;
    onClose();
  };

  const isSubmitting = txStatus === 'submitting';
  const showResult = txStatus === 'confirmed' || txStatus === 'failed';

  if (showResult) {
    const isSuccess = txStatus === 'confirmed';
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDismiss}>
        <TouchableWithoutFeedback onPress={handleDismiss}>
          <View style={styles.overlay} accessible accessibilityLabel={t('contribution_modal.title')}>
            <TouchableWithoutFeedback>
              <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
                <View style={styles.resultContainer}>
                  <Ionicons
                    name={isSuccess ? 'checkmark-circle' : 'close-circle'}
                    size={64}
                    color={isSuccess ? '#4ecdc4' : colors.danger}
                    accessibilityLabel={
                      isSuccess
                        ? t('contribution_modal.success')
                        : t('contribution_modal.failed')
                    }
                  />
                  <Text style={[styles.resultTitle, { color: colors.text }]} accessible accessibilityRole="header">
                    {isSuccess
                      ? t('contribution_modal.success')
                      : t('contribution_modal.failed')}
                  </Text>
                  <Text style={[styles.resultMessage, { color: colors.textSecondary }]} accessible>
                    {isSuccess
                      ? t('contribution_modal.success_message', {
                          amount,
                          project: projectName,
                        })
                      : txError || t('errors.something_went_wrong')}
                  </Text>

                  {isSuccess && txHash && (
                    <Text
                      style={[styles.explorerLink, { color: colors.accent }]}
                      selectable
                      numberOfLines={1}
                      accessible
                      accessibilityLabel={t('contribution_modal.transaction_hash')}
                    >
                      {buildExplorerUrl(txHash)}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: colors.accent }]}
                  onPress={handleDismiss}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.done')}
                >
                  <Text style={styles.primaryButtonText} accessible>{t('common.done')}</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  }

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
                  <Text style={[styles.sheetTitle, { color: colors.text }]} accessible accessibilityRole="header">
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
                </View>

                {validationError && (
                  <Text style={[styles.errorText, { color: colors.danger }]} accessible>
                    {validationError}
                  </Text>
                )}

                <View style={styles.feeRow}>
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color={colors.textSecondary}
                    accessibilityLabel={t('contribution_modal.estimated_fee', { amount: ESTIMATED_FEE_XLM })}
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
                    { backgroundColor: isSubmitting ? colors.border : colors.accent },
                  ]}
                  onPress={handleConfirm}
                  disabled={isSubmitting}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isSubmitting }}
                  accessibilityLabel={isSubmitting ? t('contribution_modal.submitting') : t('contribution_modal.submit')}
                >
                  {isSubmitting ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator color="#ffffff" size="small" accessible accessibilityLabel={t('common.loading')} />
                      <Text style={[styles.primaryButtonText, { marginLeft: 8 }]} accessible>
                        {t('contribution_modal.submitting')}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryButtonText} accessible>{t('contribution_modal.submit')}</Text>
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
  resultContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  resultTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  resultMessage: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  explorerLink: {
    fontSize: 12,
    textDecorationLine: 'underline',
    marginTop: 4,
  },
});
