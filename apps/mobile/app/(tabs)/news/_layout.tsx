import { Stack } from 'expo-router';
import { useTheme } from '../../../contexts/ThemeContext';

export default function NewsLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTintColor: colors.text,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'News' }} />
      <Stack.Screen name="[id]" options={{ title: 'Article' }} />
      <Stack.Screen name="saved" options={{ title: 'Saved News' }} />
    </Stack>
  );
}
