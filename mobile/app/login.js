import { View, Text } from "react-native";

export default function LoginScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Login (placeholder)</Text>
      <Text>We’ll wire Supabase auth here later.</Text>
    </View>
  );
}
