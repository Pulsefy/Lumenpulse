import { View, Text } from 'react-native';

export default function ListError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ padding: 16 }}>
      <Text style={{ color: 'red' }}>{message}</Text>
      {onRetry && <Text onPress={onRetry}>Retry</Text>}
    </View>
  );
}
