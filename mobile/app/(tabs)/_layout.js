// mobile/app/(tabs)/_layout.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, View, Pressable, Platform, Text, Animated, TouchableOpacity, StyleSheet } from 'react-native';
import { Tabs, useRouter, useSegments } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

// ---------------- Theme ----------------
const THEME_GREEN = '#166534';
const INACTIVE_GRAY = '#6b7280';
const UNFOCUSED_CIRCLE = '#e5e7eb';
const UNFOCUSED_ICON = '#9ca3af';

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

// Floating middle tab button (Daily)
function FloatingCenterButton({ onPress, focused }) {
  const scale = useRef(new Animated.Value(focused ? 1.04 : 0.96)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1.04 : 0.96,
      useNativeDriver: true,
      friction: 6,
      tension: 120,
    }).start();
  }, [focused, scale]);

  const innerBg = focused ? THEME_GREEN : UNFOCUSED_CIRCLE;
  const iconSize = focused ? 34 : 30;
  const iconColor = focused ? '#fff' : UNFOCUSED_ICON;
  const ringBorderWidth = focused ? 2 : 1;
  const ringBorderColor = focused ? '#e5e7eb' : '#f3f4f6';
  const lift = focused ? -24 : -20;

  return (
    <Pressable
      onPress={onPress}
      style={{ top: lift, justifyContent: 'center', alignItems: 'center' }}
      android_ripple={{ color: '#e5e7eb', borderless: true }}
    >
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
  const segments = useSegments();
  const insets = useSafeAreaInsets();

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // for anchored menu placement
  const NAV_HEIGHT = 56;
  const menuTop = (insets.top || 0) + NAV_HEIGHT + 4;

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      if (!userId) return;

      const { data } = await supabase
        .from('users')
        .select('profile_photo_url')
        .eq('id', userId)
        .maybeSingle();

      if (mounted && data?.profile_photo_url) setAvatarUrl(data.profile_photo_url);
    })();
    return () => { mounted = false; };
  }, []);

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

  const last = segments[segments.length - 1];
  const isGameFocused = last === 'game';

  return (
    <>
      <Tabs
        screenOptions={{
          header: ({ options }) => (
            <TopNav
              title={options.title}
              avatarUrl={avatarUrl}
              onAvatarPress={() => setMenuOpen((v) => !v)}
            />
          ),
          tabBarShowLabel: false,
          tabBarActiveTintColor: THEME_GREEN,
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
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="explore" options={{ href: null }} />

        {/* Hidden pages to inherit nav bars */}
        <Tabs.Screen name="profile-info" options={{ href: null, title: 'Profile Info' }} />
        <Tabs.Screen name="default-filters" options={{ href: null, title: 'Default Filters' }} />
        <Tabs.Screen name="recent-games" options={{ href: null, title: 'Recent Games' }} />

        <Tabs.Screen
          name="leaderboard"
          options={{
            title: 'Leaderboard',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name="trophy" size={size} color={focused ? THEME_GREEN : color} />
            ),
          }}
        />
        <Tabs.Screen
          name="elimination"
          options={{
            title: 'Elimination',
            tabBarIcon: ({ color, size, focused }) => (
              <MaterialCommunityIcons name="axe" size={size} color={focused ? THEME_GREEN : color} />
            ),
          }}
        />
        <Tabs.Screen
          name="game"
          options={{
            title: dailyTitle,
            tabBarButton: (props) => (
              <FloatingCenterButton
                focused={isGameFocused}
                onPress={props.onPress}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="leagues"
          options={{
            title: 'Leagues',
            tabBarIcon: ({ color, size, focused }) => (
              <MaterialCommunityIcons name="table" size={size} color={focused ? THEME_GREEN : color} />
            ),
          }}
        />
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

      {/* Anchored menu: backdrop starts BELOW top bar, so avatar stays visible */}
      {menuOpen && (
        <>
          {/* Backdrop only below the nav bar */}
          <Pressable
            onPress={() => setMenuOpen(false)}
            style={[styles.backdropBelowNav, { top: menuTop }]}
          />
          {/* Menu box positioned under avatar (top-right) */}
          <View style={[styles.menu, { top: menuTop, right: 16 }]}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); router.push('/(tabs)/profile-info'); }}
            >
              <Ionicons name="stats-chart" size={18} color="#0b3d24" style={styles.menuIcon} />
              <Text style={styles.menuText}>Profile Info</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); router.push('/(tabs)/recent-games'); }}
            >
              <Ionicons name="time-outline" size={18} color="#0b3d24" style={styles.menuIcon} />
              <Text style={styles.menuText}>Recent Games</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); router.push('/(tabs)/default-filters'); }}
            >
              <Ionicons name="funnel" size={18} color="#0b3d24" style={styles.menuIcon} />
              <Text style={styles.menuText}>Default Filters</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* === CHANGED: local-scope sign-out + drop realtime channels === */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={async () => {
                setMenuOpen(false);
                try {
                  await supabase.auth.signOut({ scope: 'local' });
                  try { supabase.removeAllChannels?.(); } catch {}
                } catch {}
                router.replace('/login');
              }}
            >
              <Ionicons name="log-out-outline" size={18} color="#b00020" style={styles.menuIcon} />
              <Text style={[styles.menuText, { color: '#b00020', fontWeight: '700' }]}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdropBelowNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  menu: {
    position: 'absolute',
    width: 240,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  menuItem: { paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  menuIcon: { marginRight: 10 },
  menuText: { fontSize: 15, color: '#111827' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#e5e7eb', marginVertical: 4 },
});
