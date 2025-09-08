import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "../lib/supabase";

WebBrowser.maybeCompleteAuthSession();

// EXACT callback we allow in Supabase (two slashes, no path)
const RETURN_URL = "footytrail://";

export default function LoginScreen() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  // UI state
  const [busyProvider, setBusyProvider] = useState(null); // "google" | "apple" | null
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    console.log("[auth] RETURN_URL =", RETURN_URL);

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ---- OAuth (Google / Apple) – reuses your working browser flow ----
  const signInWithProvider = async (provider /* "google" | "apple" */) => {
    try {
      setBusyProvider(provider);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: RETURN_URL,
          skipBrowserRedirect: true,
          flowType: "pkce",
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;

      const authUrl = data?.url;
      if (!authUrl) throw new Error(`Could not get ${provider} auth URL from Supabase.`);
      console.log(`[${provider} login] opening`, authUrl);

      const result = await WebBrowser.openAuthSessionAsync(authUrl, RETURN_URL);
      console.log(`[${provider} login] WebBrowser result:`, result);

      if (result.type !== "success" || !result.url) {
        if (result.type === "cancel" || result.type === "dismiss") {
          console.log(`[${provider} login] user cancelled/dismissed`);
          return;
        }
        throw new Error(`Auth flow did not complete: ${result.type}`);
      }

      const urlStr = result.url;

      // Try code flow first (?code=...)
      let code = null;
      try {
        const u = new URL(urlStr);
        code = u.searchParams.get("code");
      } catch {
        // ignore custom scheme parse errors
      }
      if (code) {
        console.log(`[${provider} login] parsed code:`, code);
        const { error: exErr } = await supabase.auth.exchangeCodeForSession({
          authCode: code,
          redirectTo: RETURN_URL,
        });
        if (exErr) throw exErr;
        console.log(`[${provider} login] session exchange success (code)`);
        return;
      }

      // Fall back to token fragment flow (#access_token=...&refresh_token=...)
      const hashIndex = urlStr.indexOf("#");
      if (hashIndex !== -1 && hashIndex < urlStr.length - 1) {
        const fragment = urlStr.slice(hashIndex + 1);
        const params = new URLSearchParams(fragment);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        const errDesc = params.get("error_description");

        console.log(`[${provider} login] fragment tokens:`, {
          hasAccessToken: !!access_token,
          hasRefreshToken: !!refresh_token,
          error: errDesc,
        });

        if (access_token && refresh_token) {
          const { error: setErr } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (setErr) throw setErr;
          console.log(`[${provider} login] session set success (token)`);
          return;
        }

        if (errDesc) throw new Error("Auth error: " + errDesc);
      }

      throw new Error("No auth code or tokens returned.");
    } catch (err) {
      console.error(`[${provider} login] error`, err);
      Alert.alert("Sign-in error", err.message || String(err));
    } finally {
      setBusyProvider(null);
    }
  };

  // ---- Email/Password ----
  const handleEmailSignin = async () => {
    try {
      setSubmitting(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });
      if (error) throw error;
      // onAuthStateChange will handle redirect (layout gate)
    } catch (e) {
      Alert.alert("Sign-in failed", e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailSignup = async () => {
    try {
      setSubmitting(true);
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password: password.trim(),
        options: {
          data: { full_name: fullName.trim() || undefined },
          // You can add emailRedirectTo here if you want a web link:
          // emailRedirectTo: "https://your-web-app/login"
        },
      });
      if (error) throw error;
      Alert.alert("Almost there", "Check your email to confirm your account.");
    } catch (e) {
      Alert.alert("Sign-up failed", e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  // If already signed in, just show a quick message (layout will redirect away)
  if (session) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Already signed in…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#f0fdf4" /* light green like web */ }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
          {/* Card */}
          <View
            style={{
              width: 360,
              maxWidth: "100%",
              backgroundColor: "#fff",
              padding: 20,
              borderRadius: 16,
              shadowColor: "#000",
              shadowOpacity: 0.12,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 4,
            }}
          >
            {/* Logo */}
            <View style={{ alignItems: "center", marginBottom: 12 }}>
              <Image
                source={require("../assets/images/footytrail_logo.png")}
                style={{ width: 64, height: 64, borderRadius: 14 }}
                resizeMode="contain"
              />
              <Text style={{ marginTop: 8, fontSize: 22, fontWeight: "800" }}>FootyTrail</Text>
              <Text style={{ marginTop: 2, color: "#6b7280" }}>Sign in to continue</Text>
            </View>

            {/* OAuth Buttons */}
            <Pressable
              disabled={!!busyProvider}
              onPress={() => signInWithProvider("google")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingVertical: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#d1d5db",
                backgroundColor: "#fff",
                opacity: busyProvider ? 0.6 : 1,
                marginBottom: 10,
              }}
            >
              <Image
  source={require("../assets/images/google.png")}
  style={{ width: 18, height: 18 }}
  resizeMode="contain"
/>

              <Text style={{ fontWeight: "600" }}>
                {busyProvider === "google" ? "Opening Google…" : "Continue with Google"}
              </Text>
            </Pressable>

            <Pressable
              disabled={!!busyProvider}
              onPress={() => signInWithProvider("apple")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingVertical: 12,
                borderRadius: 10,
                backgroundColor: "#000",
                opacity: busyProvider ? 0.6 : 1,
                marginBottom: 14,
              }}
            >
              <Image
                source={{
                  uri: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Apple_logo_black.svg/120px-Apple_logo_black.svg.png",
                }}
                style={{ width: 18, height: 18, tintColor: "#fff" }}
              />
              <Text style={{ color: "#fff", fontWeight: "700" }}>
                {busyProvider === "apple" ? "Opening Apple…" : "Sign in with Apple"}
              </Text>
            </Pressable>

            {/* Divider */}
            <View style={{ alignItems: "center", marginVertical: 6 }}>
              <Text style={{ color: "#9ca3af" }}>or</Text>
            </View>

            {/* Email/Password */}
            {mode === "signup" && (
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                placeholder="Full name"
                autoCapitalize="words"
                style={inputStyle}
              />
            )}
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              style={inputStyle}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              autoCapitalize="none"
              style={inputStyle}
            />

            <Pressable
              disabled={submitting}
              onPress={mode === "signin" ? handleEmailSignin : handleEmailSignup}
              style={{
                paddingVertical: 12,
                borderRadius: 10,
                backgroundColor: mode === "signin" ? "#16a34a" : "#2563eb",
                alignItems: "center",
                opacity: submitting ? 0.7 : 1,
                marginTop: 4,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>
                {submitting ? (mode === "signin" ? "Signing in…" : "Creating account…") : mode === "signin" ? "Sign in" : "Sign up"}
              </Text>
            </Pressable>

            {/* Toggle Sign in / Sign up */}
            <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 12 }}>
              {mode === "signin" ? (
                <Text>
                  New here?{" "}
                  <Text
                    onPress={() => setMode("signup")}
                    style={{ color: "#2563eb", fontWeight: "700" }}
                  >
                    Create an account
                  </Text>
                </Text>
              ) : (
                <Text>
                  Already have an account?{" "}
                  <Text
                    onPress={() => setMode("signin")}
                    style={{ color: "#2563eb", fontWeight: "700" }}
                  >
                    Sign in
                  </Text>
                </Text>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const inputStyle = {
  width: "100%",
  paddingVertical: 12,
  paddingHorizontal: 12,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: "#d1d5db",
  marginBottom: 10,
  backgroundColor: "#fff",
};
