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
import {
  ESTIMATED_FEE_XLM,
  TransactionStatus,
  buildExplorerUrl,
  validateContributionAmount,
} from '../lib/stellar';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ContributionModalProps {
  visible: boolean;
  projectName: string;
  onClose: () => void;
  onSubmit: (amount: string) => Promise<{ transactionHash?: string; errorMessage?: string }>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ContributionModal({
  visible,
  projectName,
  onClose,
  onSubmit,
}: ContributionModalProps) {
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);

  const [amount, setAmount] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<TransactionStatus>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  // Reset all state when the modal is freshly opened
  const handleShow = useCallback(() => {
    setAmount('');
    setValidationError(null);
    setTxStatus('idle');
    setTxHash(null);
    setTxError(null);
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const handleAmountChange = (text: string) => {
    // Allow only digits and a single decimal point
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
        setTxError(result.errorMessage || 'Transaction failed. Please try again.');
        setTxStatus('failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setTxError(message);
      setTxStatus('failed');
    }
  };

  const handleDismiss = () => {
    if (txStatus === 'submitting') return; // prevent closing mid-flight
    onClose();
  };

  const isSubmitting = txStatus === 'submitting';
  const showResult = txStatus === 'confirmed' || txStatus === 'failed';

  // ── Result view (success / failure) ───────────────────────────────────────
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
                  <Text style={[styles.resultTitle, { color: colors.text }]}>
                    {isSuccess ? 'Contribution Successful!' : 'Contribution Failed'}
                  </Text>
                  <Text style={[styles.resultMessage, { color: colors.textSecondary }]}>
                    {isSuccess
                      ? `You contributed ${amount} XLM to ${projectName}.`
                      : txError || 'Something went wrong.'}
                  </Text>

                  {isSuccess && txHash && (
                    <Text
                      style={[styles.explorerLink, { color: colors.accent }]}
                      selectable
                      numberOfLines={1}
                    >
                      {buildExplorerUrl(txHash)}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: colors.accent }]}
                  onPress={handleDismiss}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryButtonText}>Done</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  }

  // ── Input view ────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={handleShow}
      onRequestClose={handleDismiss}
    >
      <TouchableWithoutFeedback onPress={handleDismiss}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardView}
          >
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
                {/* Header */}
                <View style={styles.sheetHeader}>
                  <Text style={[styles.sheetTitle, { color: colors.text }]}>
                    Contribute to Project
                  </Text>
                  <TouchableOpacity
                    onPress={handleDismiss}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    disabled={isSubmitting}
                  >
                    <Ionicons name="close" size={24} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.projectLabel, { color: colors.textSecondary }]}>
                  {projectName}
                </Text>

                {/* Amount input */}
                <View
                  style={[
                    styles.inputWrapper,
                    {
                      borderColor: validationError ? colors.danger : colors.border,
                      backgroundColor: colors.card,
                    },
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
                    editable={!isSubmitting}
                    maxLength={15}
                    accessibilityLabel="Contribution amount in XLM"
                  />
                </View>

                {validationError && (
                  <Text style={[styles.errorText, { color: colors.danger }]}>
                    {validationError}
                  </Text>
                )}

                {/* Fee notice */}
                <View style={styles.feeRow}>
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color={colors.textSecondary}
                  />
                  <Text style={[styles.feeText, { color: colors.textSecondary }]}>
                    Estimated network fee: ~{ESTIMATED_FEE_XLM} XLM
                  </Text>
                </View>

                <Text style={[styles.disclaimer, { color: colors.textSecondary }]}>
                  This is an on-chain transaction on the Stellar network. Contributions are
                  non-refundable unless the project is cancelled.
                </Text>

                {/* Confirm button */}
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: isSubmitting ? colors.border : colors.accent },
                  ]}
                  onPress={handleConfirm}
                  disabled={isSubmitting}
                  activeOpacity={0.8}
                >
                  {isSubmitting ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator color="#ffffff" size="small" />
                      <Text style={[styles.primaryButtonText, { marginLeft: 8 }]}>
                        Submitting...
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryButtonText}>Confirm Contribution</Text>
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

// ─── Styles ───────────────────────────────────────────────────────────────────

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

  // Amount input
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

  // Fee / disclaimer
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

  // Buttons
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

  // Result screen
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
