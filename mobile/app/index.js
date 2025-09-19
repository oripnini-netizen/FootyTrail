// mobile/app/index.js
import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { supabase } from "../lib/supabase";

/**
 * We lazy-import the registration helper so the app doesn't crash
 * if expo-notifications native bits aren't present.
 */

export default function Index() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  // Register for push (lazy import; safe on devices without the native module)
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

  // Navigate on notification tap
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const data = response?.notification?.request?.content?.data || {};
        const tid = data.tournamentId || data.tournament_id || data.id;
        if (tid) {
          // push to your elimination page with the id as a param
          router.push({ pathname: "/elimination", params: { id: String(tid) } });
        }
      } catch (e) {
        console.log("notif tap handler error:", String(e?.message || e));
      }
    });
    return () => sub?.remove();
  }, [router]);

  // Gate: route user based on auth + onboarding
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();

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

    return () => { mounted = false; };
  }, [router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
