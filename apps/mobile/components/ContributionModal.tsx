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
  MIN_CONTRIBUTION_AMOUNT,
  TransactionStatus,
  buildExplorerUrl,
  validateContributionAmount,
} from '../lib/stellar';
import { getEnvironmentConfig } from '../lib/config';

interface ContributionModalProps {
  visible: boolean;
  projectName: string;
  walletPublicKey?: string | null;
  onClose: () => void;
  onSubmit: (amount: string) => Promise<{ transactionHash?: string; errorMessage?: string }>;
}

type Step = 'input' | 'confirm';

function truncateKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}…${key.slice(-6)}`;
}

function SummaryRow({
  label,
  value,
  valueColor,
  colors,
  isLast = false,
}: {
  label: string;
  value: string;
  valueColor?: string;
  colors: ReturnType<typeof useTheme>['colors'];
  isLast?: boolean;
}) {
  return (
    <View
      style={[
        styles.summaryRow,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
      accessible
    >
      <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: valueColor ?? colors.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function ContributionModal({
  visible,
  projectName,
  walletPublicKey,
  onClose,
  onSubmit,
}: ContributionModalProps) {
  const { colors } = useTheme();
  const { t } = useLocalization();
  const inputRef = useRef<TextInput>(null);

  const [step, setStep] = useState<Step>('input');
  const [amount, setAmount] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<TransactionStatus>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

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
    isSubmitting ||
    !trimmedAmount ||
    Boolean(validateContributionAmount(trimmedAmount));

  const handleShow = useCallback(() => {
    setStep('input');
    setAmount('');
    setValidationError(null);
    setTxStatus('idle');
    setTxHash(null);
    setTxError(null);
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const handleConfirm = async () => {
    Keyboard.dismiss();
    const error = validateContributionAmount(amount);
    if (error) { setValidationError(error); return; }
    setStep('confirm');
  };

  const handleConfirm = async () => {
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
      setTxError(err instanceof Error ? err.message : t('errors.something_went_wrong'));
      setTxStatus('failed');
    }
  };

  const handleDismiss = () => {
    if (txStatus === 'submitting') return;
    onClose();
  };

  const showResult = txStatus === 'confirmed' || txStatus === 'failed';

  // ── Result screen ────────────────────────────────────────────────────────
  if (showResult) {
    const isSuccess = txStatus === 'confirmed';
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDismiss}>
        <TouchableWithoutFeedback onPress={handleDismiss}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
                <View style={styles.resultContainer}>
                  <Ionicons
                    name={isSuccess ? 'checkmark-circle' : 'close-circle'}
                    size={64}
                    color={isSuccess ? '#4ecdc4' : colors.danger}
                  />
                  <Text style={[styles.resultTitle, { color: colors.text }]} accessibilityRole="header">
                    {isSuccess ? t('contribution_modal.success') : t('contribution_modal.failed')}
                  </Text>
                  <Text style={[styles.resultMessage, { color: colors.textSecondary }]}>
                    {isSuccess
                      ? t('contribution_modal.success_message', { amount, project: projectName })
                      : txError || t('errors.something_went_wrong')}
                  </Text>
                  {isSuccess && txHash && (
                    <Text style={[styles.explorerLink, { color: colors.accent }]} selectable numberOfLines={1}>
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
                  <Text style={styles.primaryButtonText}>{t('common.done')}</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  }

  // ── Confirmation screen ──────────────────────────────────────────────────
  if (step === 'confirm') {
    const envConfig = getEnvironmentConfig();
    const networkConfigured = !!envConfig.crowdfundContractId;
    const canSign = !!walletPublicKey && networkConfigured;

    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setStep('input')}
        accessibilityViewIsModal={true}
      >
        <TouchableWithoutFeedback onPress={isSubmitting ? undefined : () => setStep('input')}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
                <View style={styles.sheetHeader}>
                  <Text style={[styles.sheetTitle, { color: colors.text }]} accessibilityRole="header">
                    {t('contribution_modal.confirm_title')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setStep('input')}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                  >
                    <Ionicons name="close" size={24} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* Amount highlight */}
                <View style={[styles.amountBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.amountBoxLabel, { color: colors.textSecondary }]}>
                    {t('contribution_modal.confirm_amount')}
                  </Text>
                  <Text style={[styles.amountBoxValue, { color: colors.text }]}>
                    {amount}{' '}
                    <Text style={{ color: colors.textSecondary, fontSize: 18, fontWeight: '400' }}>XLM</Text>
                  </Text>
                </View>

                {/* Details */}
                <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <SummaryRow
                    label={t('contribution_modal.confirm_project')}
                    value={projectName}
                    colors={colors}
                  />
                  <SummaryRow
                    label={t('contribution_modal.confirm_network')}
                    value={envConfig.label}
                    valueColor={networkConfigured ? colors.accent : colors.danger}
                    colors={colors}
                  />
                  <SummaryRow
                    label={t('contribution_modal.confirm_wallet')}
                    value={
                      walletPublicKey
                        ? truncateKey(walletPublicKey)
                        : t('contribution_modal.confirm_wallet_missing')
                    }
                    valueColor={walletPublicKey ? colors.text : colors.danger}
                    colors={colors}
                    isLast
                  />
                </View>

                <View style={styles.feeRow}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                  <Text style={[styles.feeText, { color: colors.textSecondary }]}>
                    {t('contribution_modal.estimated_fee', { amount: ESTIMATED_FEE_XLM })}
                  </Text>
                </View>

                {/* Missing config warning */}
                {!canSign && (
                  <View style={[styles.warningBox, { backgroundColor: colors.danger + '18', borderColor: colors.danger + '44' }]}
                    accessibilityRole="alert"
                  >
                    <Ionicons name="warning-outline" size={16} color={colors.danger} />
                    <Text style={[styles.warningText, { color: colors.danger }]}>
                      {!walletPublicKey
                        ? t('errors.no_stellar_account')
                        : t('contribution_modal.confirm_network_missing')}
                    </Text>
                  </View>
                )}

                <Text style={[styles.disclaimer, { color: colors.textSecondary }]}>
                  {t('contribution_modal.disclaimer')}
                </Text>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.cancelButton, { borderColor: colors.border }]}
                    onPress={() => setStep('input')}
                    disabled={isSubmitting}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cancel')}
                  >
                    <Text style={[styles.cancelButtonText, { color: colors.text }]}>{t('common.cancel')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.confirmButton, { backgroundColor: canSign && !isSubmitting ? colors.accent : colors.border }]}
                    onPress={handleConfirm}
                    disabled={!canSign || isSubmitting}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canSign || isSubmitting }}
                    accessibilityLabel={isSubmitting ? t('contribution_modal.submitting') : t('contribution_modal.confirm_sign')}
                  >
                    {isSubmitting ? (
                      <View style={styles.loadingRow}>
                        <ActivityIndicator color="#ffffff" size="small" />
                        <Text style={[styles.primaryButtonText, { marginLeft: 8 }]}>
                          {t('contribution_modal.submitting')}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryButtonText}>{t('contribution_modal.confirm_sign')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  }

  // ── Input screen ─────────────────────────────────────────────────────────
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
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardView}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
                <View style={styles.sheetHeader}>
                  <Text style={[styles.sheetTitle, { color: colors.text }]} accessibilityRole="header">
                    {t('contribution_modal.title')}
                  </Text>
                  <TouchableOpacity
                    onPress={handleDismiss}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                  >
                    <Ionicons name="close" size={24} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.projectLabel, { color: colors.textSecondary }]}>{projectName}</Text>

                <View
                  style={[
                    styles.inputWrapper,
                    { borderColor: validationError ? colors.danger : colors.border, backgroundColor: colors.card },
                  ]}
                >
                  <Text style={[styles.currencyLabel, { color: colors.textSecondary }]}>XLM</Text>
                  <TextInput
                    ref={inputRef}
                    style={[styles.amountInput, { color: colors.text }]}
                    placeholder="0.00"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                    value={amount}
                    onChangeText={handleAmountChange}
                    maxLength={15}
                    accessibilityLabel={t('contribution_modal.amount_label')}
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
                  <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                  <Text style={[styles.feeText, { color: colors.textSecondary }]}>
                    {t('contribution_modal.estimated_fee', { amount: ESTIMATED_FEE_XLM })}
                  </Text>
                </View>

                <Text style={[styles.disclaimer, { color: colors.textSecondary }]}>
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
                  accessibilityLabel={isSubmitting ? t('contribution_modal.submitting') : t('contribution_modal.submit')}
                >
                  <Text style={styles.primaryButtonText}>{t('contribution_modal.review')}</Text>
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  keyboardView: { justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  projectLabel: { fontSize: 14, marginBottom: 20 },
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
  currencyLabel: { fontSize: 16, fontWeight: '600', marginRight: 10 },
  amountInput: { flex: 1, fontSize: 24, fontWeight: '700', paddingVertical: 0 },
  errorText: { fontSize: 13, marginBottom: 4, marginLeft: 4 },
  feeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 8, gap: 6 },
  feeText: { fontSize: 13 },
  disclaimer: { fontSize: 12, lineHeight: 18, marginBottom: 20 },
  primaryButton: { height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },
  resultContainer: { alignItems: 'center', paddingVertical: 24 },
  resultTitle: { fontSize: 22, fontWeight: '700', marginTop: 16, marginBottom: 8, textAlign: 'center' },
  resultMessage: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 12, paddingHorizontal: 8 },
  explorerLink: { fontSize: 12, textDecorationLine: 'underline', marginTop: 4 },
  // Confirmation
  amountBox: {
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 20, paddingVertical: 16,
    alignItems: 'center', marginBottom: 16,
  },
  amountBoxLabel: { fontSize: 13, marginBottom: 6 },
  amountBoxValue: { fontSize: 36, fontWeight: '800', letterSpacing: -1 },
  detailCard: { borderRadius: 14, borderWidth: 1, marginBottom: 16, overflow: 'hidden' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  summaryLabel: { fontSize: 14, flex: 1 },
  summaryValue: { fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right' },
  warningBox: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 10, borderWidth: 1, padding: 12, gap: 8, marginBottom: 12 },
  warningText: { flex: 1, fontSize: 13, lineHeight: 18 },
  actionRow: { flexDirection: 'row', gap: 12 },
  cancelButton: { flex: 1, height: 52, borderRadius: 14, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  cancelButtonText: { fontSize: 16, fontWeight: '600' },
  confirmButton: { flex: 1, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
});
