import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { Link } from "expo-router";
import { supabase } from "../lib/supabase";

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoading(false);
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

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>FootyTrail</Text>

      <View style={{ padding: 12, borderRadius: 12, backgroundColor: "#f3f4f6" }}>
        <Text style={{ fontSize: 16 }}>
          Signed in as{" "}
          <Text style={{ fontWeight: "700" }}>
            {session?.user?.email || session?.user?.id}
          </Text>
        </Text>
      </View>

      {/* These links will work as we add each screen */}
      <View style={{ gap: 12 }}>
        <Link href="/leaderboard" asChild>
          <Pressable style={{ padding: 12, borderRadius: 12, backgroundColor: "#e5e7eb" }}>
            <Text style={{ fontWeight: "600" }}>Leaderboard</Text>
          </Pressable>
        </Link>

        <Link href="/profile" asChild>
          <Pressable style={{ padding: 12, borderRadius: 12, backgroundColor: "#e5e7eb" }}>
            <Text style={{ fontWeight: "600" }}>Profile</Text>
          </Pressable>
        </Link>

        {/* We'll wire more routes next to mirror your web pages */}
      </View>
    </ScrollView>
  );
}
