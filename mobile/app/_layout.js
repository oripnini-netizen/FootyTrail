// mobile/app/_layout.js
import React, { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { setupNotificationNavigation } from "../lib/notifications";

export default function RootLayout() {
  const router = useRouter();

  // 🔗 Handle notification taps (warm + cold starts)
  useEffect(() => {
    const cleanup = setupNotificationNavigation(router);
    return cleanup;
  }, [router]);

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
