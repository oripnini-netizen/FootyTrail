import { View, Text, Pressable } from "react-native";
import { Link } from "expo-router";

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: "#fff" }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>FootyTrail (Mobile)</Text>
      <Text style={{ color: "#6b7280" }}>Router is working if navigation works.</Text>

      <Link href="/login" asChild>
        <Pressable style={{ paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, borderRadius: 12 }}>
          <Text style={{ fontWeight: "500" }}>Go to Login</Text>
        </Pressable>
      </Link>

      <Link href="/game" asChild>
        <Pressable style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#000" }}>
          <Text style={{ color: "#fff", fontWeight: "700" }}>Go to Game</Text>
        </Pressable>
      </Link>
    </View>
  );
}
