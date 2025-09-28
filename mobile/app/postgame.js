// mobile/app/postgame.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Pressable,
  Platform,
  Share as RNShare,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { getRandomPlayer } from '../lib/api';
import Logo from '../assets/images/footytrail_logo.png';
/* icons */
import { MaterialCommunityIcons } from '@expo/vector-icons';

/* === Share whole card as image === */
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

/**
 * Postgame (Mobile)
 * Params expected via useLocalSearchParams:
 * - didWin: '1'|'0'
 * - isDaily: '1'|'0'
 * - elimination: stringified JSON or null
 * - player: stringified JSON { id,name,photo/nationality/position/age,... }
 * - stats: stringified JSON { pointsEarned,timeSec,guessesUsed,guessHistory,usedHints }
 * - outroLine: string
 * - aiFact: string   // (optional) generated in live-game and passed here
 * - filters: stringified JSON of the pool filters used for this round
 * - potentialPoints: string (pool size-based potential points used this round)
 */

export default function PostgameMobile() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // ---------- Parse inbound params ----------
  const didWin = String(params?.didWin ?? '0') === '1';
  const isDaily = String(params?.isDaily ?? '0') === '1';

  const elimination = useMemo(() => {
    try { return params?.elimination ? JSON.parse(String(params.elimination)) : null; }
    catch { return null; }
  }, [params?.elimination]);

  const player = useMemo(() => {
    try { return params?.player ? JSON.parse(String(params.player)) : null; }
    catch { return null; }
  }, [params?.player]);

  const stats = useMemo(() => {
    try { return params?.stats ? JSON.parse(String(params.stats)) : null; }
    catch { return null; }
  }, [params?.stats]);

  const filters = useMemo(() => {
    try { return params?.filters ? JSON.parse(String(params.filters)) : null; }
    catch { return null; }
  }, [params?.filters]);

  const prevPotentialPoints = Number(params?.potentialPoints ?? 0);

  const outroLine = params?.outroLine ? String(params.outroLine) : '';
  const aiFact = params?.aiFact ? String(params.aiFact) : '';

  const headerTitle = elimination ? 'Elimination' : (isDaily ? 'Daily Challenge' : 'Regular Game');

  // ---------- Avatar (same behavior as in tabs layout) ----------
  const [avatarUrl, setAvatarUrl] = useState(null);
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
  }, []); // mirrors tabs header behavior

  // ---------- Derived display ----------
  const guessesUsed = useMemo(() => {
    if (!stats) return 0;
    if (Array.isArray(stats.guessHistory)) return Math.max(0, stats.guessHistory.length);
    const n = Number(stats.guessesUsed);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, [stats]);

  const hintsUsed = useMemo(() => {
    if (!stats?.usedHints) return 0;
    try { return Object.values(stats.usedHints).filter(Boolean).length; }
    catch { return 0; }
  }, [stats?.usedHints]);

  const displayAge = getDisplayedAge(player);
  const playerPhoto = player?.player_photo || player?.photo || null;

  // ---------- Daily countdown (UTC) ----------
  const [countdown, setCountdown] = useState(formatHMS(msUntilNextUtcMidnight()));
  useEffect(() => {
    const id = setInterval(() => setCountdown(formatHMS(msUntilNextUtcMidnight())), 1000);
    return () => clearInterval(id);
  }, []);

  // ---------- Games left today (UTC), excluding elimination & daily ----------
  const [gamesLeft, setGamesLeft] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData?.user?.id;
        if (!userId) return;

        const { start, end } = dayRangeUtc(new Date());

        const { data: regularData, error: regularErr } = await supabase
          .from('games_records')
          .select('id')
          .eq('user_id', userId)
          .eq('is_daily_challenge', false)
          .eq('is_elimination_game', false)
          .gte('created_at', start)
          .lt('created_at', end);

        if (regularErr) throw regularErr;
        const played = regularData?.length || 0;

        const { data: dailyRows, error: dailyErr } = await supabase
          .from("games_records")
          .select("won")
          .eq("user_id", userId)
          .eq("is_daily_challenge", true)
          .gte("created_at", start)
          .lt("created_at", end)
          .limit(1);

        if (dailyErr) throw dailyErr;
        const hasDailyWin = dailyRows?.[0]?.won === true;

        const dailyAdjustedCap = hasDailyWin ? 11 : 10;
        setGamesLeft(Math.max(0, dailyAdjustedCap - played));
      } catch {
        setGamesLeft(null);
      }
    })();
  }, []);

  // After finishing a game, check if we hit a 7x streak and show a one-time modal
  useEffect(() => {
    (async () => {
      try {
        // Only for daily or regular (ignore elimination screens)
        if (elimination) return;

        const { data: authData } = await supabase.auth.getUser();
        const userId = authData?.user?.id;
        if (!userId) return;

        // Build day map
        const rows = await fetchRecentNonElimRows(userId);
        const dayMap = buildDayMap(rows);

        const kind = isDaily ? "daily" : "regular";
        const value = isDaily ? computeDailyStreak(dayMap) : computeRegularStreak(dayMap);

        if (value > 0 && value % 7 === 0 && !didShowStreakRef.current) {
  didShowStreakRef.current = true;
  setStreakModal({ visible: true, kind, value });
}

      } catch {
        // ignore failures – never block postgame
      }
    })();
  }, [elimination, isDaily]);

  // ---------- Share (capture the card as image) ----------
  const shareText = useMemo(() => {
    const outcome = didWin ? 'succeeded phenomenally' : 'failed miserably';
    const name = player?.name ? ` — ${player.name}` : '';
    return `Look at the player I just ${outcome} to identify on FootyTrail${name}!\nCome join the fun at https://footy-trail.vercel.app`;
  }, [didWin, player?.name]);

  const cardShotRef = useRef(null);
  const [shareBusy, setShareBusy] = useState(false);
  const didShowStreakRef = useRef(false);

  // Streak modal state
  const [streakModal, setStreakModal] = useState({
    visible: false,
    kind: "daily", // "daily" | "regular"
    value: 0,
  });

  const onShare = async () => {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      const uri = await cardShotRef.current?.capture?.({
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });

      if (uri) {
        try {
          await RNShare.share({
            title: 'Share your FootyTrail game',
            message: shareText,
            url: uri,
          });
        } catch (e) {
          const canNativeShare = await Sharing.isAvailableAsync();
          if (canNativeShare) {
            await Sharing.shareAsync(uri, {
              mimeType: 'image/png',
              dialogTitle: 'Share your FootyTrail game',
              UTI: 'public.png',
            });
          } else {
            await RNShare.share({ message: shareText });
          }
        }
        try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { }
      } else {
        await RNShare.share({ message: shareText });
      }
    } catch {
      try { await RNShare.share({ message: shareText }); } catch { }
    } finally {
      setShareBusy(false);
    }
  };

  // ---------- Banner ----------
  const bannerText = useMemo(() => {
    if (elimination) {
      const pts = Number(stats?.pointsEarned ?? 0);
      const lines = [
        `Let's see if ${pts} point${pts === 1 ? '' : 's'} keeps you alive...`,
        `Will ${pts} be your golden ticket to the next round — or your doom?`,
        `Time to learn if ${pts} points means glory… or elimination.`,
      ];
      return lines[pts % lines.length];
    }
    if (outroLine) return outroLine;
    if (didWin) return 'Great job! You guessed it!';
    return player?.name ? `Not quite! The player was ${player.name}` : 'Round over!';
  }, [didWin, elimination, outroLine, player?.name, stats?.pointsEarned]);

  // ---------- Play Again (non-daily, non-elimination) ----------
  const [playAgainBusy, setPlayAgainBusy] = useState(false);

  // ✅ FIX: disable the button when gamesLeft is 0
  const canPlayAgain = useMemo(() => {
    if (isDaily || elimination || !filters) return false;
    if (!Number.isFinite(prevPotentialPoints) || prevPotentialPoints <= 5) return false;
    // If we know the exact count and it's 0, block playing again.
    if (gamesLeft !== null && gamesLeft <= 0) return false;
    return true;
  }, [isDaily, elimination, filters, prevPotentialPoints, gamesLeft]);

  const onPlayAgain = async () => {
    // Hard guard in the handler as well to prevent any accidental starts.
    if (playAgainBusy || !canPlayAgain || (gamesLeft !== null && gamesLeft <= 0)) return;

    setPlayAgainBusy(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id || null;

      const originalFilters = (filters && typeof filters === 'object') ? filters : {};
      const nextPotential = Number.isFinite(prevPotentialPoints) ? (prevPotentialPoints - 5) : undefined;

      const nextCard = await getRandomPlayer(originalFilters, userId);

      router.replace({
        pathname: '/live-game',
        params: {
          payload: JSON.stringify({
            ...nextCard,
            isDaily: false,
            filters: originalFilters,
            ...(nextPotential !== undefined ? { potentialPoints: nextPotential } : {}),
            fromPostGame: true,
          }),
        },
      });
    } catch (e) {
      console.error('Play Again error:', e);
      setPlayAgainBusy(false);
    }
  };

  // ---------- UI ----------
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F0FDF4' }} contentContainerStyle={{ paddingBottom: 24 }}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.headerSide}>
            <Pressable onPress={() => router.replace('/(tabs)/game')} hitSlop={8}>
              <Image source={Logo} style={styles.headerLogo} />
            </Pressable>
          </View>

          <Text style={styles.headerTitle}>{headerTitle}</Text>
          <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>
            <Pressable hitSlop={8}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.headerAvatar} />
              ) : (
                <View style={[styles.headerAvatar, { backgroundColor: '#d1d5db' }]} />
              )}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      {/* Card (wrapped with ViewShot so we can share image of the card) */}
      {/* NOTE: Buttons row is OUTSIDE ViewShot so it won't be captured */}
      <View style={{ marginHorizontal: 16, marginTop: 8 }}>
        <ViewShot ref={cardShotRef} options={{ format: 'png', quality: 1, result: 'tmpfile' }}>
          <View style={styles.container}>
            {/* Top banner */}
            <View style={[styles.banner, didWin ? styles.bannerWin : styles.bannerLose]}>
              <Text style={[styles.bannerText, didWin ? styles.bannerTextWin : styles.bannerTextLose]}>
                {bannerText}
              </Text>
            </View>

            {/* Player section */}
            <View style={styles.playerRow}>
              {playerPhoto ? (
                <Image source={{ uri: playerPhoto }} style={styles.playerPhoto} />
              ) : (
                <View style={[styles.playerPhoto, styles.photoFallback]}>
                  <Text style={{ color: '#9ca3af', fontSize: 28 }}>👤</Text>
                </View>
              )}

              <View style={{ flex: 1 }}>
                <Text style={styles.playerName}>{player?.name || 'Unknown Player'}</Text>
                <Text style={styles.playerMeta}>Age: {displayAge}</Text>
                <Text style={styles.playerMeta}>Nationality: {player?.nationality || '—'}</Text>
                <Text style={styles.playerMeta}>Position: {player?.position || '—'}</Text>
              </View>
            </View>

            {/* Did you know? */}
            {!!aiFact && (
              <View style={styles.factBox}>
                <Text style={styles.factText}>{aiFact}</Text>
                <Text style={styles.factFootnote}>And now you'll have to google that to see if I made it all up...</Text>
              </View>
            )}

            {/* Stats */}
            <View style={styles.statsGrid}>
              <Stat label="Points Earned" value={String(stats?.pointsEarned ?? '—')} />
              <Stat label="Time Taken" value={`${String(stats?.timeSec ?? '—')}s`} />
              <Stat label="Guesses Used" value={String(guessesUsed)} />
              <Stat label="Hints Used" value={String(hintsUsed)} />
            </View>

            {/* Daily body (texts only; actions live outside for sharing) */}
            {isDaily && (
              <View style={styles.dailyWrap}>
                <Text style={styles.dailyTitle}>
                  {didWin
                    ? `Congratulations! You won today's daily challenge and earned ${Number(stats?.pointsEarned ?? 0)} points!`
                    : 'Better luck next time! Try the daily challenge again tomorrow for another chance at 10,000 points.'}
                </Text>
                <Text style={styles.dailyCountdown}>
                  Next daily challenge in <Text style={styles.dailyCountdownStrong}>{countdown}</Text>
                </Text>
              </View>
            )}
          </View>
        </ViewShot>

        {/* Actions (outside ViewShot so they are NOT included in the share) */}
        {isDaily ? (
          <View style={styles.rowActions}>
            <TouchableOpacity onPress={onShare} activeOpacity={0.85} style={styles.btnIconShare} disabled={shareBusy}>
              {shareBusy ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="share-variant" size={22} color="#fff" />}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.replace('/(tabs)/game')}
              activeOpacity={0.85}
              style={[styles.btn, styles.btnPrimary]}
            >
              <Text style={[styles.btnTxt]}>Back to Game</Text>
            </TouchableOpacity>
          </View>
        ) : elimination ? (
          <View style={styles.rowActions}>
            <TouchableOpacity onPress={onShare} activeOpacity={0.85} style={styles.btnIconShare} disabled={shareBusy}>
              {shareBusy ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="share-variant" size={22} color="#fff" />}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.replace('/(tabs)/elimination')}
              activeOpacity={0.85}
              style={[styles.btn, styles.btnPrimary]}
            >
              <Text style={styles.btnTxt}>Back to Elimination</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.rowActions}>
            <TouchableOpacity
              onPress={() => router.replace('/(tabs)/game')}
              activeOpacity={0.85}
              style={[styles.iconBtn]}
            >
              <Text style={styles.iconBtnTxt}>←</Text>
            </TouchableOpacity>

            {/* Play Again with remaining games label; disabled at 0 left */}
            <TouchableOpacity
              onPress={onPlayAgain}
              activeOpacity={0.85}
              disabled={!canPlayAgain || playAgainBusy}
              style={[
                styles.btn,
                styles.btnPrimary,
                (!canPlayAgain || playAgainBusy) && { opacity: 0.6 },
              ]}
            >
              {playAgainBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnTxt}>
                  {gamesLeft === 0
                    ? 'Finished for today'
                    : `Play Again${gamesLeft !== null ? ` (${gamesLeft} left)` : ''}`}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={onShare} activeOpacity={0.85} style={styles.btnIconShare} disabled={shareBusy}>
              {shareBusy ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="share-variant" size={22} color="#fff" />}
            </TouchableOpacity>
          </View>
        )}
      </View>
      <Modal transparent visible={streakModal.visible} animationType="fade" onRequestClose={() => setStreakModal(s => ({ ...s, visible: false }))}>
  <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
    <View style={{ width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 20, paddingVertical: 24, paddingHorizontal: 20, alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb' }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 6, textAlign: 'center' }}>
  {`${streakModal.value}-Day ${streakModal.kind === 'daily' ? 'Daily Challenge' : 'Daily Progress'} Streak!`}
</Text>


      {/* flame + number */}
      <View style={{ width: 88, height: 88, alignItems: "center", justifyContent: "center", marginVertical: 8 }}>
  <MaterialCommunityIcons name="fire" size={88} color="#f97316" />
  <Text
    style={{
      position: "absolute",
      top: "54%",                             // sit a touch below center
      transform: [{ translateY: 2 }],         // nudge down ~2px
      fontSize: 34,
      fontWeight: "900",
      color: "#111827",                       // black
      fontFamily: "Tektur_700Bold",
      textShadowColor: "#ffffff",             // white “border”
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 5,
    }}
  >
    {streakModal.value}
  </Text>
</View>


      <Text style={{ fontSize: 18, fontWeight: '800', color: '#111827', marginTop: 4 }}>
        {streakModal.kind === 'daily' ? 'Day Streak' : 'Daily Progress Streak'}
      </Text>

      <View style={{ width: '100%', height: 8, borderRadius: 999, backgroundColor: '#fed7aa', marginTop: 14, overflow: 'hidden' }}>
        <View style={{ width: '100%', height: '100%', backgroundColor: '#fb923c' }} />
      </View>

      <Text style={{ textAlign: 'center', fontSize: 14, color: '#4b5563', marginTop: 14, paddingHorizontal: 8 }}>
  {streakModal.kind === 'daily'
    ? `You've played the Daily Challenge ${streakModal.value} days in a row.`
    : `You've completed all your regular games ${streakModal.value} days in a row.`}
</Text>


      <TouchableOpacity
        onPress={() => setStreakModal(s => ({ ...s, visible: false }))}
        activeOpacity={0.9}
        style={{ width: '100%', marginTop: 18, backgroundColor: '#f97316', borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
      >
<Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>Nice job!</Text>
      </TouchableOpacity>
    </View>
  </View>
</Modal>

    </ScrollView>
  );
}

// ---- Streak helpers (UTC) ----
function getUtcDayKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function fetchRecentNonElimRows(userId, daysBack = 60) {
  // fetch recent non-elimination rows for the user
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack));
  const { data, error } = await supabase
    .from("games_records")
    .select("created_at, is_daily_challenge, won, is_elimination_game")
    .eq("user_id", userId)
    .eq("is_elimination_game", false)
    .gte("created_at", start.toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function buildDayMap(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const dt = new Date(r.created_at);
    const key = getUtcDayKey(dt);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return map;
}

// Daily streak: include today only if a daily was played today; otherwise start at yesterday
function computeDailyStreak(dayMap) {
  const hasDaily = (key) => (dayMap.get(key) || []).some((r) => r.is_daily_challenge === true);

  let cursor = new Date();
  if (!hasDaily(getUtcDayKey(cursor))) {
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - 1));
  }

  let streak = 0;
  while (true) {
    const key = getUtcDayKey(cursor);
    if (!hasDaily(key)) break;
    streak += 1;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - 1));
  }
  return streak;
}

