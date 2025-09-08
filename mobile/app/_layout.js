import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();

  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);

  // Load session once and subscribe to changes
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Guard routes based on auth state
  useEffect(() => {
    if (!ready) return;

    // Not signed in → force to /login
    if (!session && pathname !== "/login") {
      router.replace("/login");
      return;
    }

    // Signed in but on /login → send to home
    if (session && pathname === "/login") {
      router.replace("/");
    }
  }, [ready, session, pathname, router]);

  if (!ready) {
    // Small splash while we check session to avoid flicker
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: true,
          headerTitleAlign: "center",
        }}
      />
    </SafeAreaProvider>
  );
}
