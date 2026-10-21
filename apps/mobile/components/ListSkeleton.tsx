import { View } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

export default function ListSkeleton({ count = 5 }: { count?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ padding: 16 }}>
      {[...Array(count)].map((_, i) => (
        <View
          key={i}
          style={{
            height: 60,
            backgroundColor: colors.surfaceMuted,
            marginBottom: 10,
            borderRadius: 8,
          }}
        />
      ))}
    </View>
  );
}
