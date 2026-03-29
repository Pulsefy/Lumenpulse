import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { authenticateBiometricPrompt, getBiometricLockEnabled } from '../lib/biometric-lock';

interface BiometricLockGuardProps {
  children: React.ReactNode;
}

export default function BiometricLockGuard({ children }: BiometricLockGuardProps) {
  const { colors } = useTheme();
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const unlock = useCallback(async () => {
    setIsRetrying(true);
    try {
      const result = await authenticateBiometricPrompt('Unlock Lumenpulse');
      setIsLocked(!result.success);
    } catch (error) {
      console.error('Biometric unlock failed:', error);
      setIsLocked(true);
    } finally {
      setIsRetrying(false);
    }
  }, []);

  useEffect(() => {
    const initialize = async () => {
      try {
        const enabled = await getBiometricLockEnabled();

        if (!enabled) {
          setIsLocked(false);
          return;
        }

        const result = await authenticateBiometricPrompt('Unlock Lumenpulse');
        setIsLocked(!result.success);
      } catch (error) {
        console.error('Error initializing biometric lock:', error);
        setIsLocked(false);
      } finally {
        setIsBootstrapping(false);
      }
    };

    void initialize();
  }, []);

  if (isBootstrapping) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={[styles.bootText, { color: colors.textSecondary }]}>Securing session...</Text>
      </View>
    );
  }

  if (isLocked) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.lockCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons name="lock-closed-outline" size={36} color={colors.accent} />
          <Text style={[styles.lockTitle, { color: colors.text }]}>App Locked</Text>
          <Text style={[styles.lockSubtitle, { color: colors.textSecondary }]}>
            Authenticate with Face ID, fingerprint, or passcode to continue.
          </Text>
          <TouchableOpacity
            style={[styles.unlockButton, { backgroundColor: colors.accent }]}
            onPress={() => void unlock()}
            disabled={isRetrying}
            activeOpacity={0.8}
          >
            {isRetrying ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.unlockButtonText}>Try Again</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  bootText: {
    marginTop: 12,
    fontSize: 14,
  },
  lockCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  lockTitle: {
    marginTop: 14,
    fontSize: 24,
    fontWeight: '800',
  },
  lockSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  unlockButton: {
    marginTop: 22,
    height: 48,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 140,
  },
  unlockButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
