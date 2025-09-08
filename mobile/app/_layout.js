import React from "react";
import { View, Text, Pressable } from "react-native";
import { Stack, useRouter, usePathname } from "expo-router";

/**
 * Simple top navigation bar shown on all pages except /login (and you can
 * hide it on others later if you like). It lets you jump between core pages.
 */
function HeaderNav() {
  const router = useRouter();
  const pathname = usePathname();

  const Item = ({ label, to }) => {
    const active = pathname === to;
    return (
      <Pressable
        onPress={() => router.push(to)}
        style={{
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 8,
          backgroundColor: active ? "#DCFCE7" : "transparent", // light green highlight
        }}
      >
        <Text
          style={{
            fontWeight: active ? "800" : "600",
            color: active ? "#166534" : "#111827",
          }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={{
        height: 56,
        paddingHorizontal: 12,
        backgroundColor: "#FFFFFF",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottomWidth: 1,
        borderBottomColor: "#E5E7EB",
      }}
    >
      <Text style={{ fontSize: 18, fontWeight: "800" }}>FootyTrail</Text>

      <View style={{ flexDirection: "row", gap: 8 }}>
        {/* Add/rename items as you add screens */}
        <Item label="Game" to="/game" />
        <Item label="Live" to="/live" />
        <Item label="Profile" to="/profile" />
      </View>
    </View>
  );
}

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        header: () => <HeaderNav />,
      }}
    >
      {/* The index “gate” that redirects after login check */}
      <Stack.Screen name="index" options={{ headerShown: false }} />

      {/* Hide header on the login page (removes the “login” title) */}
      <Stack.Screen name="login" options={{ headerShown: false }} />

      {/* You can hide header on tutorial if you prefer full-screen onboarding */}
      <Stack.Screen name="tutorial" options={{ headerShown: false }} />

      {/* Show header (nav bar) on these pages */}
      <Stack.Screen name="game" />
      <Stack.Screen name="live" />
      <Stack.Screen name="profile" />
    </Stack>
  );
}
