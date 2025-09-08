import React from "react";
import { View, Text } from "react-native";

export default function LeaguesScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: "700" }}>Leagues</Text>
      <Text style={{ marginTop: 8, color: "#374151", textAlign: "center" }}>
        Coming soon — leagues and invites will appear here.
      </Text>
    </View>
  );
}
