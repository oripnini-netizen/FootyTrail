// mobile/app/(tabs)/recent-games.js
import React, { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { supabase } from "../../lib/supabase";
import { useFonts, Tektur_400Regular, Tektur_700Bold } from "@expo-google-fonts/tektur";

export default function RecentGamesScreen() {
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState([]);

  const [fontsLoaded] = useFonts({
    Tektur_400Regular,
    Tektur_700Bold,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user;
        if (!u) return;

        const { data: games } = await supabase
          .from("games_records")
          .select("id, player_name, won, points_earned, time_taken_seconds, guesses_attempted, created_at, is_daily_challenge, is_elimination_game")
          .eq("user_id", u.id)
          .order("created_at", { ascending: false })
          .limit(30);

        if (mounted) setRecent(games || []);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Recent Games</Text>
        {recent?.length ? (
          <FlatList
            data={recent}
            keyExtractor={(g) => String(g.id)}
            contentContainerStyle={{ paddingTop: 8 }}
            renderItem={({ item }) => {
              const gameType = item.is_daily_challenge
                ? <Text style={[styles.gameSub, { color: "#B8860B" }]}>Daily</Text>
                : item.is_elimination_game
                ? <Text style={[styles.gameSub, { color: "purple" }]}>Elimination</Text>
                : <Text style={styles.gameSub}>Regular</Text>;

              return (
                <View style={styles.gameRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gameTitle}>
                      {item.player_name || "Unknown Player"}
                    </Text>
                    <Text style={styles.gameSub}>
                      {new Date(item.created_at).toLocaleDateString()} • {gameType}
                    </Text>
                  </View>
                  <Text style={[styles.points, { color: item.won ? "#15803d" : "#991b1b" }]}>
                    {item.won ? `+${item.points_earned}` : "0"} pts
                  </Text>
                </View>
              );
            }}
          />
        ) : (
          <Text style={styles.muted}>No games yet.</Text>
        )}
      </View>
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
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#0b3d24", fontFamily: "Tektur_700Bold" },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#eef2f7",
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  gameTitle: { fontWeight: "700", color: "#0b3d24", fontFamily: "Tektur_700Bold" },
  gameSub: { fontSize: 12, color: "#6b7280", marginTop: 2, fontFamily: "Tektur_400Regular" },
  points: { fontWeight: "800", fontFamily: "Tektur_700Bold" },
  muted: { color: "#6b7280", marginTop: 6, fontFamily: "Tektur_400Regular" },
});
