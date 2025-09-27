// supabase/functions/send-push/index.ts
// Deno Edge Function: process pending notification_jobs and send Expo pushes.
// Uses service-role Supabase client via env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
/// <reference types="https://esm.sh/@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const BATCH_LIMIT = 100;
const MAX_ATTEMPTS = 5;
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
  // Use payload.navigateTo if present, otherwise set a simple default
  const navigateTo = job.payload?.navigateTo || "/elimination";
  // IMPORTANT: top-level sound, not boolean, not inside data
  // Fall back to your custom file if caller didn't set one
  const soundName = typeof job?.payload?.sound === "string" && job.payload.sound.trim().length > 0 ? job.payload.sound : "who_are_ya.wav";
  // Preserve all original payload fields in data, but DO NOT put `sound` there
  const data = {
    ...job.payload ?? {},
    navigateTo,
    jobId: job.id,
    kind: job.kind,
    tournamentId: job.tournament_id
  };
  delete data.sound; // ensure sound is only top-level
  return devices.map((d)=>({
      to: d.push_token,
      title,
      body,
      sound: soundName,
      channelId: "default",
      priority: "high",
      data
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
      "content-type": "application/json"
    },
    body: JSON.stringify(messages)
  });
  let json = {};
  try {
    json = await res.json();
  } catch  {
  // ignore parse errors; treat as failure
  }
  const tickets = Array.isArray(json?.data) ? json.data : [];
  let okCount = 0;
  const errors = [];
  for (const t of tickets){
    if (t?.status === "ok") okCount++;
    else if (t?.status === "error") errors.push(String(t?.message || "expo error"));
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
