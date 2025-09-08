import { useEffect, useState } from "react";
import { ActivityIndicator, View, Pressable, Text } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();

  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);

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

  useEffect(() => {
    if (!ready) return;

    // Not signed in → force to /login
    if (!session && pathname !== "/login") {
      router.replace("/login");
      return;
    }

    // Signed in but on /login → go home
    if (session && pathname === "/login") {
      router.replace("/");
    }
  }, [ready, session, pathname, router]);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      router.replace("/login");
    } catch (e) {
      console.warn("Sign out failed:", e);
    }
  };

  if (!ready) {
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
          // Show a Sign out button whenever the user is authenticated
          headerRight: () =>
            session ? (
              <Pressable onPress={handleSignOut} hitSlop={10} style={{ paddingHorizontal: 12 }}>
                <Text style={{ color: "#007aff", fontWeight: "600" }}>Sign out</Text>
              </Pressable>
            ) : null,
        }}
      />
    </SafeAreaProvider>
  );
}
