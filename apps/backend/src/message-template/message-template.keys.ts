export const MessageTemplateKey = {
  EMAIL_PASSWORD_RESET: 'email.password_reset',
  NOTIFICATION_PRICE_ALERT: 'notification.price_alert',
  NOTIFICATION_DATA_PROCESSING_ANOMALY:
    'notification.data_processing.anomaly',
  NOTIFICATION_DATA_PROCESSING_SENTIMENT_SPIKE:
    'notification.data_processing.sentiment_spike',
} as const;

export type MessageTemplateKeyName =
  (typeof MessageTemplateKey)[keyof typeof MessageTemplateKey];
