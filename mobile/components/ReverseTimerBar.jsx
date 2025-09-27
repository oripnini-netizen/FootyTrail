// mobile/components/ReverseTimerBar.jsx (React Native)
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";

export default function ReverseTimerBar({
  endAt,
  totalSeconds,
  forceEnded = false,
  labelWhenEnded = "Round Ended",
}) {

  const endTs = useMemo(
    () => (endAt instanceof Date ? endAt.getTime() : new Date(endAt).getTime()),
    [endAt]
  );

  const totalMs = Math.max(1, (totalSeconds ?? 0) * 1000); // avoid /0
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef(null);

// Compute current percentage left (0-100)
const computePct = (endMs, nowMs) =>
  Math.max(0, Math.min(100, ((Math.max(0, endMs - nowMs)) / totalMs) * 100));

// When we get forceEnded=true (e.g., round closed early), we freeze the fill width
const [frozenPct, setFrozenPct] = useState(null);


  useEffect(() => {
  // If ended by force, freeze width now and stop ticking
  if (forceEnded) {
    setFrozenPct((prev) => (prev == null ? computePct(endTs, Date.now()) : prev));
    if (intervalRef.current) clearInterval(intervalRef.current);
    return; // do not start a new interval
  }

  // Otherwise keep a lightweight tick ~4 fps
  if (intervalRef.current) clearInterval(intervalRef.current);
  intervalRef.current = setInterval(() => setNow(Date.now()), 250);

  return () => intervalRef.current && clearInterval(intervalRef.current);
}, [endTs, totalMs, forceEnded]);


  const remainingMs = Math.max(0, endTs - now);
const livePct = computePct(endTs, now);
const displayPct = forceEnded ? (frozenPct ?? livePct) : livePct;

const secondsLeft = Math.ceil(remainingMs / 1000);
const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
const ss = String(secondsLeft % 60).padStart(2, "0");

// Treat "ended" either when time ran out or when parent forces it (all participants played / round closed)
const ended = forceEnded || remainingMs <= 0;


  return (
    <View style={styles.wrap}>
      <View style={styles.track} />
<View style={[styles.fill, { width: `${displayPct}%` }]} />
      <View style={styles.labelWrap}>
        <Text style={styles.labelText}>
  {ended ? labelWhenEnded : `${mm}:${ss}`}
</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    height: 26,
    width: "100%",
  },
  track: {
    position: "absolute",
    inset: 0,
    backgroundColor: "#fee2e2", 
    borderRadius: 999,
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#ff9292ff", 
    borderRadius: 999,
  },
  labelWrap: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  labelText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#7f1d1d",
  },
});
