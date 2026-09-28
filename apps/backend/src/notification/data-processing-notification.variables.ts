import { NotificationSeverity } from './notification.entity';

export interface DataProcessingTemplateVariables
  extends Record<string, string> {
  severityUpper: string;
  label: string;
  metricDisplay: string;
  currentValue: string;
  pctAbs: string;
  direction: string;
  baselineMean: string;
  zScore: string;
  severityPercent: string;
}

/**
 * Builds template variables for data-processing webhook notifications.
 * Formatting matches the legacy inline message builders.
 */
export function buildDataProcessingTemplateVariables(
  type: 'anomaly' | 'sentiment_spike',
  metricName: string,
  currentValue: number,
  baselineMean: number,
  zScore: number,
  severityScore: number,
  severity: NotificationSeverity,
): DataProcessingTemplateVariables {
  const metricDisplay = metricName.replace(/_/g, ' ');
  const pct =
    baselineMean !== 0
      ? (((currentValue - baselineMean) / baselineMean) * 100).toFixed(1)
      : '0';
  const direction = currentValue >= baselineMean ? 'above' : 'below';
  const label =
    type === 'sentiment_spike' ? 'Sentiment Spike' : 'Anomaly Detected';

  return {
    severityUpper: severity.toUpperCase(),
    label,
    metricDisplay,
    currentValue:
      type === 'sentiment_spike'
        ? currentValue.toFixed(4)
        : currentValue.toFixed(2),
    pctAbs: String(Math.abs(Number(pct))),
    direction,
    baselineMean: baselineMean.toFixed(2),
    zScore: zScore.toFixed(2),
    severityPercent: (severityScore * 100).toFixed(0),
  };
}
