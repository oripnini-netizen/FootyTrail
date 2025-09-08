import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";

export default function IndexGate() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/login");
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
  }, []);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
