import { MessageTemplateKey } from './message-template.keys';

export interface MessageTemplateDefaultDefinition {
  key: string;
  subjectTemplate: string | null;
  titleTemplate: string | null;
  messageTemplate: string | null;
  bodyTemplate: string | null;
  requiredVariables: string[];
  sampleVariables: Record<string, string>;
}

export const MESSAGE_TEMPLATE_DEFAULTS: MessageTemplateDefaultDefinition[] = [
  {
    key: MessageTemplateKey.EMAIL_PASSWORD_RESET,
    subjectTemplate: 'Reset Your Passkey',
    titleTemplate: null,
    messageTemplate: null,
    bodyTemplate:
      'Please use the following link to reset your passkey: {{resetLink}}',
    requiredVariables: ['resetLink'],
    sampleVariables: {
      resetLink:
        'http://localhost:3000/auth/reset-password?token=sample-preview-token',
    },
  },
  {
    key: MessageTemplateKey.NOTIFICATION_PRICE_ALERT,
    subjectTemplate: null,
    titleTemplate: 'Price Alert: {{symbol}}',
    messageTemplate:
      '{{symbol}} has {{directionPhrase}} {{targetPrice}}. Current price: {{currentPrice}}.',
    bodyTemplate: null,
    requiredVariables: [
      'symbol',
      'directionPhrase',
      'targetPrice',
      'currentPrice',
    ],
    sampleVariables: {
      symbol: 'XLM',
      directionPhrase: 'risen above',
      targetPrice: '0.15',
      currentPrice: '0.16',
    },
  },
  {
    key: MessageTemplateKey.NOTIFICATION_DATA_PROCESSING_ANOMALY,
    subjectTemplate: null,
    titleTemplate: '[{{severityUpper}}] {{label}} in {{metricDisplay}}',
    messageTemplate:
      'Anomaly detected in {{metricDisplay}}. Current value {{currentValue}} is {{pctAbs}}% {{direction}} baseline of {{baselineMean}} (z-score: {{zScore}}, severity: {{severityPercent}}%).',
    bodyTemplate: null,
    requiredVariables: [
      'severityUpper',
      'label',
      'metricDisplay',
      'currentValue',
      'pctAbs',
      'direction',
      'baselineMean',
      'zScore',
      'severityPercent',
    ],
    sampleVariables: {
      severityUpper: 'HIGH',
      label: 'Anomaly Detected',
      metricDisplay: 'sentiment score',
      currentValue: '1.25',
      pctAbs: '12.5',
      direction: 'above',
      baselineMean: '1.11',
      zScore: '2.34',
      severityPercent: '75',
    },
  },
  {
    key: MessageTemplateKey.NOTIFICATION_DATA_PROCESSING_SENTIMENT_SPIKE,
    subjectTemplate: null,
    titleTemplate: '[{{severityUpper}}] {{label}} in {{metricDisplay}}',
    messageTemplate:
      'Sentiment spike detected for {{metricDisplay}}. Current value {{currentValue}} is {{pctAbs}}% {{direction}} baseline (z-score: {{zScore}}, severity: {{severityPercent}}%).',
    bodyTemplate: null,
    requiredVariables: [
      'severityUpper',
      'label',
      'metricDisplay',
      'currentValue',
      'pctAbs',
      'direction',
      'zScore',
      'severityPercent',
    ],
    sampleVariables: {
      severityUpper: 'MEDIUM',
      label: 'Sentiment Spike',
      metricDisplay: 'sentiment score',
      currentValue: '0.8421',
      pctAbs: '8.2',
      direction: 'below',
      zScore: '1.92',
      severityPercent: '55',
    },
  },
];
