// mobile/lib/registerForPush.js
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// Show alerts in foreground (optional)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function getProjectId() {
  // Works on SDK 50+: try both locations
  const fromExtra = Constants?.expoConfig?.extra?.eas?.projectId;
  const fromEas = Constants?.easConfig?.projectId;
  return fromExtra || fromEas || null;
}

export async function registerForPushNotificationsAsync() {
  try {
    if (!Device.isDevice) {
      console.log("Push notifications require a physical device.");
      return null;
    }

    // Permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      console.log("Notification permission not granted.");
      return null;
    }

    // Get Expo push token — MUST pass projectId on SDK 50+
    const projectId = getProjectId();
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const pushToken = tokenResp.data;

    // Current user
    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) {
      console.log("Not logged in; skipping device registration.");
      return pushToken;
    }

    // Save device
    const platform = Platform.OS; // 'ios' | 'android'
    const { error } = await supabase.from("user_devices").upsert(
      {
        user_id: user.id,
        push_token: pushToken,
        platform
      },
      { onConflict: "push_token" }
    );
    if (error) console.log("user_devices upsert error:", error.message);

    console.log("✅ Registered push token:", pushToken);
    return pushToken;
  } catch (err) {
    // If the native module isn’t present, we’ll end up here.
    console.log("registerForPushNotificationsAsync failed:", String(err?.message || err));
    return null;
  }
}
