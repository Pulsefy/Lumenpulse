import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useLocalization } from '../src/context';
import { useReviewerAccess } from '../lib/use-reviewer-access';

interface ReviewerGateProps {
  children: React.ReactNode;
}

export default function ReviewerGate({ children }: ReviewerGateProps) {
  const { colors, t } = useLocalization();
  const { isReviewer, isLoading } = useReviewerAccess();

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          {t('common.loading')}
        </Text>
      </View>
    );
  }

  if (!isReviewer) {
    return <Redirect href="/" />;
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
});
