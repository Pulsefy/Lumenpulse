import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { i18nResourcesToBackend } from 'i18next-resources-to-backend';

// Supported languages
export const supportedLanguages = ['en', 'zh'] as const;
export type LanguageCode = typeof supportedLanguages[number];

// Get device locale
const deviceLocale = Localization.locale?.split('-')[0] || 'en';
const defaultLocale: LanguageCode = supportedLanguages.includes(deviceLocale as LanguageCode) 
  ? (deviceLocale as LanguageCode) 
  : 'en';

// Initialize i18next
i18n
  .use(initReactI18next)
  .use(i18nResourcesToBackend)
  .init({
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
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
  });

export default i18n;
