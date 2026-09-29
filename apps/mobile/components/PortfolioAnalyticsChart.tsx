import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalization } from '../src/context';
import {
  buildChartModel,
  formatChartValue,
  normalizeRanges,
  pointsBudgetFor,
  selectRange,
  summarizeForAccessibility,
  type ChartDataPoint,
  type ChartMeta,
} from '../lib/analytics';
import { portfolioChartLoader } from '../lib/analytics-service';

/** Height of each series plot, in device-independent pixels. */
const PLOT_HEIGHT = 88;

/** Non-colour channel for the series, paired with the marker in the legend. */
const SERIES_BORDER_STYLE: ('solid' | 'dashed')[] = ['solid', 'dashed'];

export interface PortfolioAnalyticsChartProps {
  /** Public key of the wallet whose movement is charted. */
  publicKey: string | null;
  /** Skips the requests entirely (e.g. while signed out). */
  enabled?: boolean;
}

/**
 * Value-over-time chart for the portfolio tab.
 *
 * The plot is drawn with plain views (no chart dependency) from at most
 * {@link pointsBudgetFor}('low') buckets per series, so a 2,000 bucket window
 * cannot reach the renderer whole. Everything that can be wrong — range
 * selection, series mapping, downsampling, empty/sparse states and the text
 * alternative — lives in `lib/analytics.ts` and is unit tested there.
 */
export function PortfolioAnalyticsChart({
  publicKey,
  enabled = true,
}: PortfolioAnalyticsChartProps) {
  const { colors, t } = useLocalization();
  const [meta, setMeta] = useState<ChartMeta | null>(null);
  const [points, setPoints] = useState<ChartDataPoint[] | null>(null);
  const [activeRange, setActiveRange] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled || !publicKey) {
      setMeta(null);
      setPoints(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        // `meta` is read from state without being a dependency: it is only ever
        // set from this loader, and re-runs keyed on the descriptor would
        // refetch the chart every time the screen re-renders.
        const nextMeta = meta ?? (await portfolioChartLoader.loadMeta());
        const selectedRange = selectRange(normalizeRanges(nextMeta), activeRange);
        const nextPoints = await portfolioChartLoader.load(selectedRange);
        if (cancelled) return;
        setMeta(nextMeta);
        setActiveRange(selectedRange.range);
        setPoints(nextPoints);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('errors.couldnt_load', { item: 'chart' }));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, publicKey, activeRange, reloadToken]);

  const model = useMemo(
    () =>
      buildChartModel({
        meta,
        points: points ?? [],
        activeRange,
        maxPoints: pointsBudgetFor('low'),
      }),
    [meta, points, activeRange],
  );

  const handleSelectRange = useCallback((range: string) => {
    setActiveRange(range);
  }, []);

  const handleRetry = useCallback(() => {
    portfolioChartLoader.invalidate();
    setReloadToken((token) => token + 1);
  }, []);

  if (!enabled || !publicKey) {
    return null;
  }

  const seriesColor = (index: number) => (index % 2 === 0 ? colors.accent : colors.accentSecondary);
  const { valueRange } = model;

  const barHeight = (value: number): number => {
    if (!valueRange) return 0;
    const span = valueRange.max - valueRange.min;
    if (span <= 0) return Math.round(PLOT_HEIGHT / 2);
    return Math.max(3, Math.round(((value - valueRange.min) / span) * PLOT_HEIGHT));
  };

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
          {t('portfolio.analytics_title', { defaultValue: 'Portfolio trend' })}
        </Text>
        {loading ? (
          <ActivityIndicator size="small" color={colors.accent} accessibilityLabel={t('common.loading')} />
        ) : null}
      </View>

      <View style={styles.rangeRow}>
        {model.ranges.map((option) => {
          const selected = option.range === model.activeRange.range;
          return (
            <TouchableOpacity
              key={option.range}
              onPress={() => handleSelectRange(option.range)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              style={[
                styles.rangeChip,
                {
                  backgroundColor: selected ? colors.accent : colors.background,
                  borderColor: selected ? colors.accent : colors.border,
                },
              ]}
            >
              <Text style={[styles.rangeLabel, { color: selected ? '#ffffff' : colors.text }]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {error ? (
        <View style={styles.errorBlock} accessible accessibilityRole="alert">
          <Ionicons
            name="cloud-offline-outline"
            size={18}
            color={colors.warning}
            importantForAccessibility="no"
          />
          <Text style={[styles.message, { color: colors.textSecondary }]}>{error}</Text>
          <TouchableOpacity
            onPress={handleRetry}
            activeOpacity={0.85}
            accessibilityRole="button"
            style={[styles.retryButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryLabel, { color: colors.accent }]}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View accessible accessibilityLabel={summarizeForAccessibility(model)}>
          {model.series.map((series, index) => (
            <View key={series.key} style={styles.seriesBlock}>
              <View style={styles.seriesHeader}>
                <Text
                  style={[styles.seriesSymbol, { color: seriesColor(index) }]}
                  importantForAccessibility="no"
                >
                  {series.symbol}
                </Text>
                <Text
                  style={[styles.seriesLabel, { color: colors.text }]}
                  numberOfLines={1}
                  importantForAccessibility="no"
                >
                  {series.label} · {series.lineStyle}
                </Text>
                <Text
                  style={[styles.seriesValue, { color: colors.textSecondary }]}
                  importantForAccessibility="no"
                >
                  {formatChartValue(series.latest)}
                </Text>
              </View>
              <View
                style={[styles.plot, { borderBottomColor: colors.border }]}
                importantForAccessibility="no-hide-descendants"
              >
                {series.points.map((point, position) => (
                  <View
                    key={`${series.key}-${position}`}
                    style={[
                      styles.bar,
                      {
                        height: barHeight(point.value),
                        backgroundColor: seriesColor(index),
                        borderColor: seriesColor(index),
                        borderStyle: SERIES_BORDER_STYLE[index % SERIES_BORDER_STYLE.length],
                      },
                    ]}
                  />
                ))}
              </View>
            </View>
          ))}

          {model.message ? (
            <Text style={[styles.message, { color: colors.textSecondary }]} accessible>
              {model.message}
            </Text>
          ) : null}

          {valueRange ? (
            <Text style={[styles.axisHint, { color: colors.textSecondary }]} accessible>
              {formatChartValue(valueRange.min)} – {formatChartValue(valueRange.max)} ·{' '}
              {model.activeRange.interval}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  rangeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  rangeLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  seriesBlock: {
    marginTop: 14,
  },
  seriesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  seriesSymbol: {
    fontSize: 14,
  },
  seriesLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  seriesValue: {
    fontSize: 13,
  },
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: PLOT_HEIGHT,
    marginTop: 6,
    borderBottomWidth: 1,
  },
  bar: {
    flex: 1,
    marginHorizontal: 0.5,
    borderWidth: 1,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  axisHint: {
    fontSize: 12,
    marginTop: 8,
  },
  errorBlock: {
    marginTop: 12,
    gap: 6,
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  retryLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});
