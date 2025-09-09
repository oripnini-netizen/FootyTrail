// mobile/app/(tabs)/_layout.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, View, Pressable, Platform, Text, Animated } from 'react-native';
import { Tabs, useRouter, useSegments } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

// ---------------- Theme ----------------
const THEME_GREEN = '#166534';      // focused circle / focused icon tint
const INACTIVE_GRAY = '#6b7280';    // non-focused tab icons
const UNFOCUSED_CIRCLE = '#e5e7eb'; // unfocused daily circle
const UNFOCUSED_ICON = '#9ca3af';   // unfocused daily icon (muted gray)

// ---------------- Helpers ----------------
function Avatar({ uri }) {
  if (!uri) {
    return <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#d1d5db' }} />;
  }
  return <Image source={{ uri }} style={{ width: 32, height: 32, borderRadius: 16 }} />;
}

function TopNav({ title, avatarUrl, onAvatarPress }) {
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
      <View
        style={{
          height: 56,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 10,
          paddingRight: 12,
          borderBottomColor: '#e5e7eb',
          borderBottomWidth: Platform.OS === 'ios' ? 0.5 : 0.7,
        }}
      >
        <Image
          source={require('../../assets/images/footytrail_logo.png')}
          style={{ width: 40, height: 40, resizeMode: 'contain' }}
        />
        <Text
          numberOfLines={1}
          style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#111827' }}
        >
          {title || ''}
        </Text>
        <Pressable onPress={onAvatarPress} hitSlop={8}>
          <Avatar uri={avatarUrl} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// Floating middle tab button (Daily) – stronger focused/unfocused difference
function FloatingCenterButton({ onPress, focused }) {
  // Scale animation (visible but subtle)
  const scale = useRef(new Animated.Value(focused ? 1.04 : 0.96)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1.04 : 0.96,
      useNativeDriver: true,
      friction: 6,
      tension: 120,
    }).start();
  }, [focused, scale]);

  // Visual deltas by state
  const innerBg = focused ? THEME_GREEN : UNFOCUSED_CIRCLE;
  const iconSize = focused ? 34 : 30;
  const iconColor = focused ? '#fff' : UNFOCUSED_ICON;
  const ringBorderWidth = focused ? 2 : 1;
  const ringBorderColor = focused ? '#e5e7eb' : '#f3f4f6';
  const lift = focused ? -24 : -20; // slightly less lift when unfocused

  return (
    <Pressable
      onPress={onPress}
      style={{ top: lift, justifyContent: 'center', alignItems: 'center' }}
      android_ripple={{ color: '#e5e7eb', borderless: true }}
    >
      {/* white ring to make it "pop" */}
      <Animated.View
        style={{
          transform: [{ scale }],
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: '#fff',
          justifyContent: 'center',
          alignItems: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
          borderWidth: ringBorderWidth,
          borderColor: ringBorderColor,
        }}
      >
        <View
          style={{
            width: 70,
            height: 70,
            borderRadius: 35,
            backgroundColor: innerBg,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <MaterialCommunityIcons name="soccer" size={iconSize} color={iconColor} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

// Format date dd/mm/yyyy
function formatDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export default function TabsLayout() {
  const router = useRouter();
  const segments = useSegments(); // <-- reliable current route
  const insets = useSafeAreaInsets();

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      if (!userId) return;

      let { data, error } = await supabase
        .from('users')
        .select('profile_photo_url')
        .eq('id', userId)
        .single();

      if (error || !data?.profile_photo_url) {
        const alt = await supabase.from('users').select('profile_photo_url').eq('user_id', userId).single();
        if (!alt.error) data = alt.data;
      }
      if (mounted && data?.profile_photo_url) setAvatarUrl(data.profile_photo_url);
    })();
    return () => { mounted = false; };
  }, []);

  // Daily title – auto-refresh at midnight
  const [today, setToday] = useState(() => new Date());
  const timeoutRef = useRef(null);
  const scheduleMidnightTick = React.useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 100);
    timeoutRef.current = setTimeout(() => {
      setToday(new Date());
      scheduleMidnightTick();
    }, midnight.getTime() - now.getTime());
  }, []);
  useEffect(() => {
    scheduleMidnightTick();
    return () => timeoutRef.current && clearTimeout(timeoutRef.current);
  }, [scheduleMidnightTick]);
  const dailyTitle = useMemo(() => formatDDMMYYYY(today), [today]);

  // ← Determine if the current route is the game tab
  const last = segments[segments.length - 1];
  const isGameFocused = last === 'game';

  return (
    <Tabs
      screenOptions={{
        header: ({ options }) => (
          <TopNav
            title={options.title}
            avatarUrl={avatarUrl}
            onAvatarPress={() => router.push('/(tabs)/profile')}
          />
        ),
        tabBarShowLabel: false,                 // no text under icons
        tabBarActiveTintColor: THEME_GREEN,     // focus tint for non-center icons
        tabBarInactiveTintColor: INACTIVE_GRAY,
        tabBarStyle: {
          height: 64 + (insets.bottom ? insets.bottom - 6 : 0),
          paddingTop: 6,
          paddingBottom: (insets.bottom ? insets.bottom - 6 : 8),
          backgroundColor: '#fff',
          borderTopColor: '#e5e7eb',
          borderTopWidth: 1,
        },
      }}
    >
      {/* Hide stray routes */}
      <Tabs.Screen name="index" options={{ href: null }} />
      {/* profile lives inside tabs but hidden from the bar */}
      <Tabs.Screen name="profile" options={{ href: null, title: 'Profile' }} />
      <Tabs.Screen name="explore" options={{ href: null }} />

      {/* Left 1: Leaderboard */}
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: 'Leaderboard',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name="trophy" size={size} color={focused ? THEME_GREEN : color} />
          ),
        }}
      />

      {/* Left 2: Elimination */}
      <Tabs.Screen
        name="elimination"
        options={{
          title: 'Elimination',
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons name="axe" size={size} color={focused ? THEME_GREEN : color} />
          ),
        }}
      />

      {/* CENTER: Daily (game.js) – floating, clearly distinct focused vs unfocused */}
      <Tabs.Screen
        name="game"
        options={{
          title: dailyTitle,
          // Pass a reliable 'focused' computed from route segments
          tabBarButton: (props) => (
            <FloatingCenterButton
              focused={isGameFocused}
              onPress={props.onPress}
            />
          ),
        }}
      />

      {/* Right 2: Leagues */}
      <Tabs.Screen
        name="leagues"
        options={{
          title: 'Leagues',
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons name="table" size={size} color={focused ? THEME_GREEN : color} />
          ),
        }}
      />

      {/* Right 1: About */}
      <Tabs.Screen
        name="about"
        options={{
          title: 'About',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name="information-circle-outline"
              size={size}
              color={focused ? THEME_GREEN : color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
