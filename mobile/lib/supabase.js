// mobile/lib/supabase.js
import "react-native-url-polyfill/auto";
import "react-native-get-random-values"; // ensure crypto.getRandomValues exists
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

// --- Secure storage adapter (no requireAuthentication) with graceful error handling ---
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
      // Default SecureStore item, no user presence required
      return await SecureStore.getItemAsync(key);
    } catch (err) {
      // Transient iOS Keychain state (e.g., during app resume/background)
      if (isInteractionNotAllowedError(err)) {
        // Return null so Supabase will just retry on next tick
        return null;
      }
      throw err;
    }
  },
  setItem: async (key, value) => {
    try {
      // Store WITHOUT requireAuthentication to allow background refresh reads
      await SecureStore.setItemAsync(key, value);
    } catch (err) {
      if (isInteractionNotAllowedError(err)) {
        // Retry once shortly after if the app just became active
        // (non-blocking; ignore if it still fails)
        try {
          await SecureStore.setItemAsync(key, value);
        } catch {
          // swallow; Supabase can still operate with in-memory session until next write
        }
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

// --- Create client ---
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true, // keep enabled, but we’ll gate it with AppState
    persistSession: true,
    detectSessionInUrl: false, // no window.location in RN
  },
});

// --- Gate Supabase auto-refresh by app foreground state ---
const startIfActive = (state) => {
  if (state === "active") {
    // Only run refresh ticker when the app is foregrounded
    supabase.auth.startAutoRefresh?.();
  } else {
    supabase.auth.stopAutoRefresh?.();
  }
};

// Initialize based on current state
startIfActive(AppState.currentState);

// Keep in sync with app state changes
AppState.addEventListener("change", (nextState) => {
  startIfActive(nextState);
});
