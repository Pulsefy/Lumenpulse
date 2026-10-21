import { View, Text } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { spacing } from '../theme/tokens';

export default function ListError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ padding: spacing.lg }}>
      <Text style={{ color: colors.danger }}>{message}</Text>
      {onRetry && (
        <Text style={{ color: colors.accent }} onPress={onRetry}>
          Retry
        </Text>
      )}
    </View>
  );
}
