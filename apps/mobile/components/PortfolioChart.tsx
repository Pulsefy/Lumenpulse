import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { LineChart } from 'react-native-wagmi-charts';
import * as Haptics from 'expo-haptics';
import { portfolioApi, PortfolioHistorySnapshot } from '../lib/api';
import { useTheme } from '../contexts/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Range = '1D' | '1W' | '1M' | 'ALL';

interface ChartPoint {
  timestamp: number;
  value: number;
}

export default function PortfolioChart() {
  const { colors } = useTheme();
  const [range, setRange] = useState<Range>('1M');
  const [data, setData] = useState<ChartPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async (selectedRange: Range) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await portfolioApi.getHistory(selectedRange);
      if (response.success && response.data) {
        const snapshots = response.data.snapshots;
        if (snapshots.length > 0) {
          // Wagmi-charts expects timestamp as number and value as number
          // Snapshots are returned DESC, we need ASC for the chart
          const formattedData = [...snapshots]
            .reverse()
            .map((s: PortfolioHistorySnapshot) => ({
              timestamp: new Date(s.createdAt).getTime(),
              value: parseFloat(s.totalValueUsd),
            }));
          setData(formattedData);
        } else {
          setData([]);
        }
      } else {
        setError('Failed to load chart data');
      }
    } catch (err) {
      setError('An error occurred while fetching history');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory(range);
  }, [range]);

  const handleRangeChange = (newRange: Range) => {
    if (newRange !== range) {
      setRange(newRange);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const renderRangeSelector = () => (
    <View style={styles.rangeSelector}>
      {(['1D', '1W', '1M', 'ALL'] as Range[]).map((r) => (
        <TouchableOpacity
          key={r}
          onPress={() => handleRangeChange(r)}
          style={[
            styles.rangeButton,
            range === r && { backgroundColor: `${colors.accent}22` },
          ]}
        >
          <Text
            style={[
              styles.rangeText,
              { color: range === r ? colors.accent : colors.textSecondary },
              range === r && { fontWeight: '700' },
            ]}
          >
            {r}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (isLoading && data.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error && data.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ color: colors.danger }}>{error}</Text>
        <TouchableOpacity onPress={() => fetchHistory(range)} style={styles.retryButton}>
          <Text style={{ color: colors.accent }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={{ opacity: isLoading ? 0.6 : 1 }}>
        {data.length > 0 ? (
          <LineChart.Provider data={data}>
            <LineChart width={SCREEN_WIDTH - 32} height={200}>
              <LineChart.Path color={colors.accent}>
                <LineChart.Gradient color={colors.accent} />
              </LineChart.Path>
              <LineChart.CursorCrosshair color={colors.accent}>
                <LineChart.Tooltip />
              </LineChart.CursorCrosshair>
            </LineChart>
          </LineChart.Provider>
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={{ color: colors.textSecondary }}>No historical data available</Text>
          </View>
        )}
      </View>

      {isLoading && data.length > 0 && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: colors.textSecondary, marginTop: 6 }}>Loading chart...</Text>
        </View>
      )}

      {renderRangeSelector()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 24,
    minHeight: 260,
    position: 'relative',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rangeSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: 12,
    padding: 4,
  },
  rangeButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  rangeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  retryButton: {
    marginTop: 8,
    padding: 8,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.12)',
    borderRadius: 12,
  },
});
