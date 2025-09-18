import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { supabase } from "../../lib/supabase";

function Section({ title, right, children, style }) {
  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: "#e5e7eb",
          borderRadius: 12,
          backgroundColor: "#fff",
          padding: 12,
          marginBottom: 12,
        },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "700" }}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export default function LeaguesScreen() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  // Create league form
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Default start date to today (YYYY-MM-DD)
  const todayIso = useMemo(() => {
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);
  const [startDate, setStartDate] = useState(todayIso);

  // Data
  const [myLeagues, setMyLeagues] = useState([]); // [{ id, name, description, creator_id, start_date, created_at }]
  const [membersByLeague, setMembersByLeague] = useState({}); // { leagueId: [{ id, name, avatar, is_bot, display_name }] }
  const [nextMatchByLeague, setNextMatchByLeague] = useState({}); // { leagueId: { match_day, match_date, home_name, away_name } | null }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Current user
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      setMe(user);

      if (!user) {
        setMyLeagues([]);
        setMembersByLeague({});
        setNextMatchByLeague({});
        return;
      }

      // 1) Leagues I created
      const { data: createdLeagues, error: createdErr } = await supabase
        .from("leagues")
        .select("id, name, description, creator_id, start_date, created_at")
        .eq("creator_id", user.id);
      if (createdErr) throw createdErr;

      // 2) Leagues I participate in (via league_participants)
      //    We join to leagues to flatten shape in one call.
      const { data: participantRows, error: partErr } = await supabase
        .from("league_participants")
        .select("league_id, leagues:league_id(id, name, description, creator_id, start_date, created_at)")
        .eq("user_id", user.id);
      if (partErr) throw partErr;

      const participatedLeagues =
        (participantRows || [])
          .map((r) => r.leagues)
          .filter(Boolean) || [];

      // Merge + de-duplicate by league id
      const leagueMap = new Map();
      [...(createdLeagues || []), ...participatedLeagues].forEach((lg) => {
        leagueMap.set(lg.id, lg);
      });
      const allMyLeagues = Array.from(leagueMap.values());

      // Sort by name (case-insensitive)
      allMyLeagues.sort((a, b) =>
        (a?.name || "").localeCompare(b?.name || "", undefined, { sensitivity: "base" })
      );

      setMyLeagues(allMyLeagues);

      // 3) Members for these leagues
      if (allMyLeagues.length > 0) {
        const ids = allMyLeagues.map((l) => l.id);
        const { data: members, error: membersErr } = await supabase
          .from("league_participants")
          .select(
            `
            id,
            league_id,
            user_id,
            is_bot,
            display_name,
            users:user_id (
              id,
              full_name,
              profile_photo_url
            )
          `
          )
          .in("league_id", ids);
        if (membersErr) throw membersErr;

        const grouped = {};
        (members || []).forEach((row) => {
          if (!grouped[row.league_id]) grouped[row.league_id] = [];
          const isBot = !!row.is_bot;
          const userName = row?.users?.full_name || null; // <- adjust if your "users" table uses another field
          const avatar = row?.users?.profile_photo_url || null; // <- adjust if different
          grouped[row.league_id].push({
            id: row.id,
            is_bot: isBot,
            display_name: row.display_name,
            name: isBot ? row.display_name || "Bot" : userName || "Unknown",
            avatar: isBot
              ? null
              : avatar ||
                `https://api.dicebear.com/7.x/thumbs/png?seed=${encodeURIComponent(
                  userName || "user"
                )}`,
          });
        });
        setMembersByLeague(grouped);
      } else {
        setMembersByLeague({});
      }

      // 4) Next match for each league (nearest match_date >= today)
      if (allMyLeagues.length > 0) {
        const ids = allMyLeagues.map((l) => l.id);
        // Fetch all upcoming matches in one go; we'll resolve home/away names with participants mapping below
        const { data: upcoming, error: upErr } = await supabase
          .from("league_matches")
          .select(
            `
            id,
            league_id,
            match_day,
            match_date,
            home_participant_id,
            away_participant_id,
            home:home_participant_id(
              id,
              is_bot,
              display_name,
              user_id,
              users:user_id(id, full_name)
            ),
            away:away_participant_id(
              id,
              is_bot,
              display_name,
              user_id,
              users:user_id(id, full_name)
            )
          `
          )
          .in("league_id", ids);
        if (upErr) throw upErr;

        const today = new Date();
        const todayYMD = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
        );

        const nextByLeague = {};
        (upcoming || [])
          .filter((m) => {
            // Keep matches with match_date >= today (dates are stored as date; interpret as UTC midnight)
            const [yyyy, mm, dd] = String(m.match_date).split("-");
            const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
            return d >= todayYMD;
          })
          .sort((a, b) => {
            // Sort all upcoming by (league_id, match_date asc, match_day asc)
            const aKey = `${a.league_id}`;
            const bKey = `${b.league_id}`;
            if (aKey !== bKey) return aKey.localeCompare(bKey);
            if (a.match_date !== b.match_date)
              return String(a.match_date).localeCompare(String(b.match_date));
            return (a.match_day || 0) - (b.match_day || 0);
          })
          .forEach((m) => {
            if (!nextByLeague[m.league_id]) {
              const homeName = m?.home?.is_bot
                ? m?.home?.display_name || "Bot"
                : m?.home?.users?.full_name || "Unknown";
              const awayName = m?.away?.is_bot
                ? m?.away?.display_name || "Bot"
                : m?.away?.users?.full_name || "Unknown";
              nextByLeague[m.league_id] = {
                match_day: m.match_day,
                match_date: m.match_date, // YYYY-MM-DD
                home_name: homeName,
                away_name: awayName,
              }
            }
          });

        setNextMatchByLeague(nextByLeague);
      } else {
        setNextMatchByLeague({});
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Could not load leagues.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert("Missing name", "Please enter a league name.");
      return;
    }
    // Simple YYYY-MM-DD validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      Alert.alert("Invalid date", "Start date must be YYYY-MM-DD.");
      return;
    }

    try {
      setCreating(true);

      // 1) Create the league
      const { data: created, error: createErr } = await supabase
        .from("leagues")
        .insert([
          {
            name: name.trim(),
            description: description?.trim() || null,
            creator_id: me?.id,
            start_date: startDate,
          },
        ])
        .select("id")
        .single();
      if (createErr) throw createErr;

      // 2) Add the creator as a participant (non-bot)
      const { error: partErr } = await supabase.from("league_participants").insert([
        {
          league_id: created.id,
          user_id: me?.id,
          is_bot: false,
          display_name: null,
        },
      ]);
      if (partErr) throw partErr;

      // Reset form + close
      setName("");
      setDescription("");
      setStartDate(todayIso);
      setCreateOpen(false);

      // Reload
      await load();
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Could not create the league.");
    } finally {
      setCreating(false);
    }
  }, [name, description, startDate, me?.id, todayIso, load]);

  const sortedLeagues = useMemo(() => {
    return [...myLeagues];
  }, [myLeagues]);

  const LeagueItem = ({ item }) => {
    const members = membersByLeague[item.id] || [];
    const next = nextMatchByLeague[item.id] || null;

    return (
      <View
        style={{
          borderWidth: 1,
          borderColor: "#e5e7eb",
          borderRadius: 12,
          padding: 12,
          marginBottom: 12,
          backgroundColor: "#fff",
        }}
      >
        {/* Header */}
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={1}>
              {item.name}
            </Text>
            {!!item.description && (
              <Text style={{ color: "#6b7280", fontSize: 12 }} numberOfLines={2}>
                {item.description}
              </Text>
            )}
            <Text style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>
              Starts {item.start_date} • {members.length} participants
            </Text>
          </View>

          {/* Member avatars */}
          <View style={{ flexDirection: "row" }}>
            {members.slice(0, 5).map((m) =>
              m.is_bot ? (
                <View
                  key={m.id}
                  style={{
                    height: 32,
                    width: 32,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: "#e5e7eb",
                    marginLeft: -6,
                    backgroundColor: "#f3f4f6",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 10, color: "#111827" }}>BOT</Text>
                </View>
              ) : (
                <Image
                  key={m.id}
                  source={{ uri: m.avatar }}
                  style={{
                    height: 32,
                    width: 32,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: "#e5e7eb",
                    marginLeft: -6,
                    backgroundColor: "#f3f4f6",
                  }}
                />
              )
            )}
            {members.length > 5 && (
              <View
                style={{
                  height: 32,
                  width: 32,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "#e5e7eb",
                  marginLeft: -6,
                  backgroundColor: "#f3f4f6",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 12 }}>+{members.length - 5}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Next match */}
        <View style={{ marginTop: 10 }}>
          <Text style={{ fontWeight: "600", marginBottom: 4 }}>Next match</Text>
          {next ? (
            <Text style={{ color: "#374151" }}>
              Day {next.match_day} • {next.match_date}: {next.home_name} vs {next.away_name}
            </Text>
          ) : (
            <Text style={{ color: "#6b7280" }}>No upcoming matches scheduled.</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: "#f9fafb" }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          paddingTop: Platform.OS === "ios" ? 6 : 0,
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: "800" }}>Leagues</Text>
        <TouchableOpacity
          onPress={() => setCreateOpen((s) => !s)}
          style={{
            backgroundColor: "#059669",
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>
            {createOpen ? "Close" : "Create"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Create League Panel */}
      {createOpen && (
        <Section title="Create League">
          <View style={{ gap: 8 }}>
            <TextInput
              placeholder="League name"
              value={name}
              onChangeText={setName}
              style={{
                borderWidth: 1,
                borderColor: "#e5e7eb",
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: "#fff",
              }}
            />
            <TextInput
              placeholder="Description (optional)"
              value={description}
              onChangeText={setDescription}
              multiline
              style={{
                borderWidth: 1,
                borderColor: "#e5e7eb",
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: "#fff",
                minHeight: 70,
                textAlignVertical: "top",
              }}
            />
            <TextInput
              placeholder="Start date (YYYY-MM-DD)"
              value={startDate}
              onChangeText={setStartDate}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                borderWidth: 1,
                borderColor: "#e5e7eb",
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: "#fff",
              }}
            />
            <View style={{ flexDirection: "row" }}>
              <TouchableOpacity
                onPress={onCreate}
                disabled={creating || !name.trim()}
                style={{
                  backgroundColor: creating || !name.trim() ? "#a7f3d0" : "#059669",
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 10,
                  marginRight: 8,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>
                  {creating ? "Creating…" : "Create"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setCreateOpen(false);
                  setName("");
                  setDescription("");
                  setStartDate(todayIso);
                }}
                style={{
                  backgroundColor: "#e5e7eb",
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 10,
                }}
              >
                <Text style={{ color: "#111827", fontWeight: "700" }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Section>
      )}

      {/* My Leagues */}
      <Section
        title="My Leagues"
        right={<Text style={{ color: "#6b7280" }}>{sortedLeagues.length}</Text>}
        style={{ flex: 1, minHeight: 120 }}
      >
        {loading ? (
          <ActivityIndicator />
        ) : sortedLeagues.length === 0 ? (
          <Text style={{ color: "#6b7280" }}>
            You don’t belong to any league yet. Create one above or ask an admin to add you.
          </Text>
        ) : (
          <FlatList
            data={sortedLeagues}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <LeagueItem item={item} />}
            contentContainerStyle={{ paddingBottom: 12 }}
          />
        )}
      </Section>
    </View>
  );
}
