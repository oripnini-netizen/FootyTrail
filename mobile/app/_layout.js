// mobile/app/_layout.js
import React, { useEffect } from "react";
import { Stack, useRouter, usePathname } from "expo-router";
import { setupNotificationNavigation } from "../lib/notifications";
import { supabase } from "../lib/supabase";

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();

  // 🔗 Handle notification taps (warm + cold starts)
  useEffect(() => {
    const cleanup = setupNotificationNavigation(router);
    return cleanup;
  }, [router]);

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
