import React from "react";
import {
  FlatList,
  RefreshControl,
  View,
  Text,
  ActivityIndicator,
} from "react-native";

type Props<T> = {
  data: T[];
  renderItem: ({ item }: { item: T }) => React.ReactElement;
  keyExtractor: (item: T, index: number) => string;

  loading?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;

  ListEmptyComponent?: React.ReactElement;
  error?: string | null;
  onRetry?: () => void;
};

export default function StandardList<T>({
  data,
  renderItem,
  keyExtractor,
  loading = false,
  refreshing = false,
  onRefresh,
  onEndReached,
  ListEmptyComponent,
  error,
  onRetry,
}: Props<T>) {
  // 🔴 Error state
  if (error) {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ color: "red", marginBottom: 8 }}>{error}</Text>
        {onRetry && (
          <Text style={{ color: "#7a85ff" }} onPress={onRetry}>
            Retry
          </Text>
        )}
      </View>
    );
  }

  // 🟡 Skeleton loader (NO layout shift)
  if (loading && data.length === 0) {
    return (
      <View style={{ padding: 16 }}>
        {[...Array(5)].map((_, i) => (
          <View
            key={i}
            style={{
              height: 60,
              backgroundColor: "#222",
              marginBottom: 10,
              borderRadius: 8,
            }}
          />
        ))}
      </View>
    );
  }

  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}

      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}

      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }

      ListEmptyComponent={
        ListEmptyComponent || (
          <View style={{ padding: 16 }}>
            <Text>No data available</Text>
          </View>
        )
      }

      // 🔽 Pagination loader
      ListFooterComponent={
        loading && data.length > 0 ? (
          <ActivityIndicator style={{ margin: 20 }} />
        ) : null
      }

      // ⚡ Performance
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={5}
      removeClippedSubviews
    />
  );
}