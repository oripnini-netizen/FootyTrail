// mobile/app/tutorial.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Dimensions,
  Image,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Pressable,
  Switch, // ⬅️ NEW
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";
import { SafeAreaView } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system";
import { Ionicons } from "@expo/vector-icons";
import { getCounts } from "../lib/api";

const BG = "#F0FDF4";
const SCREEN = Dimensions.get("window");
const SLIDE_WIDTH = SCREEN.width;

export default function TutorialScreen() {
  const router = useRouter();

  const [slidesReady, setSlidesReady] = useState(true);
  const [index, setIndex] = useState(0);

  // user profile
  const [user, setUser] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  // ---------- Filters state (keep in sync with default-filters) ----------
  const [allCompetitions, setAllCompetitions] = useState([]);
  const [allSeasons, setAllSeasons] = useState([]);

  const [defaultCompetitionIds, setDefaultCompetitionIds] = useState([]);
  const [defaultSeasons, setDefaultSeasons] = useState([]);
  const [minMarketValue, setMinMarketValue] = useState(0);
  const [minAppearances, setMinAppearances] = useState(0);

  const [compOpen, setCompOpen] = useState(false);
  const [compQuery, setCompQuery] = useState("");
  const [seasonsOpen, setSeasonsOpen] = useState(false);
  const [seasonQuery, setSeasonQuery] = useState("");

  const [poolCount, setPoolCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [countsError, setCountsError] = useState("");

  // ---------- Notifications state (same columns as profile-info.js) ----------
  const [notifs, setNotifs] = useState({
    notifications_all: true,
    notify_daily_challenge: true,
    notify_daily_games: true,
    notify_private_elims: true,
    notify_public_elims: true,
  });
  const allIndividualsOn = useMemo(
    () =>
      notifs.notify_daily_challenge &&
      notifs.notify_daily_games &&
      notifs.notify_private_elims &&
      notifs.notify_public_elims,
    [notifs]
  );

  const scrollerRef = useRef(null);

  // Pull current session + profile + defaults
  useEffect(() => {
    (async () => {
      const {
        data: { user: sessionUser },
      } = await supabase.auth.getUser();
      if (!sessionUser) {
        router.replace("/(auth)/login");
        return;
      }
      setUser(sessionUser);

      // load profile defaults (+ notification prefs)
      const { data, error } = await supabase
        .from("users")
        .select(
          [
            "full_name",
            "profile_photo_url",
            "default_min_market_value",
            "default_min_appearances",
            "default_competitions",
            "default_seasons",
            // ⬇️ NEW: notifications columns pulled like in profile-info.js
            "notifications_all",
            "notify_daily_challenge",
            "notify_daily_games",
            "notify_private_elims",
            "notify_public_elims",
          ].join(",")
        )
        .eq("id", sessionUser.id)
        .maybeSingle();

      if (!error && data) {
        setDisplayName(data.full_name || "");
        setAvatarUrl(data.profile_photo_url || "");
        setMinMarketValue(Number(data.default_min_market_value || 0));
        setMinAppearances(Number(data.default_min_appearances || 0));
        setDefaultCompetitionIds((data.default_competitions || []).map(String));
        setDefaultSeasons((data.default_seasons || []).map(String));

        // ⬇️ Initialize notification prefs same as Profile
        setNotifs({
          notifications_all: data?.notifications_all ?? true,
          notify_daily_challenge: data?.notify_daily_challenge ?? true,
          notify_daily_games: data?.notify_daily_games ?? true,
          notify_private_elims: data?.notify_private_elims ?? true,
          notify_public_elims: data?.notify_public_elims ?? true,
        });
      }

      // load competitions & seasons like default-filters.js
      let payload = await fetchFromWebAPI();
      if (!payload) payload = await fetchFromSupabaseFallback();
      setAllCompetitions(payload.flatCompetitions || []);
      setAllSeasons(payload.seasons || []);

      setSlidesReady(true);
    })();
  }, [router]);

  // ---------- web API first, fallback to Supabase ----------
  async function fetchFromWebAPI() {
    const base = process.env.EXPO_PUBLIC_API_BASE;
    if (!base) return null;
    try {
      const [cRes, sRes] = await Promise.all([
        fetch(`${base}/competitions`, { headers: { Accept: "application/json" } }),
        fetch(`${base}/seasons`, { headers: { Accept: "application/json" } }),
      ]);
      if (!cRes.ok || !sRes.ok) return null;

      const comps = await cRes.json(); // { groupedByCountry: { country: [..] } }
      const seas = await sRes.json(); // { seasons: [..] }

      const flat = [];
      Object.entries(comps.groupedByCountry || {}).forEach(([country, arr]) =>
        (arr || []).forEach((c) => flat.push({ ...c, country }))
      );

      return {
        flatCompetitions: flat,
        seasons: Array.isArray(seas.seasons) ? seas.seasons.map(String) : [],
      };
    } catch {
      return null;
    }
  }

  async function fetchFromSupabaseFallback() {
    const { data: comps, error: compErr } = await supabase
      .from("competitions")
      .select("country, competition_id, competition_name, flag_url, logo_url, total_value_eur")
      .order("country", { ascending: true });
    if (compErr) throw compErr;

    const { data: seasonsRows, error: seasonsErr } = await supabase
      .from("v_competitions_with_seasons")
      .select("seasons");
    if (seasonsErr) throw seasonsErr;

    const set = new Set();
    (seasonsRows || []).forEach((r) => {
      const raw = r?.seasons;
      let arr = [];
      if (Array.isArray(raw)) arr = raw;
      else if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) arr = parsed;
        } catch {
          /* ignore */
        }
      }
      arr.forEach((s) => set.add(String(s)));
    });

    const seasons = Array.from(set)
      .filter(Boolean)
      .sort((a, b) => Number(b) - Number(a));

    return {
      flatCompetitions: (comps || []).map((c) => ({ ...c })),
      seasons,
    };
  }

  // ---------- Counts (recompute when filters change) ----------
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!user) return;
      try {
        setLoadingCounts(true);
        setCountsError("");
        const payload = {
          competitions: defaultCompetitionIds,
          seasons: defaultSeasons,
          minMarketValue: Number(minMarketValue) || 0,
          minAppearances: Number(minAppearances) || 0,
          userId: user.id,
        };
        const res = await getCounts(payload);
        if (!cancelled) {
          setPoolCount(res?.poolCount || 0);
          setTotalCount(res?.totalCount || 0);
        }
      } catch (e) {
        if (!cancelled) {
          setPoolCount(0);
          setTotalCount(0);
          setCountsError(String(e?.message || e));
        }
      } finally {
        if (!cancelled) setLoadingCounts(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [user, defaultCompetitionIds, defaultSeasons, minMarketValue, minAppearances]);

  // ---------- helpers ----------
  const filteredCompetitions = useMemo(() => {
    const q = compQuery.trim().toLowerCase();
    if (!q) return allCompetitions;
    return allCompetitions.filter(
      (c) =>
        (c.competition_name || "").toLowerCase().includes(q) ||
        (c.country || "").toLowerCase().includes(q)
    );
  }, [compQuery, allCompetitions]);

  const compsOrderedForDropdown = useMemo(() => {
    const ids = new Set(defaultCompetitionIds);
    const list = compQuery.trim() ? filteredCompetitions : allCompetitions;
    return [...list].sort((a, b) => {
      const sa = ids.has(String(a.competition_id)) ? 0 : 1;
      const sb = ids.has(String(b.competition_id)) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const ca = (a.country || "").localeCompare(b.country || "");
      if (ca !== 0) return ca;
      return (a.competition_name || "").localeCompare(b.competition_name || "");
    });
  }, [allCompetitions, filteredCompetitions, compQuery, defaultCompetitionIds]);

  const seasonsOrderedForDropdown = useMemo(() => {
    const sel = new Set(defaultSeasons);
    const base = seasonQuery
      ? allSeasons.filter((s) => s.toLowerCase().includes(seasonQuery.trim().toLowerCase()))
      : allSeasons;
    return [...base].sort((a, b) => {
      const sa = sel.has(a) ? 0 : 1;
      const sb = sel.has(b) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return Number(b) - Number(a);
    });
  }, [allSeasons, defaultSeasons, seasonQuery]);

  const toggleCompetition = (id) => {
    setDefaultCompetitionIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const toggleSeason = (season) => {
    setDefaultSeasons((prev) =>
      prev.includes(season) ? prev.filter((s) => s !== season) : [...prev, season]
    );
  };

  const top10Ids = useMemo(() => {
    const arr = [...allCompetitions];
    arr.sort((a, b) => Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0));
    return arr.slice(0, 10).map((c) => String(c.competition_id));
  }, [allCompetitions]);

  const arraysEqualAsSets = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const isTop10Selected =
    defaultCompetitionIds.length > 0 &&
    top10Ids.length > 0 &&
    arraysEqualAsSets(defaultCompetitionIds, top10Ids);
  const isAllCompsSelected =
    allCompetitions.length > 0 && defaultCompetitionIds.length === allCompetitions.length;
  const isClearComps = defaultCompetitionIds.length === 0;

  const isLast3Seasons =
    allSeasons.length >= 3 &&
    defaultSeasons.length === 3 &&
    arraysEqualAsSets(defaultSeasons, allSeasons.slice(0, 3));
  const isLast5Seasons =
    allSeasons.length >= 5 &&
    defaultSeasons.length === 5 &&
    arraysEqualAsSets(defaultSeasons, allSeasons.slice(0, 5));
  const isAllSeasons = allSeasons.length > 0 && defaultSeasons.length === allSeasons.length;
  const isClearSeasons = defaultSeasons.length === 0;

  const selectTop10 = () => setDefaultCompetitionIds(top10Ids);
  const selectAllComps = () => {
    const all = (allCompetitions || []).map((c) => String(c.competition_id));
    setDefaultCompetitionIds(all);
  };
  const clearComps = () => setDefaultCompetitionIds([]);

  // Avatar upload (RN-safe bytes upload)
  const uploadAvatarFromLibrary = useCallback(async () => {
    try {
      if (!user?.id) return;

      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "We need access to your photos to pick an avatar.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setUploading(true);

      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const base64ToUint8Array = (b64) => {
        const binary = global.atob
          ? global.atob(b64)
          : Buffer.from(b64, "base64").toString("binary");
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      };

      const bytes = base64ToUint8Array(base64);
      const mime =
        asset.mimeType || (asset.uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
      const ext = (mime.split("/")[1] || "jpg").toLowerCase();

      const fileName = `${user.id}_${Date.now()}.${ext}`;
      const path = `public/${user.id}/${fileName}`;

      const { error: upErr } = await supabase.storage.from("avatars").upload(path, bytes, {
        contentType: mime,
        cacheControl: "3600",
        upsert: true,
      });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = pub?.publicUrl ?? "";

      const { error: updErr } = await supabase
        .from("users")
        .update({ profile_photo_url: publicUrl })
        .eq("id", user.id);
      if (updErr) throw updErr;

      setAvatarUrl(publicUrl);
    } catch (e) {
      console.error("Avatar upload failed:", e);
      Alert.alert("Upload failed", "We couldn’t upload your image. Please try again.");
    } finally {
      setUploading(false);
    }
  }, [user]);

  const saveProfileSilent = useCallback(async () => {
    if (!user?.id) return;
    const updates = {
      full_name: displayName || "",
      profile_photo_url: avatarUrl || null,
    };
    const { error } = await supabase.from("users").update(updates).eq("id", user.id);
    if (error) throw error;
  }, [user, displayName, avatarUrl]);

  const finish = useCallback(async () => {
    if (!user?.id) return;

    try {
      // persist profile
      await saveProfileSilent();

      // persist filters + mark onboarding completed
      const updates = {
        default_competitions: defaultCompetitionIds,
        default_seasons: defaultSeasons,
        default_min_market_value: Number(minMarketValue) || 0,
        default_min_appearances: Number(minAppearances) || 0,
        has_completed_onboarding: true,
        // also persist notifications in case they changed here
        notifications_all: notifs.notifications_all,
        notify_daily_challenge: notifs.notify_daily_challenge,
        notify_daily_games: notifs.notify_daily_games,
        notify_private_elims: notifs.notify_private_elims,
        notify_public_elims: notifs.notify_public_elims,
      };
      const { error } = await supabase.from("users").update(updates).eq("id", user.id);
      if (error) throw error;

      router.replace("/");
    } catch (e) {
      console.error(e);
      Alert.alert("Something went wrong", "Please try again.");
    }
  }, [
    user,
    saveProfileSilent,
    defaultCompetitionIds,
    defaultSeasons,
    minMarketValue,
    minAppearances,
    notifs,
    router,
  ]);

  const goTo = (i) => {
    setIndex(i);
    scrollerRef.current?.scrollTo({ x: i * SLIDE_WIDTH, animated: true });
  };

  // --- Persist notifications helper (same idea as profile-info.js) ---
  const persistNotifs = useCallback(
    async (next) => {
      if (!user?.id) return;
      try {
        await supabase
          .from("users")
          .update({
            notifications_all: next.notifications_all,
            notify_daily_challenge: next.notify_daily_challenge,
            notify_daily_games: next.notify_daily_games,
            notify_private_elims: next.notify_private_elims,
            notify_public_elims: next.notify_public_elims,
          })
          .eq("id", user.id);
      } catch (e) {
        Alert.alert("Save failed", "Could not update notification preferences.");
      }
    },
    [user?.id]
  );

  const onToggleAll = (value) => {
    const next = {
      notifications_all: value,
      notify_daily_challenge: value,
      notify_daily_games: value,
      notify_private_elims: value,
      notify_public_elims: value,
    };
    setNotifs(next);
    persistNotifs(next);
  };

  const onToggleOne = (key, value) => {
    const next = { ...notifs, [key]: value };
    next.notifications_all =
      next.notify_daily_challenge &&
      next.notify_daily_games &&
      next.notify_private_elims &&
      next.notify_public_elims;
    setNotifs(next);
    persistNotifs(next);
  };

  // HEADER — Skip removed
  const Header = () => (
    <View
      style={{
        width: "100%",
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 2,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Image
          source={require("../assets/images/footytrail_logo.png")}
          style={{ width: 36, height: 36, borderRadius: 8 }}
          resizeMode="contain"
        />
        <Text style={{ fontSize: 18, fontWeight: "700", color: "#065f46" }}>FootyTrail</Text>
      </View>

      {/* spacer keeps layout even without Skip */}
      <View style={{ width: 48 }} />
    </View>
  );

  const Footer = () => (
    <View style={{ width: "100%", padding: 16, gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 }}>
        {new Array(9).fill(0).map((_, i) => ( // ⬅️ updated to 9 slides
          <View
            key={i}
            style={{
              width: index === i ? 18 : 8,
              height: 8,
              borderRadius: 8,
              backgroundColor: index === i ? "#10B981" : "#A7F3D0",
            }}
          />
        ))}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <TouchableOpacity
          onPress={() => goTo(Math.max(index - 1, 0))}
          disabled={index === 0}
          style={{
            opacity: index === 0 ? 0.4 : 1,
            backgroundColor: "white",
            borderWidth: 1,
            borderColor: "#D1FAE5",
            paddingVertical: 12,
            paddingHorizontal: 18,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: "#064E3B", fontWeight: "700" }}>Back</Text>
        </TouchableOpacity>

        {index < 8 ? ( // ⬅️ last slide index = 8
          <TouchableOpacity
            onPress={() => goTo(index + 1)}
            style={{
              backgroundColor: "#059669",
              paddingVertical: 12,
              paddingHorizontal: 20,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: "white", fontWeight: "800" }}>Continue</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={finish}
            style={{
              backgroundColor: "#2563EB",
              paddingVertical: 12,
              paddingHorizontal: 20,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: "white", fontWeight: "800" }}>Finish</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const SlideContainer = ({ children }) => (
    <View style={{ width: SLIDE_WIDTH, paddingHorizontal: 18, paddingTop: 6 }}>
      <View
        style={{
          backgroundColor: "white",
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: "#DEF7EC",
        }}
      >
        {children}
      </View>
    </View>
  );

  if (!slidesReady) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}
      >
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <Header />

      <ScrollView
        ref={scrollerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          setIndex(Math.round(x / SLIDE_WIDTH));
        }}
        contentContainerStyle={{ alignItems: "flex-start" }}
      >
        {/* 1) Welcome */}
        <SlideContainer>
          <Text style={styles.h1}>Welcome! 🌟</Text>
          <Text style={styles.p}>
            FootyTrail is your daily football guessing adventure. Earn points by identifying players
            from smart hints, climb leaderboards, take on Daily Challenges, battle in Elimination
            arenas, and compete in Leagues with friends.
          </Text>

          {/* Splash image to make it lively */}
          <Image
            source={require("../assets/images/footytrail_splash-icon.png")}
            resizeMode="contain"
            style={{ width: "100%", height: 400, marginTop: 12, borderRadius: 16 }}
          />
        </SlideContainer>

        {/* 2) Live Game */}
        <SlideContainer>
          <Text style={styles.h1}>Live Game ⚡</Text>
          <Text style={styles.p}>
            Guess the player by his transfer history. Fewer hints used = more points. Tap hints
            wisely and lock your guess when ready.
          </Text>

          {/* side-by-side screenshots */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <Image
              source={require("../assets/images/live-game_screenshot1.png")}
              resizeMode="cover"
              style={{ width: "50%", height: 320, borderRadius: 12 }}
            />
            <Image
              source={require("../assets/images/live-game_screenshot2.png")}
              resizeMode="cover"
              style={{ width: "50%", height: 320, borderRadius: 12 }}
            />
          </View>

          <View style={{ marginTop: 12 }}>
            <Text style={styles.li}>• 2 minutes to solve.</Text>
            <Text style={styles.li}>• 3 guesses allowed.</Text>
            <Text style={styles.li}>• Start typing to see matching players quickly.</Text>
            <Text style={styles.li}>• Use hints wisely; the more you reveal, the fewer points you’ll score.</Text>
          </View>
        </SlideContainer>

        {/* 3) Daily Progress */}
        <SlideContainer>
          <Text style={styles.h1}>Daily Progress 📆</Text>
          <Text style={styles.p}>
            Your main screen shows how many games you’ve played today, and how many points you’ve
            earned. You get 10 games a day to play with your filters of choice + the Daily
            Challenge. Come back daily to keep momentum—and unlock an extra game by winning the
            Daily Challenge!
          </Text>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <Image
              source={require("../assets/images/daily-screenshot.png")}
              resizeMode="cover"
              style={{ flex: 1, height: 360, borderRadius: 12 }}
            />
            <Image
              source={require("../assets/images/leaderboard-screenshot.png")}
              resizeMode="cover"
              style={{ flex: 1, height: 360, borderRadius: 12 }}
            />
          </View>
        </SlideContainer>

        {/* 4) Daily Challenge */}
        <SlideContainer>
          <Text style={styles.h1}>Daily Challenge 🔥</Text>
          <Text style={styles.p}>
            One special puzzle per day. Same high caliber player from the top 10 leagues for all
            FootyTrail users to guess. Win it to earn an extra game for your daily allowance and
            show off your badge in the leaderboard. Turn on Notifications to remind you—don’t miss
            it!
          </Text>

          <Image
            source={require("../assets/images/dailychallenge-screenshot.png")}
            resizeMode="cover"
            style={{ width: "100%", height: 380, borderRadius: 12, marginTop: 12 }}
          />
        </SlideContainer>

        {/* 5) Elimination Challenges */}
        <SlideContainer>
          <Text style={styles.h1}>Elimination Challenges 🪓</Text>
          <Text style={styles.p}>
            Stake points, survive round by round, and avoid being the lowest scorer when elimination
            hits. Private or public—invite friends or join the crowd. Last survivor takes the pot!
          </Text>

          <Image
            source={require("../assets/images/elimination-screenshot.png")}
            resizeMode="cover"
            style={{ width: "100%", height: 380, borderRadius: 12, marginTop: 12 }}
          />
        </SlideContainer>

        {/* 6) Leagues */}
        <SlideContainer>
          <Text style={styles.h1}>Leagues 🏆</Text>
          <Text style={styles.p}>
            Create or join leagues with friends and track head-to-head results. Your daily points are your match days scores! 
            Your avatar = your identity, bragging rights = priceless.
          </Text>

          <Image
            source={require("../assets/images/leagues-screenshot.png")}
            resizeMode="cover"
            style={{ width: "100%", height: 400, borderRadius: 12, marginTop: 12 }}
          />
        </SlideContainer>

        {/* 7) User Details (username + avatar) */}
        <SlideContainer>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Text style={styles.h1}>Set Your Details 👤</Text>

            <Text style={[styles.p, { fontSize: 12, marginBottom: 10 }]}>
              Pick a display name and avatar. You can always change these later in Settings.
            </Text>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  overflow: "hidden",
                  backgroundColor: "#ECFDF5",
                  borderWidth: 1,
                  borderColor: "#D1FAE5",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={{ width: "100%", height: "100%" }} />
                ) : (
                  <Text style={{ color: "#34D399", fontWeight: "700" }}>🙂</Text>
                )}
              </View>
              <TouchableOpacity
                onPress={uploadAvatarFromLibrary}
                disabled={uploading}
                style={{
                  backgroundColor: "white",
                  borderWidth: 1,
                  borderColor: "#D1FAE5",
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  opacity: uploading ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#065F46", fontWeight: "700" }}>
                  {uploading ? "Uploading…" : "Choose Avatar"}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 12, color: "#065f46", marginBottom: 6 }}>Display Name</Text>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              autoCapitalize="words"
              style={styles.input}
              onBlur={async () => {
                try {
                  await saveProfileSilent();
                } catch {
                  /* ignore */
                }
              }}
            />
          </KeyboardAvoidingView>
        </SlideContainer>

        {/* 8) Notifications — NEW (matches profile-info look & logic) */}
        <SlideContainer>
          <Text style={styles.h1}>Notifications 🔔</Text>
          <Text style={[styles.p, { marginBottom: 10 }]}>
            Stay in the loop: reminders for the Daily Challenge, gentle nudges to keep your streak,
            and heads-up when you’re invited to Elimination challenges. You can tweak these anytime
            in Settings.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Notification Preferences</Text>

            <NotifRow
              title="All notifications"
              value={notifs.notifications_all}
              onValueChange={onToggleAll}
            />

            <View style={styles.divider} />

            <NotifRow
              title="Daily challenge reminders"
              value={notifs.notify_daily_challenge}
              onValueChange={(v) => onToggleOne("notify_daily_challenge", v)}
            />
            <NotifRow
              title="Daily games reminders"
              value={notifs.notify_daily_games}
              onValueChange={(v) => onToggleOne("notify_daily_games", v)}
            />
            <NotifRow
              title="Private elimination challenges"
              value={notifs.notify_private_elims}
              onValueChange={(v) => onToggleOne("notify_private_elims", v)}
            />
            <NotifRow
              title="Public elimination challenges"
              value={notifs.notify_public_elims}
              onValueChange={(v) => onToggleOne("notify_public_elims", v)}
            />

            {!allIndividualsOn && notifs.notifications_all ? (
              <Text style={styles.hintText}>
                Tip: “All notifications” turns off automatically if you disable a specific type.
              </Text>
            ) : null}
          </View>
        </SlideContainer>

        {/* 9) Default Filters — competitions, seasons, min market value, min appearances + counts */}
        <SlideContainer>
          <ScrollView>
            <Text style={styles.h1}>Default Filters 🎛️</Text>
            <Text style={[styles.p, { fontSize: 12, marginBottom: 12 }]}>
              Choose your go-to pool. You can change these anytime in your profile.
            </Text>

            {/* COMPETITIONS */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Competitions</Text>

              <View style={styles.rowWrap}>
                <Chip onPress={selectTop10} selected={isTop10Selected}>
                  Top 10
                </Chip>
                <Chip onPress={selectAllComps} selected={isAllCompsSelected}>
                  Select All
                </Chip>
                <Chip onPress={clearComps} variant="outline" selected={isClearComps}>
                  Clear All
                </Chip>
              </View>

              <Pressable onPress={() => setCompOpen((v) => !v)} style={styles.selectHeader}>
                <Ionicons name="flag-outline" size={18} color="#0b3d24" />
                <Text style={styles.selectHeaderText}>
                  {defaultCompetitionIds.length
                    ? `${defaultCompetitionIds.length} selected`
                    : "Select competitions"}
                </Text>
                <Ionicons
                  name={compOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color="#111827"
                />
              </Pressable>

              {compOpen && (
                <View style={styles.dropdown}>
                  <View style={styles.searchRow}>
                    <Ionicons name="search" size={16} color="#6b7280" style={{ marginRight: 6 }} />
                    <TextInput
                      placeholder="Search by competition or country"
                      value={compQuery}
                      onChangeText={setCompQuery}
                      style={styles.searchInput}
                      autoCorrect={false}
                      autoCapitalize="none"
                    />
                    {compQuery.length > 0 && (
                      <Pressable onPress={() => setCompQuery("")}>
                        <Ionicons name="close-circle" size={18} color="#9ca3af" />
                      </Pressable>
                    )}
                  </View>

                  <View style={{ maxHeight: 320 }}>
                    <ScrollView>
                      {compsOrderedForDropdown.map((c) => {
                        const id = String(c.competition_id);
                        const selected = defaultCompetitionIds.includes(id);
                        return (
                          <CompetitionRow
                            key={id}
                            comp={c}
                            selected={selected}
                            onToggle={toggleCompetition}
                          />
                        );
                      })}
                      {compsOrderedForDropdown.length === 0 && (
                        <Text style={styles.muted}>No matches.</Text>
                      )}
                    </ScrollView>
                  </View>
                </View>
              )}
            </View>

            {/* SEASONS */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Seasons</Text>

              <View style={styles.rowWrap}>
                <Chip
                  onPress={() => setDefaultSeasons(allSeasons.slice(0, 3))}
                  selected={isLast3Seasons}
                >
                  Last 3
                </Chip>
                <Chip
                  onPress={() => setDefaultSeasons(allSeasons.slice(0, 5))}
                  selected={isLast5Seasons}
                >
                  Last 5
                </Chip>
                <Chip onPress={() => setDefaultSeasons(allSeasons)} selected={isAllSeasons}>
                  Select All
                </Chip>
                <Chip
                  onPress={() => setDefaultSeasons([])}
                  variant="outline"
                  selected={isClearSeasons}
                >
                  Clear All
                </Chip>
              </View>

              <Pressable onPress={() => setSeasonsOpen((v) => !v)} style={styles.selectHeader}>
                <Ionicons name="calendar-outline" size={18} color="#0b3d24" />
                <Text style={styles.selectHeaderText}>
                  {defaultSeasons.length ? `${defaultSeasons.length} selected` : "Select seasons"}
                </Text>
                <Ionicons
                  name={seasonsOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color="#111827"
                />
              </Pressable>

              {seasonsOpen && (
                <View style={styles.dropdown}>
                  <View style={styles.searchRow}>
                    <Ionicons name="search" size={16} color="#6b7280" style={{ marginRight: 6 }} />
                    <TextInput
                      placeholder="Search season (e.g., 2021)"
                      value={seasonQuery}
                      onChangeText={setSeasonQuery}
                      style={styles.searchInput}
                      autoCorrect={false}
                      autoCapitalize="none"
                    />
                    {seasonQuery.length > 0 && (
                      <Pressable onPress={() => setSeasonQuery("")}>
                        <Ionicons name="close-circle" size={18} color="#9ca3af" />
                      </Pressable>
                    )}
                  </View>

                  <View style={{ maxHeight: 280 }}>
                    <ScrollView>
                      {seasonsOrderedForDropdown.map((s) => {
                        const selected = defaultSeasons.includes(s);
                        return (
                          <Pressable key={s} style={styles.optionRow} onPress={() => toggleSeason(s)}>
                            <Text style={{ color: "#111827" }}>{s}</Text>
                            <Ionicons
                              name={selected ? "checkbox" : "square-outline"}
                              size={18}
                              color={selected ? "#14532d" : "#9ca3af"}
                            />
                          </Pressable>
                        );
                      })}
                      {seasonsOrderedForDropdown.length === 0 && (
                        <Text style={styles.muted}>No seasons.</Text>
                      )}
                    </ScrollView>
                  </View>
                </View>
              )}
            </View>

            {/* MINIMUM MARKET VALUE */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Minimum Market Value (€)</Text>
              <TextInput
                keyboardType="number-pad"
                value={String(minMarketValue ?? 0)}
                onChangeText={(t) => setMinMarketValue(parseInt(t || "0", 10) || 0)}
                style={[styles.input, { marginBottom: 6 }]}
              />
              <View style={styles.rowWrap}>
                {[0, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000].map(
                  (v) => (
                    <Chip
                      key={v}
                      selected={Number(minMarketValue) === v}
                      onPress={() => setMinMarketValue(v)}
                    >
                      {compactMoney(v)}
                    </Chip>
                  )
                )}
              </View>
            </View>

            {/* ✅ MINIMUM APPEARANCES */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Minimum Appearances</Text>
              <TextInput
                keyboardType="number-pad"
                value={String(minAppearances ?? 0)}
                onChangeText={(t) => setMinAppearances(parseInt(t || "0", 10) || 0)}
                style={[styles.input, { marginBottom: 6 }]}
              />
              <View style={styles.rowWrap}>
                {[0, 5, 10, 15, 20, 25, 30, 50, 100].map((v) => (
                  <Chip
                    key={v}
                    selected={Number(minAppearances) === v}
                    onPress={() => setMinAppearances(v)}
                  >
                    {v}
                  </Chip>
                ))}
              </View>
            </View>

            {/* Pool counts */}
            <View style={styles.poolCard}>
              <Text style={styles.poolLabel}>Player Pool:</Text>
              {loadingCounts ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text style={styles.poolValue}>
                  {poolCount} / {totalCount}
                </Text>
              )}
            </View>
            {!!countsError && (
              <Text style={{ color: "#b91c1c", marginTop: -8, marginBottom: 8, fontSize: 12 }}>
                {countsError}
              </Text>
            )}

            <Text style={[styles.p, { fontSize: 12, marginTop: 6 }]}>
              Finishing will save these defaults and complete onboarding.
            </Text>
          </ScrollView>
        </SlideContainer>
      </ScrollView>

      <Footer />
    </SafeAreaView>
  );
}

/* ------------------------------- Small utils ------------------------------ */
function compactMoney(n) {
  const num = Number(n || 0);
  if (num >= 1_000_000_000) return `${Math.round(num / 1_000_000_000)}B`;
  if (num >= 1_000_000) return `${Math.round(num / 1_000_000)}M`;
  if (num >= 1_000) return `${Math.round(num / 1_000)}K`;
  return `${num}`;
}

function Chip({ children, onPress, selected = false, variant = "solid", style }) {
  const solid = variant === "solid";
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        selected
          ? { backgroundColor: "#14532d", borderColor: "#14532d" }
          : solid
          ? { backgroundColor: "#fff", borderColor: "#d1d5db" }
          : { backgroundColor: "transparent", borderColor: "#d1d5db" },
        style,
      ]}
    >
      <Text style={{ color: selected ? "#fff" : "#111827", fontSize: 12, fontWeight: "700" }}>
        {children}
      </Text>
    </Pressable>
  );
}

function CompetitionRow({ comp, selected, onToggle }) {
  return (
    <Pressable onPress={() => onToggle(String(comp.competition_id))} style={styles.compRow}>
      {comp.flag_url ? (
        <Image source={{ uri: comp.flag_url }} style={styles.flag} />
      ) : (
        <View style={[styles.flag, { backgroundColor: "#e5e7eb" }]} />
      )}
      {comp.logo_url ? (
        <Image source={{ uri: comp.logo_url }} style={styles.logo} />
      ) : (
        <View style={[styles.logo, { backgroundColor: "#eef2f7" }]} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "700", color: "#0b3d24" }} numberOfLines={1}>
          {comp.competition_name}
        </Text>
        <Text style={{ fontSize: 12, color: "#6b7280" }} numberOfLines={1}>
          {comp.country}
        </Text>
      </View>
      <Ionicons
        name={selected ? "checkbox" : "square-outline"}
        size={20}
        color={selected ? "#14532d" : "#9ca3af"}
      />
    </Pressable>
  );
}

function NotifRow({ title, value, onValueChange }) {
  return (
    <View style={styles.notifRow}>
      <Text style={styles.notifLabel}>{title}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

/* --------------------------------- Styles -------------------------------- */
const styles = StyleSheet.create({
  h1: { fontSize: 20, fontWeight: "800", color: "#064E3B", marginBottom: 8 },
  p: { fontSize: 14, color: "#065f46", lineHeight: 20 },
  li: { fontSize: 13, color: "#065f46", marginBottom: 4 },

  input: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#D1FAE5",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    fontSize: 16,
  },

  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  muted: { color: "#6b7280", marginTop: 8 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0b3d24",
    marginBottom: 8,
  },

  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },

  selectHeader: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
  },
  selectHeaderText: {
    flex: 1,
    color: "#111827",
    fontWeight: "700",
  },

  dropdown: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    backgroundColor: "#fff",
    padding: 8,
  },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
    backgroundColor: "#fafafa",
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
    paddingVertical: 4,
  },

  compRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
  },
  flag: { width: 18, height: 12, borderRadius: 2, backgroundColor: "#eee" },
  logo: { width: 18, height: 18, borderRadius: 3, backgroundColor: "#eee" },

  poolCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fef9c3",
    borderColor: "#fde68a",
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  poolLabel: { fontSize: 14, color: "#92400e", fontWeight: "700" },
  poolValue: { fontSize: 14, color: "#92400e", fontWeight: "800" },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
  },

  // Notifications styles (to match Profile look)
  notifRow: {
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  notifLabel: { fontSize: 14, color: "#111827" },
  divider: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 8,
  },
  hintText: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280",
  },
});
