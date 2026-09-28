import { MESSAGE_TEMPLATE_DEFAULTS } from './message-template.defaults';
import { renderTemplateField } from './message-template-renderer';
import { MessageTemplateKey } from './message-template.keys';
import { buildDataProcessingTemplateVariables } from '../notification/data-processing-notification.variables';
import { NotificationSeverity } from '../notification/notification.entity';
function legacyDataProcessingTitle(
  type: string,
  metricName: string,
  severity: NotificationSeverity,
): string {
  const label =
    type === 'sentiment_spike' ? 'Sentiment Spike' : 'Anomaly Detected';
  const metric = metricName.replace(/_/g, ' ');
  return `[${severity.toUpperCase()}] ${label} in ${metric}`;
}

function legacyDataProcessingMessage(
  type: string,
  metricName: string,
  currentValue: number,
  baselineMean: number,
  zScore: number,
  severityScore: number,
): string {
  const metric = metricName.replace(/_/g, ' ');
  const pct =
    baselineMean !== 0
      ? (((currentValue - baselineMean) / baselineMean) * 100).toFixed(1)
      : '0';
  const direction = currentValue >= baselineMean ? 'above' : 'below';

  if (type === 'sentiment_spike') {
    return (
      `Sentiment spike detected for ${metric}. ` +
      `Current value ${currentValue.toFixed(4)} is ${Math.abs(Number(pct))}% ${direction} baseline ` +
      `(z-score: ${zScore.toFixed(2)}, severity: ${(severityScore * 100).toFixed(0)}%).`
    );
  }

  return (
    `Anomaly detected in ${metric}. ` +
    `Current value ${currentValue.toFixed(2)} is ${Math.abs(Number(pct))}% ${direction} baseline of ${baselineMean.toFixed(2)} ` +
    `(z-score: ${zScore.toFixed(2)}, severity: ${(severityScore * 100).toFixed(0)}%).`
  );
}

describe('message template migration parity', () => {
  const byKey = (key: string) =>
    MESSAGE_TEMPLATE_DEFAULTS.find((d) => d.key === key)!;

  it('matches legacy price alert copy', () => {
    const def = byKey(MessageTemplateKey.NOTIFICATION_PRICE_ALERT);
    const symbol = 'XLM';
    const targetPrice = 0.15;
    const currentPrice = 0.16;
    const directionPhrase = 'risen above';

    const title = renderTemplateField(
      def.titleTemplate!,
      { symbol, directionPhrase, targetPrice, currentPrice },
      [],
      'title',
    ).rendered;
    const message = renderTemplateField(
      def.messageTemplate!,
      { symbol, directionPhrase, targetPrice, currentPrice },
      [],
      'message',
    ).rendered;

    expect(title).toBe(`Price Alert: ${symbol}`);
    expect(message).toBe(
      `${symbol} has ${directionPhrase} ${targetPrice}. Current price: ${currentPrice}.`,
    );
  });

  it('matches legacy password reset email copy', () => {
    const def = byKey(MessageTemplateKey.EMAIL_PASSWORD_RESET);
    const resetLink = 'http://localhost:3000/auth/reset-password?token=abc';

    const subject = renderTemplateField(
      def.subjectTemplate!,
      { resetLink },
      [],
      'subject',
    ).rendered;
    const body = renderTemplateField(
      def.bodyTemplate!,
      { resetLink },
      [],
      'body',
    ).rendered;

    expect(subject).toBe('Reset Your Passkey');
    expect(body).toBe(
      `Please use the following link to reset your passkey: ${resetLink}`,
    );
  });

  it('matches legacy data-processing anomaly copy', () => {
    const type = 'anomaly';
    const metricName = 'sentiment_score';
    const currentValue = 1.25;
    const baselineMean = 1.11;
    const zScore = 2.34;
    const severityScore = 0.75;
    const severity = NotificationSeverity.HIGH;

    const vars = buildDataProcessingTemplateVariables(
      type,
      metricName,
      currentValue,
      baselineMean,
      zScore,
      severityScore,
      severity,
    );
    const def = byKey(MessageTemplateKey.NOTIFICATION_DATA_PROCESSING_ANOMALY);

    const title = renderTemplateField(
      def.titleTemplate!,
      vars,
      [],
      'title',
    ).rendered;
    const message = renderTemplateField(
      def.messageTemplate!,
      vars,
      [],
      'message',
    ).rendered;

    expect(title).toBe(
      legacyDataProcessingTitle(type, metricName, severity),
    );
    expect(message).toBe(
      legacyDataProcessingMessage(
        type,
        metricName,
        currentValue,
        baselineMean,
        zScore,
        severityScore,
      ),
    );
  });

  it('matches legacy data-processing sentiment spike copy', () => {
    const type = 'sentiment_spike';
    const metricName = 'sentiment_score';
    const currentValue = 0.8421;
    const baselineMean = 0.92;
    const zScore = 1.92;
    const severityScore = 0.55;
    const severity = NotificationSeverity.MEDIUM;

    const vars = buildDataProcessingTemplateVariables(
      type,
      metricName,
      currentValue,
      baselineMean,
      zScore,
      severityScore,
      severity,
    );
    const def = byKey(
      MessageTemplateKey.NOTIFICATION_DATA_PROCESSING_SENTIMENT_SPIKE,
    );

    const title = renderTemplateField(def.titleTemplate!, vars, [], 'title')
      .rendered;
    const message = renderTemplateField(
      def.messageTemplate!,
      vars,
      [],
      'message',
    ).rendered;

    expect(title).toBe(
      legacyDataProcessingTitle(type, metricName, severity),
    );
    expect(message).toBe(
      legacyDataProcessingMessage(
        type,
        metricName,
        currentValue,
        baselineMean,
        zScore,
        severityScore,
      ),
    );
  });

});
