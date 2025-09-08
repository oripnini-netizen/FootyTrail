// mobile/app/(tabs)/game.js
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import {
  getCompetitions,
  getSeasons,
  getCounts,
  getRandomPlayer,
  getDailyChallenge,
  getLimits,
} from "../../lib/api";

export default function GameScreen() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  const [loading, setLoading] = useState(true);
  const [competitions, setCompetitions] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [selectedCompetitions, setSelectedCompetitions] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minMV, setMinMV] = useState(0);
  const [counts, setCounts] = useState({ poolCount: 0, totalCount: 0 });
  const [limits, setLimits] = useState({ gamesToday: 0, pointsToday: 0, pointsTotal: 0, dailyPlayed: false });

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace("/login");
        return;
      }

      if (mounted) {
        setUser(session.user);

        const { data: profile } = await supabase
          .from("users")
          .select("has_completed_onboarding")
          .eq("id", session.user.id)
          .single();

        if (profile && profile.has_completed_onboarding === false) {
          router.replace("/tutorial");
          return;
        }
      }

      try {
        const [cRes, sRes] = await Promise.all([getCompetitions(), getSeasons()]);
        if (!mounted) return;
        setCompetitions(cRes?.flat || cRes?.competitions || []);
        setSeasons(Array.isArray(sRes) ? sRes : (sRes?.seasons || []));

        const lim = await getLimits(session.user.id).catch(() => null);
        if (mounted && lim) setLimits(lim);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      try {
        const res = await getCounts({
          competitions: selectedCompetitions,
          seasons: selectedSeasons,
          minMarketValue: Number(minMV) || 0,
          userId: user.id,
        });
        if (!cancelled) setCounts({ poolCount: res?.poolCount || 0, totalCount: res?.totalCount || 0 });
      } catch {
        if (!cancelled) setCounts({ poolCount: 0, totalCount: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [user, selectedCompetitions, selectedSeasons, minMV]);

  const startRegular = async () => {
    try {
      const player = await getRandomPlayer(
        { competitions: selectedCompetitions, seasons: selectedSeasons, minMarketValue: Number(minMV) || 0, userId: user?.id },
        user?.id
      );
      if (!player) {
        Alert.alert("No players found", "Try adjusting your filters.");
        return;
      }
      router.push({ pathname: "/live", params: { payload: JSON.stringify({ ...player, isDaily: false }) } });
    } catch (e) {
      Alert.alert("Failed to start game", String(e?.message || e));
    }
  };

  const startDaily = async () => {
    try {
      const daily = await getDailyChallenge();
      if (!daily?.player_id) {
        Alert.alert("No daily challenge available");
        return;
      }
      router.push({ pathname: "/live", params: { dailyPlayerId: String(daily.player_id), isDaily: "1" } });
    } catch (e) {
      Alert.alert("Failed to start daily", String(e?.message || e));
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading FootyTrail…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: "700" }}>FootyTrail</Text>
      <Text>Pool: {counts.poolCount} / Total: {counts.totalCount}</Text>
      <Text>Games today: {limits.gamesToday} • Points today: {limits.pointsToday}</Text>

      <Pressable onPress={startRegular} style={{ backgroundColor: "#166534", padding: 14, borderRadius: 10 }}>
        <Text style={{ color: "white", textAlign: "center", fontWeight: "600" }}>Start Game</Text>
      </Pressable>

      <Pressable onPress={startDaily} style={{ backgroundColor: "#000", padding: 14, borderRadius: 10 }}>
        <Text style={{ color: "white", textAlign: "center", fontWeight: "600" }}>Play Daily Challenge</Text>
      </Pressable>
    </ScrollView>
  );
}