// Regular streak: include today only if ALL regulars completed today
// (10 if daily not won that day, 11 if daily WAS won that day)
function computeRegularStreak(dayMap) {
  const qualifies = (key) => {
    const rows = dayMap.get(key) || [];
    const dailyWon = rows.some((r) => r.is_daily_challenge === true && r.won === true);
    const required = dailyWon ? 11 : 10;
    const regularCount = rows.filter((r) => r.is_daily_challenge !== true).length;
    return regularCount >= required;
  };

  let cursor = new Date();
  if (!qualifies(getUtcDayKey(cursor))) {
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - 1));
  }

  let streak = 0;
  while (true) {
    const key = getUtcDayKey(cursor);
    if (!qualifies(key)) break;
    streak += 1;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - 1));
  }
  return streak;
}


/* =========================
   Helpers
   ========================= */

function formatHMS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function msUntilNextUtcMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return next.getTime() - now.getTime();
}

/* UTC day range for games-left calc */
function dayRangeUtc(dateLike) {
  const d = new Date(dateLike);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function getDisplayedAge(p) {
  if (!p) return '—';
  const dobAgeStr =
    p.player_dob_age || p.dob_age || p.player_dob || p.dob || '';

  const birthDate = parseBirthDate(dobAgeStr);
  const computed = birthDate ? computeAgeFromDate(birthDate) : null;
  const fallback = p.age ?? p.player_age ?? '—';
  return computed != null ? String(computed) : String(fallback);
}

// Accepts "30.04.1992 (29)", "dd/mm/yyyy", "dd-mm-yyyy", "yyyy-mm-dd"
function parseBirthDate(str) {
  if (!str) return null;
  const s = String(str);

  let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    if (validYMD(y, mo, d)) return new Date(Date.UTC(y, mo - 1, d));
  }

  m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    if (validYMD(y, mo, d)) return new Date(Date.UTC(y, mo - 1, d));
  }

  m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    if (validYMD(y, mo, d)) return new Date(Date.UTC(y, mo - 1, d));
  }

  return null;
}

