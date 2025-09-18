// mobile/app/(tabs)/_layout.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, View, Pressable, Platform, Text, Animated, TouchableOpacity, StyleSheet, DeviceEventEmitter } from 'react-native';
import { Tabs, useRouter, useSegments } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

// --- Google Font (Tektur) ---
import { useFonts, Tektur_700Bold } from '@expo-google-fonts/tektur';

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

function TopNav({ title, subtitle, showSubtitle, avatarUrl, onAvatarPress, titleFontFamily }) {
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

        {/* Center title + optional small subtitle */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: '#111827',
              fontFamily: titleFontFamily || undefined,
            }}
          >
            {title || ''}
          </Text>
          {showSubtitle && !!subtitle && (
            <Text
              numberOfLines={1}
              style={{
                fontSize: 12,
                color: '#6b7280',
                marginTop: 2,
                // keep the same font if loaded for a coherent look
                fontFamily: titleFontFamily || undefined,
              }}
            >
              {subtitle}
            </Text>
          )}
        </View>

        <Pressable onPress={onAvatarPress} hitSlop={8}>
          <Avatar uri={avatarUrl} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/**
 * Lightweight pop-animating button for tab-bar items (except the center floating tab).
 * Wraps the default tab item and adds a quick scale-up + spring-back on press.
 */
function PopTabButton(props) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    // Start pop animation
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.12, duration: 90, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 160 }),
    ]).start();

    // Trigger the original navigation behavior immediately
    props.onPress?.();
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={props.onLongPress}
      style={props.style}
      accessibilityRole={props.accessibilityRole}
      accessibilityState={props.accessibilityState}
      accessibilityLabel={props.accessibilityLabel}
      testID={props.testID}
      android_ripple={{ color: '#e5e7eb', borderless: true }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {props.children}
      </Animated.View>
    </Pressable>
  );
}

