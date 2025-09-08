import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Pressable, Alert } from "react-native";
import { supabase } from "../lib/supabase";

export default function ProfileScreen() {
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

  const updateDisplayName = async () => {
    try {
      // TODO: show a small input UI; for now, just a placeholder action
      Alert.alert("Coming soon", "Profile editing UI will be added next.");
    } catch (e) {
      Alert.alert("Update failed", e.message || String(e));
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  const user = session?.user;
  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Profile</Text>

      <View style={{ padding: 12, borderRadius: 12, backgroundColor: "#f3f4f6" }}>
        <Text style={{ marginBottom: 6 }}>
          <Text style={{ fontWeight: "700" }}>User ID: </Text>
          {user?.id}
        </Text>
        <Text style={{ marginBottom: 6 }}>
          <Text style={{ fontWeight: "700" }}>Email: </Text>
          {user?.email || "—"}
        </Text>
        <Text>
          <Text style={{ fontWeight: "700" }}>Provider(s): </Text>
          {(user?.app_metadata?.providers || []).join(", ") || "—"}
        </Text>
      </View>

      <Pressable
        onPress={updateDisplayName}
        style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#000" }}
      >
        <Text style={{ color: "#fff", fontWeight: "700" }}>Edit display name</Text>
      </Pressable>
    </View>
  );
}
