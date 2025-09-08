import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabsLayout() {
  // Read device safe-area insets (notch/top, home-indicator/bottom, etc.)
  const insets = useSafeAreaInsets();

  return (
    // Keep content below the status bar (top/left/right). Let the tab bar
    // manage its own bottom inset.
    <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: "#166534",
          tabBarInactiveTintColor: "#6B7280",
          // Lift the bar above the home indicator and add inner padding
          tabBarStyle: {
            height: 56 + insets.bottom,
            paddingBottom: Math.max(10, insets.bottom),
            paddingTop: 6,
            borderTopColor: "#E5E7EB",
          },
          tabBarLabelStyle: { fontWeight: "600", marginBottom: 0 },
        }}
      >
        <Tabs.Screen
          name="game"
          options={{
            title: "Game",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? "game-controller" : "game-controller-outline"}
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="leaderboard"
          options={{
            title: "Leaderboard",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "trophy" : "trophy-outline"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "person" : "person-outline"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="elimination"
          options={{
            title: "Elimination",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "close-circle" : "close-circle-outline"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="leagues"
          options={{
            title: "Leagues",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "people" : "people-outline"} size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </SafeAreaView>
  );
}
