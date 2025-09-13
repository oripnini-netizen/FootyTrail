import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Switch, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";

export default function EliminationCreateScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);

  // form fields
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [stake, setStake] = useState("0");
  const [minPlayers, setMinPlayers] = useState("2");
  const [roundLimitMin, setRoundLimitMin] = useState("10");           // minutes per round
  const [elimEvery, setElimEvery] = useState("1");                    // rounds_to_elimination
  const [joinDeadlineMins, setJoinDeadlineMins] = useState("0");      // 0 = no deadline
  const [useMyDefaultFilters, setUseMyDefaultFilters] = useState(true);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!error) setUserId(data?.user?.id || null);
    })();
  }, []);

  const onCreate = async () => {
    if (!userId) {
      Alert.alert("Not signed in", "Please sign in first.");
      return;
    }
    if (!name.trim()) {
      Alert.alert("Name required", "Give your challenge a name.");
      return;
    }
    const stake_points = Math.max(0, Number(stake) || 0);
    const min_participants = Math.max(2, Number(minPlayers) || 2);
    const round_time_limit_seconds = Math.max(60, (Number(roundLimitMin) || 10) * 60);
    const rounds_to_elimination = Math.max(1, Math.min(5, Number(elimEvery) || 1));

    // filters: use user's defaults if desired
    let filters = { visibility: isPublic ? "public" : "private" };
    if (useMyDefaultFilters) {
      try {
        const { data } = await supabase
          .from("users")
          .select("default_leagues, default_seasons, default_min_appearances")
          .eq("id", userId)
          .limit(1)
          .maybeSingle();
        filters = {
          ...filters,
          default_leagues: data?.default_leagues ?? [],
          default_seasons: data?.default_seasons ?? [],
          default_min_appearances: data?.default_min_appearances ?? 0,
        };
      } catch {
        // keep visibility only
      }
    }

    // optional join deadline
    let join_deadline = null;
    try {
      const mins = Math.max(0, Number(joinDeadlineMins) || 0);
      if (mins > 0) {
        join_deadline = new Date(Date.now() + mins * 60000).toISOString();
      }
    } catch { /* ignore */ }

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("elimination_tournaments")
        .insert([{
          name: name.trim(),
          status: "lobby",
          owner_id: userId,
          stake_points,
          min_participants,
          round_time_limit_seconds,
          rounds_to_elimination,
          join_deadline,
          filters,
        }])
        .select("id")
        .maybeSingle();
      if (error) throw error;

      Alert.alert("Challenge created", "Invite your friends and start when ready!");
      router.back();
    } catch (e) {
      Alert.alert("Could not create", String(e?.message || e) );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Create Elimination Challenge</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.input} placeholder="e.g., Friday Night KO" value={name} onChangeText={setName} />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Public</Text>
        <Switch value={isPublic} onValueChange={setIsPublic} />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Stake (points)</Text>
        <TextInput style={styles.inputSmall} keyboardType="numeric" value={stake} onChangeText={setStake} />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Min participants</Text>
        <TextInput style={styles.inputSmall} keyboardType="numeric" value={minPlayers} onChangeText={setMinPlayers} />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Round time (minutes)</Text>
        <TextInput style={styles.inputSmall} keyboardType="numeric" value={roundLimitMin} onChangeText={setRoundLimitMin} />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Elimination every (rounds)</Text>
        <TextInput style={styles.inputSmall} keyboardType="numeric" value={elimEvery} onChangeText={setElimEvery} />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Join deadline (+ minutes, 0 = none)</Text>
        <TextInput style={styles.inputSmall} keyboardType="numeric" value={joinDeadlineMins} onChangeText={setJoinDeadlineMins} />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Use my default filters</Text>
        <Switch value={useMyDefaultFilters} onValueChange={setUseMyDefaultFilters} />
      </View>

      <TouchableOpacity disabled={submitting} onPress={onCreate} style={[styles.btn, submitting && styles.btnDisabled]}>
        <Text style={styles.btnText}>{submitting ? "Creating…" : "Create Challenge"}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.back()} style={[styles.btnGhost]}>
        <Text style={styles.btnGhostText}>Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: "800", color: "#065f46" },
  field: { gap: 6 },
  label: { color: "#111827", fontWeight: "700" },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  inputSmall: { minWidth: 90, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, textAlign: "center" },
  btn: { marginTop: 12, backgroundColor: "#166534", paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "800" },
  btnDisabled: { opacity: 0.7 },
  btnGhost: { marginTop: 8, backgroundColor: "#f3f4f6", borderWidth: 1, borderColor: "#e5e7eb", paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  btnGhostText: { color: "#111827", fontWeight: "800" },
});
