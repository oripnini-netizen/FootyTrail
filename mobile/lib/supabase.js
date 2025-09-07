// mobile/lib/supabase.js
import "react-native-url-polyfill/auto";
import "react-native-get-random-values"; // <-- ensure crypto.getRandomValues exists
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";

/**
 * IMPORTANT: replace with your real project values
 *  - SUPABASE_URL:     https://<project-ref>.supabase.co
 *  - SUPABASE_ANON_KEY: anon public key from Supabase
 */
const SUPABASE_URL = "https://ehbgvsehskwxkbhjclib.supabase.co"; 
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoYmd2c2Voc2t3eGtiaGpjbGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ1OTkyMDUsImV4cCI6MjA3MDE3NTIwNX0.EKpWliku93MYoutd5izYsLdphppEXEN7H2dRo4THups";            

// Persist session using Expo Secure Store
const SecureStoreAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // no window.location in RN
  },
});