// Floating middle tab button (Daily)
function FloatingCenterButton({ onNavigate, focused }) {
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

  const handlePress = () => {
    // Add a quick pop on press while preserving existing behavior
    Animated.sequence([
      Animated.timing(scale, {
        toValue: focused ? 1.12 : 1.08,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: focused ? 1.04 : 0.96,
        useNativeDriver: true,
        friction: 6,
        tension: 120,
      }),
    ]).start();

    if (focused) {
      // Already on Game tab → ask it to scroll to top
      DeviceEventEmitter.emit('FT_SCROLL_TO_TOP_GAME');
    } else {
      // Not focused → navigate like normal
      onNavigate?.();
    }
  };

  return (
    <Pressable
      onPress={handlePress}
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

// --------- UTC Formatters ---------
function formatHeaderDateUTC(d) {
  try {
    return d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    // Fallback using UTC getters
    const wk = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()];
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
    const yyyy = d.getUTCFullYear();
    return `${wk}, ${dd} ${mon} ${yyyy}`;
  }
}

function formatHeaderTimeUTC(d) {
  // hh:mm:ss, zero-padded, based on UTC
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} UTC`;
}

export default function TabsLayout() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();

  // Load Tektur font
  const [fontsLoaded] = useFonts({ Tektur_700Bold });

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

  // === UTC clock: tick every second ===
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Compute UTC midnight tick (for safety if any logic relies on "day" changes)
  const midnightTimeoutRef = useRef(null);
  const scheduleUtcMidnightTick = React.useCallback(() => {
    if (midnightTimeoutRef.current) clearTimeout(midnightTimeoutRef.current);
    const n = new Date();
    // Next UTC midnight
    const nextUtcMidnight = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 0, 0, 100);
    const msUntil = nextUtcMidnight - n.getTime();
    midnightTimeoutRef.current = setTimeout(() => {
      setNow(new Date());
      scheduleUtcMidnightTick();
    }, msUntil);
  }, []);
  useEffect(() => {
    scheduleUtcMidnightTick();
    return () => midnightTimeoutRef.current && clearTimeout(midnightTimeoutRef.current);
  }, [scheduleUtcMidnightTick]);

  // Use UTC header date + time
  const utcHeaderDate = useMemo(() => formatHeaderDateUTC(now), [now]);
  const utcHeaderTime = useMemo(() => formatHeaderTimeUTC(now), [now]);

  const last = segments[segments.length - 1];
  const isGameFocused = last === 'game';

  return (
    <>
      <Tabs
        screenOptions={{
          header: ({ options }) => (
            <TopNav
              title={options.title}
              subtitle={isGameFocused ? utcHeaderTime : undefined}
              showSubtitle={isGameFocused}
              avatarUrl={avatarUrl}
              onAvatarPress={() => setMenuOpen((v) => !v)}
              titleFontFamily={fontsLoaded ? 'Tektur_700Bold' : undefined}
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
        {/* Hidden pages to inherit nav bars */}
        <Tabs.Screen name="profile-info" options={{ href: null, title: 'Profile Info' }} />
        <Tabs.Screen name="default-filters" options={{ href: null, title: 'Default Filters' }} />
        <Tabs.Screen name="recent-games" options={{ href: null, title: 'My Recent Games' }} />

        <Tabs.Screen
          name="leaderboard"
          options={{
            title: 'FootyTrail Leaderboard',
            tabBarIcon: ({ color, size, focused }) => (
              <MaterialCommunityIcons name="trophy-outline" size={size} color={focused ? THEME_GREEN : color} />
            ),
            // Add pop animation on press
            tabBarButton: (props) => <PopTabButton {...props} />,
          }}
        />
        <Tabs.Screen
          name="elimination"
          options={{
            title: 'Elimination Challenges',
            tabBarIcon: ({ color, size, focused }) => (
              <MaterialCommunityIcons name="axe" size={size} color={focused ? THEME_GREEN : color} />
            ),
            // Add pop animation on press
            tabBarButton: (props) => <PopTabButton {...props} />,
          }}
        />
        <Tabs.Screen
          name="game"
          options={{
            // Title now uses UTC date
            title: utcHeaderDate,
            tabBarButton: (props) => (
              <FloatingCenterButton
                focused={isGameFocused}
                onNavigate={props.onPress}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="leagues"
          options={{
            title: 'My Leagues',
            tabBarIcon: ({ color, size, focused }) => (
              <MaterialCommunityIcons name="shield-crown-outline" size={size} color={focused ? THEME_GREEN : color} />
            ),
            // Add pop animation on press
            tabBarButton: (props) => <PopTabButton {...props} />,
          }}
        />
        <Tabs.Screen
          name="about"
          options={{
            title: 'About FootyTrail',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name="information-circle-outline"
                size={size}
                color={focused ? THEME_GREEN : color}
              />
            ),
            // Add pop animation on press
            tabBarButton: (props) => <PopTabButton {...props} />,
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
              <MaterialCommunityIcons name="smart-card" size={18} color="#0b3d24" style={styles.menuIcon} />
              <Text style={[styles.menuText, { fontFamily: fontsLoaded ? 'Tektur_700Bold' : undefined }]}>Profile Info</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); router.push('/(tabs)/recent-games'); }}
            >
              <MaterialCommunityIcons name="timelapse" size={18} color="#0b3d24" style={styles.menuIcon} />
              <Text style={[styles.menuText, { fontFamily: fontsLoaded ? 'Tektur_700Bold' : undefined }]}>My Recent Games</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); router.push('/(tabs)/default-filters'); }}
            >
              <MaterialCommunityIcons name="account-filter" size={18} color="#0b3d24" style={styles.menuIcon} />
              <Text style={[styles.menuText, { fontFamily: fontsLoaded ? 'Tektur_700Bold' : undefined }]}>Default Filters</Text>
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
              <MaterialCommunityIcons name="logout" size={18} color="#b00020" style={styles.menuIcon} />
              <Text style={[styles.menuText, { color: '#b00020', fontWeight: '700', fontFamily: fontsLoaded ? 'Tektur_700Bold' : undefined }]}>
                Sign Out
              </Text>
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
  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuIcon: { marginRight: 10 },
  menuText: { fontSize: 14, color: '#0b3d24' },
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 6,
  },
});
