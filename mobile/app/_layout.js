// mobile/app/_layout.js
import React, { useEffect } from "react";
import { Stack, useRouter, usePathname } from "expo-router";
import { setupNotificationNavigation } from "../lib/notifications";
import { supabase } from "../lib/supabase";
import * as Notifications from "expo-notifications";
import { I18nManager, Platform } from 'react-native';

// Prevent Android RTL mirroring globally:
if (Platform.OS === 'android') {
  // Only do this once at startup
  if (I18nManager.isRTL) {
    I18nManager.allowRTL(false);
    I18nManager.forceRTL(false);
    // Note: a full app reload is needed the first time this flips.
  } else {
    I18nManager.allowRTL(false);
  }
}

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();

  // 🔗 Handle notification taps (warm + cold starts)
  useEffect(() => {
    const cleanup = setupNotificationNavigation(router);
    return cleanup;
  }, [router]);

  // 🔔 Android notification channel + bundled sound
  useEffect(() => {
    if (Platform.OS === "android") {
      Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.MAX,
        sound: "who_are_ya.wav", // must match the filename declared in app.json → plugins.expo-notifications.sounds
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        lightColor: "#ffffff",
      }).catch(() => {});
    }
  }, []);

  // --- Onboarding gate: route users with has_completed_onboarding=false into /tutorial ---
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Don't interfere with auth or the tutorial itself
        if (pathname === "/login" || pathname === "/tutorial") return;

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) return; // not logged in => let auth flow handle

        const { data, error } = await supabase
          .from("users")
          .select("has_completed_onboarding")
          .eq("id", user.id)
          .maybeSingle();

        if (!mounted || error || !data) return;

        if (data.has_completed_onboarding === false) {
          // Use replace so back button won't jump to a partially rendered screen
          router.replace("/tutorial");
        }
      } catch {
        // Fail silently; user can still navigate normally
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router, pathname]);

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
