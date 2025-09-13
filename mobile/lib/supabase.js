// mobile/lib/supabase.js
import "react-native-url-polyfill/auto";
import "react-native-get-random-values"; // ensures crypto.getRandomValues exists in RN
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";

/**
 * IMPORTANT: replace with your real project values
 *  - SUPABASE_URL:     https://<project-ref>.supabase.co
 *  - SUPABASE_ANON_KEY: anon public key from Supabase
 */
const SUPABASE_URL = "https://ehbgvsehskwxkbhjclib.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoYmd2c2Voc2t3eGtiaGpjbGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ1OTkyMDUsImV4cCI6MjA3MDE3NTIwNX0.EKpWliku93MYoutd5izYsLdphppEXEN7H2dRo4THups";

/* -------------------------
 * Secure storage adapter
 * ------------------------- */
const isInteractionNotAllowedError = (err) => {
  const msg = String(err?.message || err || "");
  return (
    msg.includes("User interaction is not allowed") ||
    msg.includes("E_SECURESTORE_USER_INTERACTION_NOT_ALLOWED") ||
    msg.includes("errSecInteractionNotAllowed")
  );
};

const SecureStoreAdapter = {
  getItem: async (key) => {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (err) {
      if (isInteractionNotAllowedError(err)) return null;
      throw err;
    }
  },
  setItem: async (key, value) => {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (err) {
      if (isInteractionNotAllowedError(err)) {
        try {
          await SecureStore.setItemAsync(key, value);
        } catch {}
        return;
      }
      throw err;
    }
  },
  removeItem: async (key) => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (err) {
      if (isInteractionNotAllowedError(err)) return;
      throw err;
    }
  },
};

/* -------------------------
 * Supabase client
 * ------------------------- */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/* Gate auto refresh by app foreground state */
const startIfActive = (state) => {
  if (state === "active") supabase.auth.startAutoRefresh?.();
  else supabase.auth.stopAutoRefresh?.();
};
startIfActive(AppState.currentState);
AppState.addEventListener("change", (next) => startIfActive(next));

/* -------------------------
 * Small UUID v4 helper (no crypto.randomUUID in RN)
 * ------------------------- */
function uuidv4() {
  const bytes = new Uint8Array(16);
  // react-native-get-random-values provides this:
  global.crypto?.getRandomValues?.(bytes);
  // Per RFC 4122:
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

/* -------------------------
 * Storage helpers
 * ------------------------- */
const AVATARS_BUCKET = "avatars";

const getExt = (input) => {
  if (!input) return "jpg";
  try {
    const clean = String(input).split("?")[0];
    const dot = clean.lastIndexOf(".");
    if (dot === -1) return "jpg";
    const ext = clean.slice(dot + 1).toLowerCase();
    return ext && ext.length <= 5 ? ext : "jpg";
  } catch {
    return "jpg";
  }
};

/**
 * Upload an image picked with expo-image-picker to the "avatars" bucket
 * and return a public URL.
 *
 * @param {{ uri: string, fileName?: string }} asset
 * @returns {Promise<string>} public URL
 */
export async function uploadAvatar(asset) {
  if (!asset?.uri) throw new Error("No file selected");

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id || "anon";

  const ext = getExt(asset.fileName || asset.uri);
  const key = `${userId}/${uuidv4()}.${ext}`;

  const res = await fetch(asset.uri);
  const blob = await res.blob();

  const { error } = await supabase.storage
    .from(AVATARS_BUCKET) // ensure a bucket named "avatars" exists
    .upload(key, blob, {
      cacheControl: "3600",
      upsert: true,
      contentType: blob.type || "image/jpeg",
    });

  if (error) throw new Error(error.message || "Avatar upload failed");

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(key);
  return data.publicUrl;
}
