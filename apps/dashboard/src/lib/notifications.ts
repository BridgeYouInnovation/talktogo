import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function registerServiceWorker(): void {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[TalkToGo] service worker registration failed:", err);
    });
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Subscribe this browser to Web Push and store the subscription so the
// send-push edge function can reach it even when the app is closed.
export async function subscribeToPush(userId: string): Promise<"ok" | "no-permission" | "unsupported" | "no-vapid" | "error"> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (!VAPID_PUBLIC_KEY) return "no-vapid";

  const granted = await ensureNotificationPermission();
  if (!granted) return "no-permission";

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }
    const json = subscription.toJSON();
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        subscription: json,
      },
      { onConflict: "user_id,endpoint" }
    );
    if (error) {
      console.warn("[TalkToGo] failed to save push subscription:", error.message);
      return "error";
    }
    return "ok";
  } catch (err) {
    console.warn("[TalkToGo] push subscribe failed:", err);
    return "error";
  }
}

// Local notification while the app is open (works even without VAPID setup).
// Uses the same tag scheme as the push payload so a local and a pushed
// notification for the same event coalesce instead of doubling up.
export async function notifyLocal(title: string, body: string, url: string): Promise<void> {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      data: { url },
      tag: url,
    });
  } catch {
    try {
      new Notification(title, { body });
    } catch {
      /* notifications unavailable */
    }
  }
}

// Ask the server to send a real push round-trip to this user's devices —
// proves the whole pipeline (subscription → server → push service → SW).
export async function sendTestPush(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  try {
    const res = await fetch("/api/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: "test" }),
    });
    const json = await res.json();
    return (json.sent ?? 0) > 0;
  } catch {
    return false;
  }
}
