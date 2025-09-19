// mobile/lib/notifications.js
import * as Notifications from "expo-notifications";

// Foreground behavior (optional but nice)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Wire navigation for notification taps.
 * Expects push payloads to contain `data.navigateTo`, e.g. { navigateTo: "/elimination" }
 */
export function setupNotificationNavigation(router) {
  // Handle taps when the app is already running (foreground/background)
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    try {
      const nav = response?.notification?.request?.content?.data?.navigateTo;
      if (typeof nav === "string" && nav.length > 0) {
        // Small delay so router is definitely mounted
        setTimeout(() => router.push(nav), 0);
      }
    } catch {}
  });

  // Handle cold starts (user tapped a notification to open the app from "killed")
  (async () => {
    try {
      const last = await Notifications.getLastNotificationResponseAsync();
      const nav = last?.notification?.request?.content?.data?.navigateTo;
      if (typeof nav === "string" && nav.length > 0) {
        // Give expo-router a tick to mount the tree
        setTimeout(() => router.push(nav), 0);
      }
    } catch {}
  })();

  return () => {
    try {
      sub?.remove?.();
    } catch {}
  };
}
