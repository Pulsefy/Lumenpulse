import React from 'react';
import { Stack } from 'expo-router';

export default function ContributorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="profile" />
    </Stack>
  );
}
