// supabase/functions/send-push/index.ts
// Deno Edge Function: process pending notification_jobs and send Expo pushes.
// Uses service-role Supabase client via env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
/// <reference types="https://esm.sh/@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const BATCH_LIMIT = 100;
const MAX_ATTEMPTS = 5;

// Map each notification kind to a bundled sound filename (no path).
// Edit freely as you add more sounds under mobile/assets/sounds/.
const SOUND_MAP: Record<string, string> = {
  daily_games_progress: "bells.wav",
  daily_challenge_reminder: "bells.wav",
  tournament_new_accept: "bells.wav",
  round_started: "bells.wav",
  public_elim_created: "bells.wav",
  private_elim_invited: "bells.wav",
  // fallback:
  default: "who_are_ya.wav",
};

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: {
      persistSession: false
    }
  });
}
async function reserveJobs(supabase, limit) {
  // 1) take a slice of oldest 'pending'
  const { data, error } = await supabase.from("notification_jobs").select("id, attempts, kind, tournament_id, recipient_user_id, payload, status, last_error, created_at").eq("status", "pending").order("created_at", {
    ascending: true
  }).limit(limit);
  if (error) throw new Error("reserveJobs(select): " + error.message);
  const jobs = data ?? [];
  if (!jobs.length) return [];
  // 2) move them to 'processing' & bump attempts
  for (const j of jobs){
    const newAttempts = (Number(j.attempts) || 0) + 1;
    await supabase.from("notification_jobs").update({
      status: "processing",
      attempts: newAttempts
    }).eq("id", j.id).eq("status", "pending"); // avoid racing other invocations
  }
  // 3) re-read locked rows
  const ids = jobs.map((j)=>j.id);
  const { data: locked, error: e2 } = await supabase.from("notification_jobs").select("*").in("id", ids).eq("status", "processing");
  if (e2) throw new Error("reserveJobs(reload): " + e2.message);
  return locked ?? [];
}
async function loadDevices(supabase, userId) {
  const { data, error } = await supabase.from("user_devices").select("push_token, platform").eq("user_id", userId);
  if (error) throw new Error("loadDevices: " + error.message);
  const seen = new Set();
  const out = [];
  for (const row of data ?? []){
    if (row.push_token && !seen.has(row.push_token)) {
      seen.add(row.push_token);
      out.push(row);
    }
  }
  return out;
}

function buildExpoMessages(job, devices) {
  const title = String(job.payload?.title ?? "FootyTrail");
  const body = String(job.payload?.body ?? "Open challenge");

  // Where to navigate on tap (keeps your current behavior)
  const navigateTo = job.payload?.navigateTo || "/elimination";

  // 1) Decide the "type" for sound mapping
  //    Prefer job.kind, fallback to payload.type, finally "default".
  const type = String(job?.kind ?? job?.payload?.type ?? "default").trim() || "default";

  // 2) If the job explicitly includes payload.sound (string), it overrides the map.
  //    Otherwise, map by type. Finally, fall back to SOUND_MAP.default.
  const rawSound =
    (typeof job?.payload?.sound === "string" && job.payload.sound.trim()) ||
    SOUND_MAP[type] ||
    SOUND_MAP.default;

  // 3) Expo expects the bundled filename (registered in app.json). No paths.
  //    If someone passed "whistle" without extension, normalize to ".wav".
  const sound = /\./.test(rawSound) ? rawSound : `${rawSound}.wav`;

  // Keep payload in `data`
  const data = {
    ...(job.payload ?? {}),
    navigateTo,
    jobId: job.id,
    kind: job.kind,
    tournamentId: job.tournament_id,
  };

  return devices.map((d) => ({
    to: d.push_token,
    title,
    body,
    sound,            // 👈 per-type / per-payload sound
    channelId: "default",
    priority: "high",
    data,
  }));
}


async function sendExpo(messages) {
  if (!messages.length) {
    return {
      okCount: 0,
      errors: []
    };
  }
  const res = await fetch(EXPO_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify(messages)
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch  {
  // keep text as-is for diagnostics
  }
  if (!res.ok) {
    // Return the raw response body so we can see what Expo didn’t like
    return {
      okCount: 0,
      errors: [
        `HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`
      ]
    };
  }
  const tickets = Array.isArray(parsed?.data) ? parsed.data : [];
  let okCount = 0;
  const errors = [];
  for (const t of tickets){
    if (t?.status === "ok") {
      okCount++;
    } else if (t?.status === "error") {
      const details = [
        t?.message,
        t?.details?.error,
        t?.details?.fault,
        t?.details?.reason
      ].filter(Boolean).join(" | ");
      errors.push(details || "expo error");
    }
  }
  // If Expo responded with no tickets array, surface the body
  if (!tickets.length && parsed == null) {
    errors.push(`Unexpected response: ${text.slice(0, 500)}`);
  }
  return {
    okCount,
    errors
  };
}
async function markSentAndLog(supabase, job, deviceCount) {
  const { error: e1 } = await supabase.from("notification_jobs").update({
    status: "sent",
    last_error: null
  }).eq("id", job.id);
  if (e1) throw new Error("markSent: " + e1.message);
  // Write to your existing notifications table (type + payload)
  const payload = {
    ...job.payload ?? {},
    deviceCount,
    jobId: job.id,
    kind: job.kind
  };
  const { error: e2 } = await supabase.from("notifications").insert({
    user_id: job.recipient_user_id,
    type: job.kind,
    payload
  });
  if (e2) throw new Error("logNotification: " + e2.message);
}
async function markFailed(supabase, job, reason) {
  const tooMany = (job.attempts ?? 0) >= MAX_ATTEMPTS;
  const status = tooMany ? "failed" : "pending"; // if too many attempts, stop retrying
  const { error } = await supabase.from("notification_jobs").update({
    status,
    last_error: reason.slice(0, 2000)
  }).eq("id", job.id);
  if (error) throw new Error("markFailed: " + error.message);
}
Deno.serve(async (req)=>{
  try {
    const supabase = getAdminClient();
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(BATCH_LIMIT, Number(url.searchParams.get("limit") ?? BATCH_LIMIT)));
    const jobs = await reserveJobs(supabase, limit);
    const summary = [];
    for (const job of jobs){
      try {
        const devices = await loadDevices(supabase, job.recipient_user_id);
        if (devices.length === 0) {
          await markFailed(supabase, job, "no devices");
          summary.push({
            id: job.id,
            result: "failed",
            reason: "no devices"
          });
          continue;
        }
        const messages = buildExpoMessages(job, devices);
        const { okCount, errors } = await sendExpo(messages);
        if (okCount > 0) {
          await markSentAndLog(supabase, job, devices.length);
          summary.push({
            id: job.id,
            result: "sent",
            okCount,
            deviceCount: devices.length
          });
        } else {
          const reason = errors.length ? errors.join(" | ") : "unknown";
          await markFailed(supabase, job, reason);
          summary.push({
            id: job.id,
            result: "failed",
            errors
          });
        }
      } catch (err) {
        const reason = String(err?.message || err || "unknown");
        await markFailed(supabase, job, reason);
        summary.push({
          id: job.id,
          result: "failed",
          error: reason
        });
      }
    }
    return new Response(JSON.stringify({
      processed: jobs.length,
      summary
    }), {
      headers: {
        "content-type": "application/json"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: String(e?.message || e)
    }), {
      status: 500,
      headers: {
        "content-type": "application/json"
      }
    });
  }
});
