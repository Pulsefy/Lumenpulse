import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

const supportedLanguages = ['en', 'zh', 'fr'];

export default function SettingsScreen() {
  const { t } = useTranslation();
  const currentLng = i18n.language;
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  const cycleLanguage = () => {
    const idx = supportedLanguages.indexOf(currentLng);
    const next = supportedLanguages[(idx + 1) % supportedLanguages.length];
    i18n.changeLanguage(next);
  };

  const languageName = t('settings.languageName');

  return (
    <ScrollView style=styles.container>
      <Text style=styles.title>{t('settings.title')}</Text>

      <View style=styles.section>
        <Text style=styles.sectionHeader>{t('settings.language')}</Text>
        <Pressable style=styles.row onPress=cycleLanguage>
          <Text style=styles.label>{languageName}</Text>
          <Text style=styles.value>{t('common.next')}</Text>
        </Pressable>
      </View>

      <View style=styles.section>
        <Text style=styles.sectionHeader>{t('settings.notifications')}</Text>
        <View style=styles.row>
          <Text style=styles.label>{t('settings.enableNotifications')}</Text>
          <Switch value={notificationsEnabled} onValueChange={setNotificationsEnabled} />
        </View>
        <View style=styles.row>
          <Text style=styles.label>{t('settings.pushAlerts')}</Text>
          <Switch value=true onValueChange={() =>} />
        </View>
        <View style=styles.row>
          <Text style=styles.label>{t('settings.emailAlerts')}</Text>
          <Switch value=false onValueChange={() =>} />
        </View>
      </View>

      <View style=styles.section>
        <Text style=styles.sectionHeader>{t('settings.security')}</Text>
        <View style=styles.row>
          <Text style=styles.label>{t('settings.biometricLock')}</Text>
          <Switch value={biometricEnabled} onValueChange={setBiometricEnabled} />
        </View>
        <Pressable style=styles.row onPress={() =>}>
          <Text style=styles.label>{t('settings.changePassword')}</Text>
        </Pressable>
        <Pressable style=styles.row onPress={() =>}>
          <Text style=styles.label>{t('settings.twoFactor')}</Text>
        </Pressable>
      </View>

      <View style=styles.section>
        <Text style=styles.sectionHeader>{t('settings.about')}</Text>
        <View style=styles.row>
          <Text style=styles.label>{t('settings.version')}</Text>
          <Text style=styles.value>1.0.0</Text>
        </View>
        <Pressable style=styles.row onPress={() =>}>
          <Text style=styles.label>{t('settings.terms')}</Text>
        </Pressable>
        <Pressable style=styles.row onPress={() =>}>
          <Text style=styles.label>{t('settings.privacy')}</Text>
        </Pressable>
      </View>

      <View style=styles.section>
        <Text style=styles.sectionHeader>{t('settings.dangerZone')}</Text>
        <Pressable style=styles.btn onPress={() =>}>
          <Text style=styles.btnText>{t('settings.logout')}</Text>
        </Pressable>
        <Text style=styles.hint>{t('settings.logoutConfirm')}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f', padding: 20 },
  title: { color: '#ffffff', fontSize: 28, fontWeight: '700', marginTop: 20, marginBottom: 12 },
  section: { backgroundColor: '#1c1c22', borderRadius: 12, padding: 12, marginBottom: 16 },
  sectionHeader: { color: '#9a99a5', fontSize: 13, textTransform: 'uppercase', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  label: { color: '#ffffff', fontSize: 16 },
  value: { color: '#8a8a93', fontSize: 16 },
  btn: { backgroundColor: '#ff453a', borderRadius: 8, alignItems: 'center', padding: 14, marginTop: 8 },
  btnText: { color: '#ffffff', fontWeight: '600' },
  hint: { color: '#8a8a93', fontSize: 13, textAlign: 'center', marginTop: 8 },
});