import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useLocalization } from '../../src/context';

const RegisterScreen = () => {
  const { colors, resolvedMode } = useLocalization();
  const { t } = useLocalization();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { register } = useAuth();

  const validateInputs = () => {
    if (!email.trim()) {
      Alert.alert(t('errors.error'), t('auth.register.errors.email_required'));
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert(t('errors.error'), t('auth.register.errors.email_invalid'));
      return false;
    }

    if (!password) {
      Alert.alert(t('errors.error'), t('auth.register.errors.password_required'));
      return false;
    }

    if (password.length < 6) {
      Alert.alert(t('errors.error'), t('auth.register.errors.password_min_length'));
      return false;
    }

    if (password !== confirmPassword) {
      Alert.alert(t('errors.error'), t('auth.register.errors.passwords_mismatch'));
      return false;
    }

    return true;
  };

  const handleRegister = async () => {
    if (!validateInputs()) {
      return;
    }

    setLoading(true);
    try {
      await register(email, password);
      router.replace('/');
    } catch (error: any) {
      console.error('Registration error:', error);
      Alert.alert(
        t('auth.register.errors.registration_failed'),
        error.message || t('errors.something_went_wrong'),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      importantForAccessibility="yes"
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} bounces={false}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
            {t('auth.register.title')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.accent }]} accessible>
            {t('auth.register.subtitle')}
          </Text>

          <View style={styles.form} importantForAccessibility="yes">
            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: colors.text }]} accessible>
                {t('auth.register.email_label')}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text }]}
                value={email}
                onChangeText={setEmail}
                placeholder={t('auth.register.email_placeholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                importantForAccessibility="yes"
                accessibilityLabel={t('auth.register.email_label')}
                accessibilityHint={t('auth.register.email_placeholder')}
                accessibilityRole="text"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: colors.text }]} accessible>
                {t('auth.register.password_label')}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text }]}
                value={password}
                onChangeText={setPassword}
                placeholder={t('auth.register.password_placeholder')}
                secureTextEntry
                autoCapitalize="none"
                textContentType="password"
                importantForAccessibility="yes"
                accessibilityLabel={t('auth.register.password_label')}
                accessibilityHint={t('auth.register.password_placeholder')}
                accessibilityRole="text"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: colors.text }]} accessible>
                {t('auth.register.confirm_password_label')}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text }]}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder={t('auth.register.confirm_password_placeholder')}
                secureTextEntry
                autoCapitalize="none"
                textContentType="password"
                importantForAccessibility="yes"
                accessibilityLabel={t('auth.register.confirm_password_label')}
                accessibilityHint={t('auth.register.confirm_password_placeholder')}
                accessibilityRole="text"
              />
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.disabledButton]}
              onPress={handleRegister}
              disabled={loading}
              accessibilityRole="button"
              accessibilityState={{ disabled: loading }}
              accessibilityLabel={t('auth.register.create_account_button')}
              accessibilityHint={t('auth.register.create_account_button')}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" accessible accessibilityLabel={t('common.loading')} />
              ) : (
                <Text style={styles.buttonText} accessible>{t('auth.register.create_account_button')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => router.push('/auth/login')}
              accessibilityRole="link"
              accessibilityLabel={t('auth.register.login_link')}
            >
              <Text style={styles.linkText} accessible>
                {t('auth.register.login_link')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    paddingVertical: 60,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#db74cf',
    textAlign: 'center',
    marginBottom: 40,
    fontWeight: '500',
  },
  form: {
    gap: 24,
  },
  inputContainer: {
    gap: 8,
  },
  label: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    height: 56,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    paddingHorizontal: 16,
    color: '#ffffff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(219, 116, 207, 0.2)',
  },
  button: {
    height: 56,
    backgroundColor: '#7a85ff',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#7a85ff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  disabledButton: {
    backgroundColor: '#5a65cc',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  linkButton: {
    alignSelf: 'center',
    marginTop: 16,
  },
  linkText: {
    color: '#ffffff',
    fontSize: 16,
    opacity: 0.8,
  },
  linkHighlight: {
    color: '#db74cf',
    fontWeight: '600',
  },
});

export default RegisterScreen;
