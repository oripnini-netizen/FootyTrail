import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "../lib/supabase";

WebBrowser.maybeCompleteAuthSession();

// EXACT callback we allow in Supabase (two slashes, no path)
const RETURN_URL = "footytrail://";

export default function LoginScreen() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [workingProvider, setWorkingProvider] = useState(null); // "google" | "apple" | null

  useEffect(() => {
    let mounted = true;
    console.log("[auth] RETURN_URL =", RETURN_URL);

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithProvider = async (provider /* "google" | "apple" */) => {
    try {
      setWorkingProvider(provider);

      // 1) Ask Supabase for the OAuth URL, but DON'T auto-redirect
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

      // 2) Open Safari; it will close when it hits RETURN_URL
      const result = await WebBrowser.openAuthSessionAsync(authUrl, RETURN_URL);
      console.log(`[${provider} login] WebBrowser result:`, result);

      if (result.type !== "success" || !result.url) {
        if (result.type === "cancel" || result.type === "dismiss") {
          console.log(`[${provider} login] user cancelled/dismissed`);
          return;
        }
        throw new Error(`Auth flow did not complete: ${result.type}`);
      }

      // 3) Handle either shape:
      //    a) ?code=...   -> exchangeCodeForSession
      //    b) #access_token=...&refresh_token=... -> setSession
      const urlStr = result.url;

      // Try code flow first
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

      // Fall back to token fragment flow
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
      setWorkingProvider(null);
    }
  };

  const signInWithGoogle = () => signInWithProvider("google");
  const signInWithApple  = () => signInWithProvider("apple");

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
        <ActivityIndicator />
        <Text>Checking session…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 24 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Login</Text>

      {session ? (
        <>
          <Text style={{ textAlign: "center" }}>
            Signed in as{"\n"}
            <Text style={{ fontWeight: "700" }}>{session.user.email || session.user.id}</Text>
          </Text>

          <Pressable
            onPress={async () => {
              await supabase.auth.signOut();
            }}
            style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#000" }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Sign out</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={{ textAlign: "center", color: "#6b7280" }}>
            Not signed in yet. Use Google or Apple to continue.
          </Text>

          {/* Google */}
          <Pressable
            disabled={!!workingProvider}
            onPress={signInWithGoogle}
            style={{
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderRadius: 12,
              backgroundColor: "#1a73e8",
              opacity: workingProvider ? 0.6 : 1,
              width: "100%",
              maxWidth: 320,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>
              {workingProvider === "google" ? "Opening Google…" : "Sign in with Google"}
            </Text>
          </Pressable>

          {/* Apple */}
          <Pressable
            disabled={!!workingProvider}
            onPress={signInWithApple}
            style={{
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderRadius: 12,
              backgroundColor: "#000",
              opacity: workingProvider ? 0.6 : 1,
              width: "100%",
              maxWidth: 320,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>
              {workingProvider === "apple" ? "Opening Apple…" : "Sign in with Apple"}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
