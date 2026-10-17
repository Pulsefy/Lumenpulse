import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import {
  buildSubmission,
  flushFeedbackQueue,
  submitFeedback,
} from '../../src/services/feedback';
import { getQueuedCount } from '../../src/services/feedbackQueue';
import { getDiagnosticsPreview } from '../../src/utils/diagnostics';

type FeedbackSource = 'settings' | 'error';

export default function FeedbackScreen() {
  const params = useLocalSearchParams<{ source?: FeedbackSource }>();
  const source: FeedbackSource = params.source === 'error' ? 'error' : 'settings';

  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [showDiagnostics] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [preview, setPreview] = useState('');

  const refreshPreview = useCallback(() => {
    setPreview(getDiagnosticsPreview());
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      setQueuedCount(await getQueuedCount());
    } catch {
      setQueuedCount(0);
    }
  }, []);

  useEffect(() => {
    refreshPreview();
    void refreshQueue();
  }, [refreshPreview, refreshQueue]);

  const canSubmit = useMemo(() => message.trim().length > 0 && !submitting, [message, submitting]);

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const submission = buildSubmission(message, source, email);
      const result = await submitFeedback(submission);
      if (result.status === 'sent') {
        Alert.alert('Thank you', 'Your feedback was sent.', [
          {
            text: 'Done',
            onPress: () => router.back(),
          },
        ]);
      } else {
        Alert.alert(
          'Queued',
          'You are offline. Your feedback will be sent when the connection returns.',
          [{ text: 'OK', onPress: () => router.back() }],
        );
      }
      setMessage('');
      setEmail('');
      await refreshQueue();
    } catch (error) {
      Alert.alert(
        'Could not send feedback',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, message, source, email, refreshQueue]);

  const onRetryQueue = useCallback(async () => {
    try {
      const flushed = await flushFeedbackQueue();
      Alert.alert('Queue updated', `${flushed} item(s) sent.`);
    } catch {
      Alert.alert('Still offline', 'Queued feedback will be retried later.');
    } finally {
      await refreshQueue();
    }
  }, [refreshQueue]);

  return (
    <KeyboardAvoidingView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Send feedback</Text>
        <Text style={styles.subtitle}>
          Tell us what happened. We attach diagnostics so we can reproduce the issue.
        </Text>

        <Text style={styles.label}>What were you trying to do?</Text>
        <TextInput
          style={[Styles.input, styles.multilineInput]}
          multiline
          value={message}
          onChangeText={setMessage}
          placeholder="Describe the problem and what you expected to happen"
          placeholderTextColor="#888"
          autoCorrect
          maxLength={4000}
        />

        <Text style={styles.label}>Contact email (optional)</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor="#888"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {showDiagnostics && (
          <View style={styles.diagnosticsBox}>
            <Text style={styles.diagnosticsTitle}>What will be attached</Text>
            <Text style={styles.diagnosticsText}>{preview} </Text>
            <Text style={styles.note}>
              Wallet addresses, tokens and secure-storage contents are never attached.
            </Text>
          </View>
        )}

        {queuedCount > 0 && (
          <View style={styles.queueBox}>
            <Text style={styles.queueText}>
              {queuedCount} feedback item(s) waiting to be sent.
            </Text>
            <TouchableOpacity onPress={onRetryQueue} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry now</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          onPress={onSubmit}
          disabled={!canSubmit}
          style={[
            styles.submitButton,
            !canSubmit && styles.submitButtonDisabled,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Submit feedback</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#555', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    marginBottom: 16,
    color: '#111',
  },
  multilineInput: { minHeight: 120, textAlignVertical: 'top' },
  diagnosticsBox: {
    backgroundColor: '#f6f6f9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  diagnosticsTitle: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  diagnosticsText: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: 12, color: '#333' },
  note: { fontSize: 12, color: '#777', marginTop: 8 },
  queueBox: {
    backgroundColor: '#fff7e6',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  queueText: { fontSize: 13, color: '#856404' },
  retryButton: { marginTop: 8 },
  retryText: { fontSize: 13, fontWeight: '600', color: '#0b66cc' },
  submitButton: {
    backgroundColor: '#0b66cc',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
