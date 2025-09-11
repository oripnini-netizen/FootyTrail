// mobile/app/(tabs)/profile-info.js
import React, { useEffect, useState } from "react";
import { View, Text, Image, Pressable, TextInput, ActivityIndicator, StyleSheet, Alert } from "react-native";
// ImagePicker dynamically imported in pickNewAvatar()
import { Ionicons } from "@expo/vector-icons";
import { supabase, uploadAvatar } from "../../lib/supabase";

export default function ProfileInfoScreen() {
  const [user, setUser] = useState(null);
  const [fullName, setFullName] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState({ total_points: 0, games_played: 0, avg_time: 0, success_rate: 0 });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user;
        if (!u || !mounted) return;

        const { data: row } = await supabase
          .from("users")
          .select("full_name, profile_photo_url, email")
          .eq("id", u.id)
          .maybeSingle();

        setUser({ id: u.id, email: row?.email || u.email });
        setFullName(row?.full_name || u.user_metadata?.full_name || "");
        setAvatar(row?.profile_photo_url || u.user_metadata?.profile_photo_url || u.user_metadata?.avatar_url || null);

        // stats (points + tx, games, avg time, success)
        const { data: allGames } = await supabase
          .from("games_records")
          .select("won, points_earned, time_taken_seconds")
          .eq("user_id", u.id);

        const totalGames = allGames?.length || 0;
        const wonGames = (allGames || []).filter((g) => g.won).length;
        const basePoints = (allGames || []).reduce((s, g) => s + (g.points_earned || 0), 0);
        const totalTime = (allGames || []).reduce((s, g) => s + (g.time_taken_seconds || 0), 0);

        const { data: txs } = await supabase
          .from("points_transactions")
          .select("amount")
          .eq("user_id", u.id);

        const txPoints = (txs || []).reduce((s, t) => s + Number(t.amount || 0), 0);

        setStats({
          total_points: basePoints + txPoints,
          games_played: totalGames,
          avg_time: totalGames > 0 ? Math.round(totalTime / totalGames) : 0,
          success_rate: totalGames > 0 ? Math.round((wonGames / totalGames) * 100) : 0,
        });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const pickNewAvatar = async () => {
    let ImagePicker;
    try {
      ImagePicker = await import("expo-image-picker");
    } catch {
      Alert.alert(
        "Image Picker Unavailable",
        "Install it with `expo install expo-image-picker` and rebuild your dev build."
      );
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow photo library access to change your avatar.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset) return;

    try {
      setSaving(true);
      const publicUrl = await uploadAvatar(asset);
      await supabase.auth.updateUser({ data: { avatar_url: publicUrl, profile_photo_url: publicUrl } });
      await supabase.from("users").update({ profile_photo_url: publicUrl }).eq("id", user.id);
      setAvatar(publicUrl);
    } catch (e) {
      Alert.alert("Upload failed", e?.message || "Could not upload avatar.");
    } finally {
      setSaving(false);
    }
  };

  const saveName = async () => {
    try {
      setSaving(true);
      const { data: auth } = await supabase.auth.getUser();
      const curr = auth?.user;
      const metadata = curr?.user_metadata || {};
      await supabase.auth.updateUser({ data: { ...metadata, full_name: fullName } });
      await supabase.from("users").update({ full_name: fullName }).eq("id", user.id);
      Alert.alert("Saved", "Your name was updated.");
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not save name.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* User details */}
      <View style={styles.card}>
        <Pressable onPress={pickNewAvatar} style={{ alignSelf: "center" }}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.bigAvatar} />
          ) : (
            <View style={[styles.bigAvatar, styles.avatarFallback]}>
              <Text style={{ fontSize: 22, fontWeight: "800" }}>
                {(user?.email || "U").slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
        </Pressable>

        <Text style={styles.label}>User Name</Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your name"
          style={styles.input}
        />
        <Pressable onPress={saveName} disabled={saving} style={[styles.button, { backgroundColor: "#166534" }]}>
          <Text style={styles.buttonText}>{saving ? "Saving..." : "Save Name"}</Text>
        </Pressable>

        <Text style={[styles.label, { marginTop: 12 }]}>Email</Text>
        <Text style={styles.value}>{user?.email}</Text>
      </View>

      {/* Stats with colored icons */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Your Stats</Text>

        <View style={styles.statsRow}>
          <Stat
            label="Total Points"
            value={stats.total_points}
            icon={<Ionicons name="trophy" size={18} color="#f59e0b" />} // amber
          />
          <Stat
            label="Games Played"
            value={stats.games_played}
            icon={<Ionicons name="game-controller" size={18} color="#3b82f6" />} // blue
          />
        </View>

        <View style={styles.statsRow}>
          <Stat
            label="Average Time"
            value={`${stats.avg_time}s`}
            icon={<Ionicons name="timer-outline" size={18} color="#10b981" />} // emerald
          />
          <Stat
            label="Success Rate"
            value={`${stats.success_rate}%`}
            icon={<Ionicons name="checkmark-circle" size={18} color="#22c55e" />} // green
          />
        </View>
      </View>

      {/* Note: Recent Games moved to its own page (see recent-games.js) */}
    </View>
  );
}

function Stat({ label, value, icon }) {
  return (
    <View style={styles.statBox}>
      <View style={{ marginBottom: 6 }}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 12, backgroundColor: '#f7faf7' },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
  },
  bigAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    marginBottom: 10,
  },
  avatarFallback: {
    backgroundColor: "#e5f3e8",
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 12, color: "#6b7280", marginBottom: 4 },
  value: { fontSize: 14, fontWeight: "600", color: "#111827" },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: "#111827",
  },
  button: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#0b3d24" },
  statsRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  statBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  statValue: { fontSize: 18, fontWeight: "800", color: "#111827" },
  statLabel: { fontSize: 12, color: "#6b7280" },
});
