import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Platform,
  Switch,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFonts, Tektur_400Regular, Tektur_700Bold } from "@expo-google-fonts/tektur";
import { supabase, uploadAvatar } from "../../lib/supabase";

export default function ProfileInfoScreen() {
  const [fontsLoaded] = useFonts({ Tektur_400Regular, Tektur_700Bold });

  const [user, setUser] = useState(null);
  const [fullName, setFullName] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState({
    total_points: 0,
    games_played: 0,
    avg_time: 0,
    success_rate: 0,
  });

  // --- Notification preferences ---
  const [notifs, setNotifs] = useState({
    notifications_all: true,
    notify_daily_challenge: true,
    notify_daily_games: true,
    notify_private_elims: true,
    notify_public_elims: true,
  });
  const allIndividualsOn = useMemo(
    () =>
      notifs.notify_daily_challenge &&
      notifs.notify_daily_games &&
      notifs.notify_private_elims &&
      notifs.notify_public_elims,
    [notifs]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user;
        if (!u || !mounted) return;

        const { data: row } = await supabase
          .from("users")
          .select(
            [
              "full_name",
              "profile_photo_url",
              "email",
              "notifications_all",
              "notify_daily_challenge",
              "notify_daily_games",
              "notify_private_elims",
              "notify_public_elims",
            ].join(",")
          )
          .eq("id", u.id)
          .maybeSingle();

        setUser({ id: u.id, email: row?.email || u.email });
        setFullName(row?.full_name || u.user_metadata?.full_name || "");
        setAvatar(
          row?.profile_photo_url ||
            u.user_metadata?.profile_photo_url ||
            u.user_metadata?.avatar_url ||
            null
        );

        // Initialize notifications (fallback to true if undefined)
        setNotifs({
          notifications_all: row?.notifications_all ?? true,
          notify_daily_challenge: row?.notify_daily_challenge ?? true,
          notify_daily_games: row?.notify_daily_games ?? true,
          notify_private_elims: row?.notify_private_elims ?? true,
          notify_public_elims: row?.notify_public_elims ?? true,
        });

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
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // --- Avatar picking, with hard guards so it never crashes ---
  const pickNewAvatar = async () => {
    if (Platform.OS === "web") {
      Alert.alert(
        "Unsupported on Web",
        "Picking an avatar is currently supported on iOS/Android builds."
      );
      return;
    }

    let ImagePicker;
    try {
      // Dynamic import so projects without the native module don’t crash on startup.
      ImagePicker = await import("expo-image-picker");
    } catch {
      Alert.alert(
        "Image Picker Unavailable",
        "Install the native module:\n\nnpx expo install expo-image-picker\n\nThen rebuild your dev/client app."
      );
      return;
    }

    // Verify native module exists before calling any method
    try {
      const hasMethod =
        ImagePicker?.requestMediaLibraryPermissionsAsync ||
        ImagePicker?.getMediaLibraryPermissionsAsync;
      if (!hasMethod) throw new Error("Native module missing");
    } catch {
      Alert.alert(
        "Image Picker Not Linked",
        "This build is missing the Image Picker native module.\n\nRun:\n  npx expo install expo-image-picker\nand rebuild with EAS."
      );
      return;
    }

    // Ask permission
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Allow photo library access to change your avatar.");
        return;
      }
    } catch (e) {
      Alert.alert("Permission Error", "Could not request photo permissions.");
      return;
    }

    // Launch picker
    let result;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });
    } catch {
      Alert.alert(
        "Picker Failed",
        "The Image Picker native module isn't available in this build.\nRe-install & rebuild:\n  npx expo install expo-image-picker\n  eas build --profile development"
      );
      return;
    }

    if (!result || result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset) return;

    try {
      setSaving(true);
      const publicUrl = await uploadAvatar(asset, user.id);
      await supabase.auth.updateUser({
        data: { avatar_url: publicUrl, profile_photo_url: publicUrl },
      });
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

  // --- Save notifications helper ---
  const persistNotifs = useCallback(
    async (next) => {
      if (!user?.id) return;
      try {
        await supabase
          .from("users")
          .update({
            notifications_all: next.notifications_all,
            notify_daily_challenge: next.notify_daily_challenge,
            notify_daily_games: next.notify_daily_games,
            notify_private_elims: next.notify_private_elims,
            notify_public_elims: next.notify_public_elims,
          })
          .eq("id", user.id);
      } catch (e) {
        Alert.alert("Save failed", "Could not update notification preferences.");
      }
    },
    [user?.id]
  );

  // Toggle “All” -> toggles everyone, keeps state and persists
  const onToggleAll = (value) => {
    const next = {
      notifications_all: value,
      notify_daily_challenge: value,
      notify_daily_games: value,
      notify_private_elims: value,
      notify_public_elims: value,
    };
    setNotifs(next);
    persistNotifs(next);
  };

  // Toggle any individual -> recompute “All”
  const onToggleOne = (key, value) => {
    const next = { ...notifs, [key]: value };
    next.notifications_all =
      next.notify_daily_challenge &&
      next.notify_daily_games &&
      next.notify_private_elims &&
      next.notify_public_elims;
    setNotifs(next);
    persistNotifs(next);
  };

  if (!fontsLoaded || loading) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#f7faf7" }} contentContainerStyle={{ padding: 12 }}>
      {/* User details */}
      <View style={styles.card}>
        <Pressable onPress={pickNewAvatar} style={{ alignSelf: "center" }}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.bigAvatar} />
          ) : (
            <View style={[styles.bigAvatar, styles.avatarFallback]}>
              <Text style={styles.avatarLetter}>
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
        <Pressable
          onPress={saveName}
          disabled={saving}
          style={[styles.button, { backgroundColor: "#166534" }]}
        >
          <Text style={styles.buttonText}>{saving ? "Saving..." : "Save Name"}</Text>
        </Pressable>

        <Text style={[styles.label, { marginTop: 12 }]}>Email</Text>
        <Text style={styles.value}>{user?.email}</Text>
      </View>

      {/* Stats */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Your Stats</Text>

        <View style={styles.statsRow}>
          <Stat
            label="Total Points"
            value={stats.total_points}
            icon={<Ionicons name="trophy" size={18} color="#f59e0b" />}
          />
          <Stat
            label="Games Played"
            value={stats.games_played}
            icon={<Ionicons name="game-controller" size={18} color="#3b82f6" />}
          />
        </View>

        <View style={styles.statsRow}>
          <Stat
            label="Average Time"
            value={`${stats.avg_time}s`}
            icon={<Ionicons name="timer-outline" size={18} color="#10b981" />}
          />
          <Stat
            label="Success Rate"
            value={`${stats.success_rate}%`}
            icon={<Ionicons name="checkmark-circle" size={18} color="#22c55e" />}
          />
        </View>
      </View>

      {/* Notifications */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Notifications</Text>

        <NotifRow
          title="All notifications"
          value={notifs.notifications_all}
          onValueChange={onToggleAll}
        />

        <View style={styles.divider} />

        <NotifRow
          title="Daily challenge reminders"
          value={notifs.notify_daily_challenge}
          onValueChange={(v) => onToggleOne("notify_daily_challenge", v)}
        />
        <NotifRow
          title="Daily games reminders"
          value={notifs.notify_daily_games}
          onValueChange={(v) => onToggleOne("notify_daily_games", v)}
        />
        <NotifRow
          title="Private elimination challenges"
          value={notifs.notify_private_elims}
          onValueChange={(v) => onToggleOne("notify_private_elims", v)}
        />
        <NotifRow
          title="Public elimination challenges"
          value={notifs.notify_public_elims}
          onValueChange={(v) => onToggleOne("notify_public_elims", v)}
        />

        {!allIndividualsOn && notifs.notifications_all ? (
          <Text style={styles.hintText}>
            Tip: “All notifications” turns off automatically if you disable a specific type.
          </Text>
        ) : null}
      </View>
    </ScrollView>
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

function NotifRow({ title, value, onValueChange }) {
  return (
    <View style={styles.notifRow}>
      <Text style={styles.notifLabel}>{title}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 12, backgroundColor: "#f7faf7" },
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
  avatarLetter: { fontSize: 22, fontFamily: "Tektur_700Bold", color: "#0b3d24" },

  // Typography
  label: { fontSize: 12, color: "#6b7280", marginBottom: 4, fontFamily: "Tektur_400Regular" },
  value: { fontSize: 14, fontFamily: "Tektur_700Bold", color: "#111827" },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: "#111827",
    fontFamily: "Tektur_400Regular",
  },
  button: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontFamily: "Tektur_700Bold", fontSize: 14 },
  sectionTitle: { fontSize: 16, fontFamily: "Tektur_700Bold", color: "#0b3d24" },

  statsRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  statBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  statValue: { fontSize: 18, fontFamily: "Tektur_700Bold", color: "#111827" },
  statLabel: { fontSize: 12, color: "#6b7280", fontFamily: "Tektur_400Regular" },

  // Notifications
  notifRow: {
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  notifLabel: { fontSize: 14, fontFamily: "Tektur_400Regular", color: "#111827" },
  divider: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 8,
  },
  hintText: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280",
    fontFamily: "Tektur_400Regular",
  },
});
