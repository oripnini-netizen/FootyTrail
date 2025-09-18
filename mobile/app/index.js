// mobile/app/index.js
import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase"; // ← correct path (up one level)

/**
 * NOTE on push registration:
 * We lazy-import the helper so expo-notifications isn't loaded at module time.
 * This avoids "Cannot find native module 'ExpoPushTokenManager'" crashes
 * when running without Expo Go / dev build. Any failure is caught & logged.
 */

export default function Index() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  // Lazy import + run push registration (safe, won't crash app if not available)
  useEffect(() => {
    (async () => {
      try {
        const mod = await import("../lib/registerForPush");
        if (mod?.registerForPushNotificationsAsync) {
          await mod.registerForPushNotificationsAsync();
        }
      } catch (e) {
        console.log("Push registration skipped:", String(e?.message || e));
      }
    })();
  }, []);

  // Gate: route user based on auth + onboarding
  useEffect(() => {
    let mounted = true;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session?.user) {
        router.replace("/login");
        setChecking(false);
        return;
      }

      const { data: profile } = await supabase
        .from("users")
        .select("has_completed_onboarding")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!mounted) return;

      if (profile && profile.has_completed_onboarding === false) {
        router.replace("/tutorial");
      } else {
        router.replace("/game");
      }

      setChecking(false);
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  // Simple loading screen while we decide where to go
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
