import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, FlatList, RefreshControl } from "react-native";
import { supabase } from "../../lib/supabase"; // <-- fixed path

export default function LeaderboardScreen() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      // TODO: replace with your real source (Railway API / Supabase table)
      // Example:
      // const { data, error } = await supabase
      //   .from("leaderboard")
      //   .select("*")
      //   .order("points", { ascending: false })
      //   .limit(50);
      // if (error) throw error;
      // setRows(data || []);

      // Temporary mock so the screen renders
      setRows([
        { id: "1", name: "Alice", points: 123 },
        { id: "2", name: "Bob", points: 111 },
        { id: "3", name: "You", points: 99 },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      data={rows}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      renderItem={({ item, index }) => (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: "#f3f4f6",
            marginBottom: 10,
          }}
        >
          <Text style={{ fontWeight: "700" }}>{index + 1}.</Text>
          <Text style={{ flex: 1, marginLeft: 10 }}>{item.name}</Text>
          <Text style={{ fontVariant: ["tabular-nums"], fontWeight: "700" }}>{item.points}</Text>
        </View>
      )}
      ListEmptyComponent={
        <View style={{ padding: 16 }}>
          <Text>No data yet.</Text>
        </View>
      }
    />
  );
}
