import React from "react";
import { View, Text } from "react-native";

export default function EliminationScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: "700" }}>Elimination</Text>
      <Text style={{ marginTop: 8, color: "#374151", textAlign: "center" }}>
        Coming soon — we’ll wire this to your elimination mode logic next.
      </Text>
    </View>
  );
}
