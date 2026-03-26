import { Stack } from 'expo-router';

export default function NewsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: '#0a0a0a',
        },
        headerTintColor: '#ffffff',
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: 'News' }}
      />
      <Stack.Screen
        name="[id]"
        options={{ title: 'Article' }}
      />
    </Stack>
  );
}