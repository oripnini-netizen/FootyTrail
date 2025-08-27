import { View, Text } from "react-native";

export default function GameScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Game (placeholder)</Text>
      <Text>We’ll render the daily/elimination flows here.</Text>
    </View>
  );
}
