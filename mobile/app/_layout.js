// mobile/app/_layout.js
import React from "react";
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Gate that decides login/tutorial/tabs */}
      <Stack.Screen name="index" />

      {/* Auth / onboarding screens */}
      <Stack.Screen name="login" />
      <Stack.Screen name="tutorial" />

      {/* The tabbed app lives under the (tabs) group */}
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
