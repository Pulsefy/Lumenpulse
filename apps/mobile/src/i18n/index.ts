import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

// Supported languages
export const supportedLanguages = ['en', 'zh'] as const;
export type LanguageCode = (typeof supportedLanguages)[number];

// Get device locale
const deviceLocale = Localization.getLocales()[0]?.languageCode || 'en';
const defaultLocale: LanguageCode = supportedLanguages.includes(deviceLocale as LanguageCode)
  ? (deviceLocale as LanguageCode)
  : 'en';

// Initialize i18next
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: defaultLocale,
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    debug: __DEV__,
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });
}

export default i18n;