function validYMD(y, m, d) {
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  return true;
}

function computeAgeFromDate(birthDate) {
  if (!(birthDate instanceof Date)) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const mo = now.getUTCMonth() - birthDate.getUTCMonth();
  if (mo < 0 || (mo === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age--;
  }
  return Math.max(0, age);
}

/* =========================
   Small UI subcomponents
   ========================= */

function Stat({ label, value }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

/* =========================
   Styles
   ========================= */

const styles = StyleSheet.create({
  safeArea: { backgroundColor: 'white' },
  header: {
    height: 56,
    backgroundColor: 'white',
    borderBottomWidth: Platform.OS === 'ios' ? 0.5 : 0.7,
    borderBottomColor: '#F0FDF4',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  headerSide: { width: 56, alignItems: 'flex-start', justifyContent: 'center' },
  headerLogo: { width: 40, height: 40, borderRadius: 6, resizeMode: 'contain' },
  headerAvatar: { width: 32, height: 32, borderRadius: 16 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: '#111827' },

  container: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    borderColor: '#eef1f6',
    borderWidth: 2,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },

  banner: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1 },
  bannerWin: { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' },
  bannerLose: { backgroundColor: '#fee2e2', borderColor: '#fecaca' },
  bannerText: { textAlign: 'center', fontSize: 16, fontWeight: '800' },
  bannerTextWin: { color: '#166534' },
  bannerTextLose: { color: '#991b1b' },

  playerRow: { flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'center' },
  playerPhoto: { width: 96, height: 96, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', objectFit: 'cover' },
  photoFallback: { backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  playerName: { fontSize: 20, fontWeight: '800', marginBottom: 4, color: '#111827' },
  playerMeta: { fontSize: 14, color: '#4b5563' },

  factBox: { backgroundColor: '#eff6ff', borderRadius: 12, padding: 12, marginBottom: 12 },
  factText: { fontStyle: 'italic', color: '#111827' },
  factFootnote: { marginTop: 4, fontSize: 11, color: '#6b7280' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  statCard: { flexBasis: '48%', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  statLabel: { color: '#6b7280', fontSize: 12, marginBottom: 4 },
  statValue: { color: '#111827', fontSize: 18, fontWeight: '700' },

  rowActions: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' },
  iconBtnTxt: { fontSize: 18, fontWeight: '800', color: '#374151' },

  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#16a34a' },
  btnShare: { backgroundColor: '#4f46e5' }, // legacy (unused for icon-only)
  btnSecondary: { backgroundColor: '#eef2f7' },
  btnTxt: { color: 'white', fontWeight: '700', fontSize: 16 },
  btnTxtDark: { color: '#111827' },

  // compact icon-only Share button
  btnIconShare: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4f46e5' },

  dailyWrap: { alignItems: 'center', marginTop: 4 },
  dailyTitle: { fontSize: 18, fontWeight: '800', color: '#713f12', marginBottom: 4, textAlign: 'center' },
  dailyText: { fontSize: 15, color: '#374151', textAlign: 'center' },
  dailyCountdown: { marginTop: 6, fontSize: 13, color: '#6b7280' },
  dailyCountdownStrong: { fontWeight: '700', color: '#111827' },
});
