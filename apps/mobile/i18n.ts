import { initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import { getLocales } from 'expo-localization';
import en from './locales/en.json';
import zh from './locales/zh.json';
import fr from './locales/fr.json';

const resources = {
  en: { translation: en },
  zh: { translation: zh },
  fr: { translation: fr },
};

const deviceLanguage = getLocales()[0]?.languageCode ?? 'en';
const lng = Object.keys(resources).includes(deviceLanguage) ? deviceLanguage : 'en';

i18n.use(initReactI18next).init({
  resources,
  lng,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;