// mobile/app/live-game.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  AppState,
  KeyboardAvoidingView,
  Keyboard,
  Vibration,
  Dimensions,
  Animated, // ← for shake & emoji rain
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ConfettiCannon from 'react-native-confetti-cannon';
import { useFonts, Tektur_400Regular, Tektur_700Bold } from '@expo-google-fonts/tektur';
import { supabase } from '../lib/supabase';
import { saveGameCompleted, getCounts, API_BASE } from '../lib/api';
import Logo from '../assets/images/footytrail_logo.png';

const INITIAL_TIME = 120; // 2 minutes
const AI_FACT_TIMEOUT_MS = 9000;
const MAX_DOTS = 9; // (no longer used for lists, kept to avoid style churn)

function fetchWithTimeout(url, options = {}, ms = AI_FACT_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

const normalize = (str) =>
  (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const multipliers = {
  age: 0.9,
  nationality: 0.9,
  position: 0.8,
  partialImage: 0.5,
  firstLetter: 0.25,
};

async function fetchTransfersLocal(playerId) {
  try {
    const res = await fetch(`${API_BASE}/transfers/${encodeURIComponent(playerId)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return json?.transfers || [];
  } catch {
    return [];
  }
}

export default function LiveGameMobile() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();

  // Load Tektur fonts
  const [fontsLoaded] = useFonts({ Tektur_400Regular, Tektur_700Bold });

  // Accept either individual params or a single JSON `payload` param.
  const parsed = (() => {
    if (params?.payload) {
      try { return JSON.parse(String(params.payload)); } catch { /* ignore */ }
    }
    return {
      id: toNum(params?.id),
      name: safeStr(params?.name),
      age: toNum(params?.age),
      nationality: safeStr(params?.nationality),
      position: safeStr(params?.position),
      photo: safeStr(params?.photo),
      funFact: safeStr(params?.funFact),
      potentialPoints: toNum(params?.potentialPoints, 0),
      isDaily: String(params?.isDaily ?? '0') === '1',
      filters: parseJson(params?.filters) || { potentialPoints: 0 },
      elimination: parseJson(params?.elimination) || null,
    };
  })();

  const gameData = {
    id: parsed.id,
    name: parsed.name,
    age: parsed.age,
    nationality: parsed.nationality,
    position: parsed.position,
    photo: parsed.photo,
    funFact: parsed.funFact,
    potentialPoints: parsed.potentialPoints,
  };

  const isDaily = !!parsed.isDaily;
  const filters = parsed.filters || { potentialPoints: 0 };
  const elimination = parsed.elimination;

  const headerTitle = elimination ? 'Elimination' : (isDaily ? 'Daily Challenge' : 'Regular Daily');

  // -------------------------
  // State
  // -------------------------
  const [guessesLeft, setGuessesLeft] = useState(3);
  const [guess, setGuess] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  const [usedHints, setUsedHints] = useState({
    age: false,
    nationality: false,
    position: false,
    partialImage: false,
    firstLetter: false,
  });

  const [displayName, setDisplayName] = useState('Player');
  // Avatar (same as postgame)
  const [avatarUrl, setAvatarUrl] = useState(null);

  const [timeSec, setTimeSec] = useState(INITIAL_TIME);
  const timerRef = useRef(null);
  const endedRef = useRef(false);

  const [transferHistory, setTransferHistory] = useState([]);
  const [loadingTransfers, setLoadingTransfers] = useState(true);

  const [computedPotential, setComputedPotential] = useState(null);

  // AI fact
  const [aiFact, setAiFact] = useState('');
  const aiFactRef = useRef('');

  const [showConfetti, setShowConfetti] = useState(false);

  // NEW: finishing lock to keep dropdown closed & show animations until navigation
  const [isFinishing, setIsFinishing] = useState(false);

  // Effects
  const [showEmojiRain, setShowEmojiRain] = useState(false);
  const shakeX = useRef(new Animated.Value(0)).current;

  // Sticky thresholds
  const [showStickyTimer, setShowStickyTimer] = useState(false);
  const [showStickyInput, setShowStickyInput] = useState(false);
  const timerYRef = useRef(0);
  const inputYRef = useRef(0);

  // Header + sticky math
  const headerHeight = 56;
  const stickyTop = insets.top + headerHeight; // overlays anchor here
  const stickyOffset = headerHeight + 8;

  // Scroll ref (to scroll to top before FX)
  const scrollRef = useRef(null);

  // -------------------------
  // Bootstrapping (no timer here anymore)
  // -------------------------
  useEffect(() => {
    if (!gameData?.id || !gameData?.name) {
      Alert.alert('Missing data', 'No game payload found. Returning to Game.');
      router.replace('/(tabs)/game');
      return;
    }

    // Transfers
    (async () => {
      try {
        const th = await fetchTransfersLocal(gameData.id);
        setTransferHistory(Array.isArray(th) ? th : []);
        // Generate AI 'Did you know?' fact early
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const resp = await fetchWithTimeout(`${API_BASE}/ai/generate-player-fact`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({
              player: {
                id: gameData.id,
                name: gameData.name,
                nationality: gameData.nationality,
                position: gameData.position,
                age: gameData.age,
              },
              transferHistory: Array.isArray(th) ? th : [],
            }),
          }, AI_FACT_TIMEOUT_MS);
          const j = await resp.json().catch(() => ({}));
          const fact = String(j?.fact || j?.aiGeneratedFact || '').trim();
          if (fact) { aiFactRef.current = fact; setAiFact(fact); }
        } catch {}
      } catch {
        setTransferHistory([]);
      } finally {
        setLoadingTransfers(false);
      }
    })();

    // Display name
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const uid = user?.id;
        const email = user?.email || '';
        if (uid) {
          const { data } = await supabase.from('users').select('full_name').eq('id', uid).maybeSingle();
          const dbName = (data?.full_name || '').trim();
          if (dbName) return setDisplayName(dbName);
        }
        setDisplayName(email.split('@')[0] || 'Player');
      } catch {
        setDisplayName('Player');
      }
    })();

    // Anti-cheat
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') loseNow();
    });

    return () => {
      clearInterval(timerRef.current);
      sub?.remove();
    };
  }, [gameData?.id, gameData?.name]);

  // Start countdown ONLY after transfers are fully loaded
  useEffect(() => {
    clearInterval(timerRef.current);
    if (loadingTransfers || endedRef.current) return;
    timerRef.current = setInterval(() => {
      setTimeSec((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          if (!endedRef.current) {
            endedRef.current = true;
            setIsFinishing(true);
            setSuggestions([]);
            Keyboard.dismiss();
            // Scroll to top BEFORE rain
            try { scrollRef.current?.scrollTo({ y: 0, animated: true }); } catch {}
            setTimeout(() => setShowEmojiRain(true), 180);
            setTimeout(async () => {
              await saveGameRecord(false);
              await writeElimEntryAndAdvance(false, 0);
              const outroLine = await generateOutro(false, 0, 3, INITIAL_TIME);
              goPostgame({
                didWin: false,
                pointsEarned: 0,
                elapsed: INITIAL_TIME,
                guessesUsed: 3,
                outroLine,
              });
            }, 1200);
          }
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [loadingTransfers]);

  // Avatar (load from users.profile_photo_url)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData?.user?.id;
        if (!userId) return;
        const { data } = await supabase
          .from('users')
          .select('profile_photo_url')
          .eq('id', userId)
          .maybeSingle();
        if (mounted && data?.profile_photo_url) setAvatarUrl(data.profile_photo_url);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  // -------------------------
  // Potential points
  // -------------------------
  useEffect(() => {
    (async () => {
      const provided = Number(gameData?.potentialPoints || 0);
      if (provided > 0) { setComputedPotential(provided); return; }

      try {
        const { data: { user } } = await supabase.auth.getUser();
        const uid = user?.id || null;

        const payload = {
          competitions: filters?.competitions || [],
          seasons: filters?.seasons || [],
          minMarketValue: Number(filters?.minMarketValue || 0),
          minAppearances: Number(filters?.minAppearances || 0),
          userId: uid,
        };

        const counts = await getCounts(payload).catch(() => null);
        const pool = Number(counts?.poolCount || 0);
        const calculated = pool > 0 ? pool * 5 : 10000;
        setComputedPotential(calculated);
      } catch {
        setComputedPotential(10000);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameData?.id]);

  // -------------------------
  // Suggestions (debounced)
  // -------------------------
  useEffect(() => {
    // NEW: once finishing, force-close suggestions and do nothing else
    if (isFinishing || endedRef.current) {
      setSuggestions([]);
      return;
    }

    let active = true;
    const id = setTimeout(async () => {
      const q = String(guess || '').trim();
      if (!q || q.length < 3) {
        if (active) setSuggestions([]);
        return;
      }
      try {
        setIsLoadingSuggestions(true);
        const { data, error } = await supabase.rpc('suggest_names', { q, lim: 50 });
        if (error) throw error;

        const rows = Array.isArray(data) ? data : [];
        const pickPhoto = (r) =>
          r.photo || r.player_photo || r.player_photo_url || r.photo_url || r.avatar || r.image || r.img || null;

        // unique by normalized display
        const groups = new Map();
        for (const r of rows) {
          const display = String(r.player_name ?? r.name ?? r.display ?? r.player_norm_name ?? r.norm ?? '').trim();
          if (!display) continue;
          const key = normalize(display);
          const existing = groups.get(key) || { id: key, display, photo: pickPhoto(r) || null };
          if (!existing.photo && pickPhoto(r)) existing.photo = pickPhoto(r);
          groups.set(key, existing);
        }
        if (active) setSuggestions(Array.from(groups.values()));
      } catch {
        if (active) setSuggestions([]);
      } finally {
        if (active) setIsLoadingSuggestions(false);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [guess, isFinishing]);

  // -------------------------
  // Points (incl. wrong guess ×0.66)
  // -------------------------
  const isGenericPhoto = useMemo(() => {
    const url = gameData?.photo || '';
    return /\/default\.jpg(\?|$)/i.test(url);
  }, [gameData?.photo]);

  const potentialPointsSource = Number(
    gameData?.potentialPoints || filters?.potentialPoints || computedPotential || 0
  );

  const points = useMemo(() => {
    let p = potentialPointsSource;

    Object.keys(usedHints).forEach((k) => {
      if (!usedHints[k]) return;
      if (k === 'partialImage' && isGenericPhoto) return;
      p = Math.floor(p * multipliers[k]);
    });

    // Time decay begins only once countdown actually runs (we don't decrement before transfers load)
    const timeElapsed = INITIAL_TIME - timeSec;
    const timeDecay = Math.pow(0.99, timeElapsed);
    p = Math.floor(p * timeDecay);

    const wrongAttempts = Math.max(0, 3 - guessesLeft);
    p = Math.floor(p * Math.pow(0.66, wrongAttempts));

    return Math.max(0, p);
  }, [potentialPointsSource, usedHints, timeSec, guessesLeft, isGenericPhoto]);

  // -------------------------
  // Effects: shake
  // -------------------------
  const doShake = () => {
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 5, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -5, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  // -------------------------
  // Actions
  // -------------------------
  const reveal = (key) => setUsedHints((u) => ({ ...u, [key]: true }));

  const submitGuess = async (value) => {
    const v = String(value ?? '').trim();
    if (!v || endedRef.current) return;

    // Close suggestions on any guess & hide keyboard
    setSuggestions([]);
    Keyboard.dismiss();

    // Vibrate on every guess (small tap)
    Vibration.vibrate(20);

    const correct = v.toLowerCase() === (gameData?.name || '').trim().toLowerCase();

    if (correct) {
      endedRef.current = true;
      setIsFinishing(true);
      clearInterval(timerRef.current);

      // Scroll to top BEFORE confetti
      try { scrollRef.current?.scrollTo({ y: 0, animated: true }); } catch {}
      setTimeout(() => setShowConfetti(true), 180);

      setTimeout(async () => {
        await saveGameRecord(true);
        await writeElimEntryAndAdvance(true, points);
        const elapsed = INITIAL_TIME - timeSec;
        const guessesUsed = 3 - guessesLeft + 1;
        const outroLine = await generateOutro(true, points, guessesUsed, elapsed);
        goPostgame({
          didWin: true,
          pointsEarned: points,
          elapsed,
          guessesUsed,
          outroLine,
        });
      }, 1200);
      return;
    }

    // ❌ wrong → vibrate + shake + decrement or lose
    Vibration.vibrate(50);
    doShake();

    if (guessesLeft <= 1) {
      endedRef.current = true;
      setIsFinishing(true);
      clearInterval(timerRef.current);

      setSuggestions([]);
      Keyboard.dismiss();

      // Scroll to top BEFORE emoji rain
      try { scrollRef.current?.scrollTo({ y: 0, animated: true }); } catch {}
      setTimeout(() => setShowEmojiRain(true), 180);

      setTimeout(async () => {
        await saveGameRecord(false);
        await writeElimEntryAndAdvance(false, 0);
        const elapsed = INITIAL_TIME - timeSec;
        const outroLine = await generateOutro(false, 0, 3, elapsed);
        goPostgame({
          didWin: false,
          pointsEarned: 0,
          elapsed,
          guessesUsed: 3,
          outroLine,
        });
      }, 1200);
    } else {
      setGuessesLeft((g) => g - 1);
    }
  };

  const loseNow = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setIsFinishing(true);
    clearInterval(timerRef.current);

    // Vibrate on Give up, close suggestions & keyboard
    Vibration.vibrate(60);
    setSuggestions([]);
    Keyboard.dismiss();

    // Scroll to top BEFORE emoji rain
    try { scrollRef.current?.scrollTo({ y: 0, animated: true }); } catch {}
    setTimeout(() => setShowEmojiRain(true), 180);

    setTimeout(async () => {
      await saveGameRecord(false);
      await writeElimEntryAndAdvance(false, 0);
      const outroLine = await generateOutro(false, 0, 3, INITIAL_TIME - timeSec);
      goPostgame({
        didWin: false,
        pointsEarned: 0,
        elapsed: INITIAL_TIME - timeSec,
        guessesUsed: 3,
        outroLine,
      });
    }, 1200);
  };

  const saveGameRecord = async (won) => {
    try {
      const playerIdNumeric = Number(gameData?.id);
      if (!playerIdNumeric || Number.isNaN(playerIdNumeric)) throw new Error('Missing playerData.id');

      const playerData = {
        id: playerIdNumeric,
        name: gameData.name,
        nationality: gameData.nationality,
        position: gameData.position,
        age: gameData.age,
        photo: gameData.photo,
      };

      const gameStats = {
        won,
        points: won ? points : 0,
        potentialPoints: potentialPointsSource,
        timeTaken: INITIAL_TIME - timeSec,
        guessesAttempted: 3 - guessesLeft + (won ? 1 : 0),
        hintsUsed: Object.values(usedHints).filter(Boolean).length,
        isDaily: !!isDaily,
        is_elimination_game: !!elimination,
      };

      if (elimination?.roundId && elimination?.tournamentId) {
        const { data: userInfo } = await supabase.auth.getUser();
        const uid = userInfo?.user?.id || null;

        const { data: grInsert, error: grErr } = await supabase
          .from('games_records')
          .insert([{
            user_id: uid,
            player_id: playerIdNumeric,
            player_name: gameData.name,
            player_data: playerData,
            is_daily_challenge: !!isDaily,
            is_elimination_game: true,
            guesses_attempted: gameStats.guessesAttempted,
            time_taken_seconds: gameStats.timeTaken,
            points_earned: gameStats.points,
            potential_points: gameStats.potentialPoints,
            hints_used: gameStats.hintsUsed,
            completed: true,
            won: gameStats.won,
          }])
          .select('id')
          .single();

        if (grErr) { console.error('[games_records insert] error:', grErr); return null; }

        const { error } = await supabase.rpc('play_elimination_round', {
          p_round_id: elimination.roundId,
          p_user_id: uid,
          p_game: { game_record_id: grInsert.id },
        });
        if (error) { console.error('[play_elimination_round] error:', error); return null; }
        return true;
      }

      const body = {
        userId: (await supabase.auth.getUser())?.data?.user?.id || null,
        playerData,
        gameStats,
        is_elimination_game: !!elimination,
      };
      const resp = await saveGameCompleted(body);
      if (resp && resp.error) { console.error('[saveGameCompleted] error:', resp.error); return null; }
      return true;
    } catch (err) {
      console.error('Error in saveGameRecord:', err);
      return null;
    }
  };

  const writeElimEntryAndAdvance = async () => {
    if (!elimination?.roundId || !elimination?.tournamentId) return;
    try {
      const { error } = await supabase.rpc('advance_elimination_tournament', {
        p_tournament_id: elimination.tournamentId,
      });
      if (error) console.error('[advance_elimination_tournament] error:', error);
    } catch (e) {
      console.error('[advance_elimination_tournament] exception:', e);
    }
  };

  const generateOutro = async (won, pts, guessesUsed, elapsedSec) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/ai/game-outro`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          didWin: !!won,
          points: pts,
          guesses: guessesUsed,
          timeSeconds: elapsedSec,
          playerName: gameData?.name || null,
          isDaily: !!isDaily,
          username: displayName,
        }),
      });
      const data = await resp.json();
      return data?.line || null;
    } catch {
      return null;
    }
  };

  const goPostgame = ({ didWin, pointsEarned, elapsed, guessesUsed, outroLine }) => {
    router.replace({ pathname: '/postgame', params: { aiFact: aiFactRef.current || aiFact || '',
        didWin: didWin ? '1' : '0',
        player: JSON.stringify({
          id: gameData.id,
          name: gameData.name,
          photo: gameData.photo,
          age: gameData.age,
          nationality: gameData.nationality,
          position: gameData.position,
          funFact: gameData.funFact,
        }),
        stats: JSON.stringify({
          pointsEarned,
          timeSec: elapsed,
          guessesUsed,
          usedHints,
        }),
        filters: JSON.stringify(filters),
        isDaily: isDaily ? '1' : '0',
        potentialPoints: String(potentialPointsSource),
        outroLine: outroLine || '',
        elimination: JSON.stringify(elimination || null),
      },
    });
  };

  // -------------------------
  // Render helpers
  // -------------------------
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const timeTone =
    timeSec <= 30 ? styles.timeRed :
    timeSec <= 60 ? styles.timeYellow : styles.timeNormal;
  const guessesTone = guessesLeft <= 1 ? styles.guessRed : (guessesLeft === 2 ? styles.guessWarn : styles.guessNormal);

  const displayPotential = Number(potentialPointsSource || 0);

  // Suggestion list renderer (used in sticky + original)
  const renderSuggestions = () => {
    // NEW: hide suggestions entirely during finishing
    if (isFinishing) return null;

    if (isLoadingSuggestions) return <Text style={styles.loadingTxt}>Loading…</Text>;
    if (!suggestions.length) return null;

    return (
      <ScrollView
        style={styles.sugList}
        contentContainerStyle={{ paddingVertical: 4 }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {suggestions.map((item, index) => (
          <TouchableOpacity
            key={item.id ?? item.display ?? index}
            style={styles.sugItem}
            activeOpacity={0.8}
            onPress={() => {
              setGuess(item.display);
              setSuggestions([]);
              submitGuess(item.display);
              Keyboard.dismiss();
            }}
          >
            {item.photo ? (
              <Image source={{ uri: item.photo }} style={styles.sugAvatar} />
            ) : (
              <View style={styles.sugAvatarFallback}>
                <Text style={styles.sugAvatarFallbackText}>{(item.display?.[0] || '?').toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.sugName}>{item.display}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  };

  if (!fontsLoaded) return null; // wait for Tektur

  // -------------------------
  // UI
  // -------------------------
  const screenW = Dimensions.get('window').width;
  const innerPad = 16;

  const disabledUI = loadingTransfers; // disable interactions + dim until transfers are loaded

  return (
    <Animated.View style={{ flex: 1, backgroundColor: '#f6f7fb', transform: [{ translateX: shakeX }] }}>
      {/* Safe area background + absolute header */}
      <SafeAreaView edges={['top']} style={styles.safeArea} />
      <View style={[styles.header, { top: insets.top }]}>
        <View style={styles.headerSide}>
          <Image source={Logo} style={styles.headerLogo} />
        </View>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, { backgroundColor: '#d1d5db' }]} />
          )}
        </View>
      </View>

      {/* Sticky overlays */}
      {showStickyTimer && (
        <View style={[styles.stickyRow, { top: stickyTop }]}>
          <View style={[styles.card, styles.flex1, styles.center, { paddingVertical: 8, opacity: disabledUI ? 0.5 : 1 }]}>
            <Text style={[styles.timer, timeTone]}>{formatTime(timeSec)}</Text>
            <Text style={styles.subtle}>Time left</Text>
          </View>
          <View style={[styles.card, styles.flex1, styles.center, { paddingVertical: 8, opacity: disabledUI ? 0.5 : 1 }]}>
            <Text style={[styles.bigNumber, guessesTone]}>{guessesLeft}</Text>
            <Text style={styles.subtle}>Guesses left</Text>
          </View>
        </View>
      )}

      {showStickyInput && (
        <View style={[styles.stickyInput, { top: stickyTop + 84 /* under timer row */ }]}>
          <View style={[styles.card, { padding: 10, opacity: disabledUI ? 0.5 : 1 }]} pointerEvents={disabledUI ? 'none' : 'auto'}>
            <View style={styles.inputRow}>
              <TextInput
                value={guess}
                onChangeText={(t) => setGuess(String(t))}
                placeholder="Type a player's name"
                autoFocus={false}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isFinishing && !endedRef.current && !disabledUI}
              />
              <TouchableOpacity onPress={loseNow} style={styles.giveUpBtn} activeOpacity={0.8} disabled={isFinishing || disabledUI}>
                <Text style={styles.giveUpText}>Give up</Text>
              </TouchableOpacity>
            </View>

            {/* Suggestions shown inside sticky card */}
            {renderSuggestions()}
          </View>
        </View>
      )}

      {/* Content */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        keyboardVerticalOffset={0}
      >
        <View style={{ flex: 1 }} pointerEvents={disabledUI ? 'none' : 'auto'}>
          <ScrollView
            ref={scrollRef}
            style={styles.screen}
            contentContainerStyle={[styles.screenContent, { paddingTop: headerHeight + 8, opacity: disabledUI ? 0.5 : 1 }]}
            contentInsetAdjustmentBehavior="never"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScroll={(e) => {
              const y = e.nativeEvent.contentOffset.y;
              setShowStickyTimer(y >= (timerYRef.current ?? 0) - stickyOffset);
              setShowStickyInput(y >= (inputYRef.current ?? 0) - stickyOffset);
            }}
            scrollEventThrottle={16}
          >
            {/* Warning */}
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>⚠️ Don’t leave this screen — backgrounding the app will count as a loss.</Text>
            </View>

            {/* Timer + Guesses */}
            <View
              style={styles.row}
              onLayout={(e) => { timerYRef.current = e.nativeEvent.layout.y; }}
            >
              <View style={[styles.card, styles.flex1, styles.center]}>
                <Text style={[styles.timer, timeTone]}>{formatTime(timeSec)}</Text>
                <Text style={styles.subtle}>Time left</Text>
              </View>
              <View style={[styles.card, styles.flex1, styles.center]}>
                <Text style={[styles.bigNumber, guessesTone]}>{guessesLeft}</Text>
                <Text style={styles.subtle}>Guesses left</Text>
              </View>
            </View>

            {/* Current points */}
            <View style={styles.row}>
              <View style={[styles.card, styles.flex1, styles.center]}>
                <Text style={styles.potentialInline}>
                  Potential: <Text style={styles.potentialStrong}>{displayPotential}</Text>
                </Text>
                <Text style={styles.pointsNow}>{points}</Text>
                <Text style={styles.subtle}>Current points</Text>
              </View>
            </View>

            {/* Guess input row */}
            <View
              style={styles.card}
              onLayout={(e) => { inputYRef.current = e.nativeEvent.layout.y; }}
            >
              <Text style={styles.sectionTitle}>Who are ya?!</Text>

              <View style={styles.inputRow}>
                <TextInput
                  value={guess}
                  onChangeText={(t) => setGuess(String(t))}
                  placeholder="Type a player's name"
                  autoFocus={false}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isFinishing && !endedRef.current && !disabledUI}
                />

                <TouchableOpacity onPress={loseNow} style={styles.giveUpBtn} activeOpacity={0.8} disabled={isFinishing || disabledUI}>
                  <Text style={styles.giveUpText}>Give up</Text>
                </TouchableOpacity>
              </View>

              {/* Only render suggestions here when NOT sticky */}
              {!showStickyInput && renderSuggestions()}
            </View>

            {/* Transfer History — LIST (no swipe) */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Transfer History</Text>
              {loadingTransfers ? (
                <Text style={styles.loadingTxt}>Loading transfers…</Text>
              ) : (
                <View style={{ gap: 12 }}>
                  {transferHistory?.length
                    ? transferHistory.map((t, idx) => (
                        <TransferSlide key={`${t.date || t.season || 'row'}-${idx}`} t={t} /* width auto in list */ />
                      ))
                    : <Text style={styles.emptyTransfers}>No transfers found.</Text>}
                </View>
              )}
            </View>

            {/* Hints — LIST (no swipe) */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Hints</Text>
              <View style={{ gap: 12 }}>
                <HintButton
                  label={"Player's Age"}
                  multiplier="×0.90"
                  disabled={usedHints.age || !gameData?.age || disabledUI}
                  onPress={() => !disabledUI && !usedHints.age && reveal('age')}
                  valueShown={usedHints.age ? String(gameData?.age) : null}
                />
                <HintButton
                  label="Nationality"
                  multiplier="×0.90"
                  disabled={usedHints.nationality || !gameData?.nationality || disabledUI}
                  onPress={() => !disabledUI && !usedHints.nationality && reveal('nationality')}
                  valueShown={usedHints.nationality ? String(gameData?.nationality) : null}
                />
                <HintButton
                  label={"Player's Position"}
                  multiplier="×0.80"
                  disabled={usedHints.position || !gameData?.position || disabledUI}
                  onPress={() => !disabledUI && !usedHints.position && reveal('position')}
                  valueShown={usedHints.position ? String(gameData?.position) : null}
                />
                <HintButton
                  label={"Player's Image"}
                  multiplier="×0.50"
                  disabled={usedHints.partialImage || !gameData?.photo || disabledUI}
                  onPress={() => !disabledUI && !usedHints.partialImage && reveal('partialImage')}
                  valueShown={
                    usedHints.partialImage
                      ? (
                        <View style={styles.hintCropBox}>
                          <Image source={{ uri: gameData?.photo }} style={styles.hintCroppedImage} />
                        </View>
                      )
                      : null
                  }
                />
                <HintButton
                  label={"Player's First Letter"}
                  multiplier="×0.25"
                  disabled={usedHints.firstLetter || !gameData?.name || disabledUI}
                  onPress={() => !disabledUI && !usedHints.firstLetter && reveal('firstLetter')}
                  valueShown={usedHints.firstLetter ? String(gameData?.name?.[0]?.toUpperCase() || '') : null}
                />
              </View>
            </View>

            {/* Bottom spacer */}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* Confetti (win) */}
      {showConfetti && (
        <ConfettiCannon
          count={120}
          origin={{ x: screenW / 2, y: 0 }}
          fadeOut
          autoStart
        />
      )}

      {/* Emoji Rain (loss) — no parent state updates to avoid useInsertionEffect warning */}
      {showEmojiRain && <EmojiRain />}
    </Animated.View>
  );
}

// -------------------------
// Subcomponents
// -------------------------
function HintButton({ label, multiplier, onPress, disabled, valueShown, style }) {
  const hasValue = valueShown !== null && valueShown !== undefined && valueShown !== '';
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={!disabled ? onPress : undefined}
      activeOpacity={0.8}
      style={[
        styles.hintBtn,
        hasValue ? styles.hintBtnRevealed : disabled ? styles.hintBtnDisabled : null,
        style,
      ]}
    >
      <View style={styles.hintHeader}>
        <Text style={[styles.hintLabel, hasValue && styles.hintLabelRevealed]}>{label}</Text>
        <Text style={[styles.hintMult, hasValue && styles.hintMultRevealed]}>{multiplier}</Text>
        {hasValue ? (
          <Text style={styles.hintChip}>Revealed</Text>
        ) : null}
      </View>

      {hasValue ? (
        typeof valueShown === 'string' || typeof valueShown === 'number' ? (
          <Text style={styles.hintValue}>{valueShown}</Text>
        ) : (
          <View style={styles.hintImageWrap}>{valueShown}</View>
        )
      ) : null}
    </TouchableOpacity>
  );
}

function TransferSlide({ t, width }) {
  const isFuture = (() => {
    if (!t?.date) return false;
    const d = new Date(t.date);
    if (isNaN(d.getTime())) return false;
    return d > new Date();
  })();

  return (
    <View style={[styles.transferSlide, width ? { width } : null]}>
      {/* Season + Date */}
      <View style={styles.transferColA}>
        <View style={styles.chip}><Text style={styles.chipText}>{t.season || '—'}</Text></View>
        <Text style={styles.transferDate}>{t.date || '—'}</Text>
      </View>

      {/* From → To */}
      <View style={styles.transferColB}>
        <ClubPill logo={t.out?.logo} name={t.out?.name} flag={t.out?.flag} />
        <Text style={styles.arrow}>{'→'}</Text>
        <ClubPill logo={t.in?.logo} name={t.in?.name} flag={t.in?.flag} />
      </View>

      {/* Value + Type + Future */}
      <View style={styles.transferColC}>
        <View style={styles.chip}><Text style={styles.chipText}>{formatFee(t.valueRaw ?? '')}</Text></View>
        {!!t.type && <View style={styles.chip}><Text style={styles.chipText}>{t.type}</Text></View>}
        {isFuture && <View style={[styles.chip, styles.chipFuture]}><Text style={[styles.chipText, styles.chipFutureText]}>Future Transfer</Text></View>}
      </View>
    </View>
  );
}

function ClubPill({ logo, name, flag }) {
  return (
    <View style={styles.clubPill}>
      <View style={styles.clubIcons}>
        {logo ? <Image source={{ uri: logo }} style={styles.clubLogo} /> : null}
        {flag ? <Image source={{ uri: flag }} style={styles.clubFlag} /> : null}
      </View>
      <Text numberOfLines={1} style={styles.clubName}>{name || 'Unknown'}</Text>
    </View>
  );
}

/** Emoji Rain overlay (loss effect) - JS-only, no parent state updates */
function EmojiRain() {
  const { width, height } = Dimensions.get('window');
  const EMOJIS = ['😭', '💀', '☠️', '😫', '🤬', '😢'];
  const COUNT = 26;

  const items = useRef(
    Array.from({ length: COUNT }).map(() => ({
      x: Math.random() * (width - 30) + 15,
      delay: Math.floor(Math.random() * 800),
      size: Math.floor(Math.random() * 10) + 22, // 22-32
      fall: new Animated.Value(0),
      rotDir: Math.random() > 0.5 ? 1 : -1,
    }))
  ).current;

  useEffect(() => {
    const anims = items.map((it) =>
      Animated.timing(it.fall, {
        toValue: 1,
        duration: 2000 + Math.floor(Math.random() * 1200),
        delay: it.delay,
        useNativeDriver: true,
      })
    );
    Animated.stagger(70, anims).start();
  }, [items]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {items.map((it, idx) => {
        const translateY = it.fall.interpolate({
          inputRange: [0, 1],
          outputRange: [-40, height + 40],
        });
        const rotate = it.fall.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${it.rotDir * 360}deg`],
        });
        const emoji = EMOJIS[idx % EMOJIS.length];
        return (
          <Animated.Text
            key={idx}
            style={{
              position: 'absolute',
              left: it.x,
              top: -40,
              transform: [{ translateY }, { rotate }],
              fontSize: it.size,
              fontFamily: 'Tektur_400Regular',
            }}
          >
            {emoji}
          </Animated.Text>
        );
      })}
    </View>
  );
}

// -------------------------
// Styles
// -------------------------
const styles = StyleSheet.create({
  safeArea: { backgroundColor: 'white' },
  screen: { flex: 1 },
  screenContent: { padding: 16, gap: 12 },

  header: {
    height: 56,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 50,
  },
  headerSide: { width: 56, alignItems: 'flex-start', justifyContent: 'center' },
  headerLogo: { width: 40, height: 40, borderRadius: 6, resizeMode: 'contain' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: '#111827', fontFamily: 'Tektur_700Bold' },

  stickyRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 40,
    flexDirection: 'row',
    gap: 12,
  },
  stickyInput: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 35,
  },

  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    borderWidth: 1, borderColor: '#eef1f6',
  },

  warnBox: { backgroundColor: '#fffbeb', borderColor: '#fde68a', borderWidth: 1, borderRadius: 16, padding: 12 },
  warnText: { color: '#92400e', fontWeight: '600', textAlign: 'center', fontFamily: 'Tektur_400Regular' },

  row: { flexDirection: 'row', gap: 12 },
  flex1: { flex: 1 },
  center: { alignItems: 'center' },

  timer: { fontSize: 28, fontWeight: '800', fontFamily: 'Tektur_700Bold' },
  timeRed: { color: '#dc2626' },
  timeYellow: { color: '#ca8a04' },
  timeNormal: { color: '#111827' },

  subtle: { color: '#6b7280', marginTop: 4, fontFamily: 'Tektur_400Regular' },

  bigNumber: { fontSize: 28, fontWeight: '800', color: '#111827', fontFamily: 'Tektur_700Bold' },
  pointsNow: { fontSize: 28, fontWeight: '800', color: '#b45309', marginTop: 2, fontFamily: 'Tektur_700Bold' },

  potentialInline: { fontSize: 12, color: '#374151', fontFamily: 'Tektur_400Regular' },
  potentialStrong: { fontWeight: '800', color: '#111827', fontFamily: 'Tektur_700Bold' },

  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, fontFamily: 'Tektur_700Bold' },

  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  input: {
    flex: 1,
    borderWidth: 1, borderColor: '#e5e7eb',
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    borderRadius: 10, backgroundColor: 'white', fontSize: 16,
    fontFamily: 'Tektur_400Regular',
  },
  giveUpBtn: { backgroundColor: '#dc2626', paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center' },
  giveUpText: { color: 'white', fontWeight: '700', fontFamily: 'Tektur_700Bold' },

  loadingTxt: { marginTop: 8, color: '#6b7280', fontFamily: 'Tektur_400Regular' },

  sugList: { marginTop: 8, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, maxHeight: 260, backgroundColor: 'white' },
  sugItem: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10 },
  sugAvatar: { width: 32, height: 32, borderRadius: 16, resizeMode: 'cover' },
  sugAvatarFallback: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  sugAvatarFallbackText: { fontSize: 12, color: '#6b7280', fontWeight: '700', fontFamily: 'Tektur_700Bold' },
  sugName: { fontSize: 14, color: '#111827', fontFamily: 'Tektur_400Regular' },

  // Hints & Transfers (list styles reuse existing)
  transferSlide: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12 },

  hintBtn: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 12 },
  hintBtnDisabled: { backgroundColor: '#f9fafb' },
  hintBtnRevealed: { backgroundColor: '#ecfdf5', borderColor: '#bbf7d0' },
  hintHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hintLabel: { fontSize: 14, fontWeight: '600', color: '#111827', fontFamily: 'Tektur_700Bold' },
  hintLabelRevealed: { color: '#065f46' },
  hintMult: { marginLeft: 4, fontSize: 12, color: '#6b7280', fontFamily: 'Tektur_400Regular' },
  hintMultRevealed: { color: '#10b981' },
  hintChip: { marginLeft: 'auto', fontSize: 10, fontWeight: '800', color: '#065f46', backgroundColor: '#d1fae5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, textTransform: 'uppercase', fontFamily: 'Tektur_700Bold' },
  hintValue: { marginTop: 6, fontSize: 22, fontWeight: '800', color: '#065f46', fontFamily: 'Tektur_700Bold' },
  hintImageWrap: { marginTop: 10, alignItems: 'center' },

  hintCropBox: { width: 128, height: 128, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: '#6ee7b7' },
  hintCroppedImage: { width: 128, height: 192, resizeMode: 'cover' },

  emptyTransfers: { color: '#6b7280', textAlign: 'center', fontFamily: 'Tektur_400Regular' },
  transferColA: { alignItems: 'center', marginBottom: 8 },
  transferDate: { fontSize: 12, color: '#6b7280', marginTop: 2, fontFamily: 'Tektur_400Regular' },
  transferColB: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginVertical: 6 },
  transferColC: { alignItems: 'center', gap: 6, marginTop: 4 },
  arrow: { color: '#9ca3af', fontFamily: 'Tektur_400Regular' },
  clubPill: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 240 },
  clubIcons: { alignItems: 'center', marginRight: 2 },
  clubLogo: { width: 24, height: 24, borderRadius: 6, resizeMode: 'contain' },
  clubFlag: { width: 20, height: 14, borderRadius: 3, marginTop: 2, resizeMode: 'cover' },
  clubName: { flexShrink: 1, fontSize: 13, color: '#111827', fontFamily: 'Tektur_400Regular' },

  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8, borderColor: '#e2e8f0' },
  chipText: { fontSize: 12, fontWeight: '700', fontFamily: 'Tektur_700Bold' },

  chipFuture: { backgroundColor: '#dbeafe', borderColor: '#bfdbfe' },
  chipFutureText: { color: '#1e40af' },
  guessNormal: { color: '#111827' },
  guessWarn: { color: '#ca8a04' },
  guessRed: { color: '#dc2626' },
  headerAvatar: { width: 28, height: 28, borderRadius: 14 },
  fxOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999 },
});

/* ------------------------- helpers ------------------------- */
function safeStr(v) { return v == null ? '' : String(v); }
function toNum(v, def = 0) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function parseJson(v) { try { return v ? JSON.parse(String(v)) : null; } catch { return null; } }
function formatFee(raw) {
  if (!raw) return '—';
  let s = String(raw);
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
  s = s.replace(/^\s*(Loan\s*fee:|Fee:)\s*/i, '');
  s = s.replace(/^\$/, '€').replace(/\$/g, '€').trim();
  return s || '—';
}
