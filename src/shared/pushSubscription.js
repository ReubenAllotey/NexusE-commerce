import { supabase } from "../lib/supabaseClient";

function base64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error(error?.message || "Please sign in again to manage notifications.");
  }
  return data.session.access_token;
}

export function getPushSupport() {
  return {
    supported:
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window,
    isIos: typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent),
  };
}

export async function enablePushNotifications() {
  const support = getPushSupport();
  if (!support.supported) {
    return { ok: false, reason: "unsupported", message: "Push notifications are not supported in this browser." };
  }

  if (Notification.permission === "denied") {
    return { ok: false, reason: "blocked", message: "Notifications are blocked in your browser settings." };
  }

  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();

  if (permission !== "granted") {
    return { ok: false, reason: "denied", message: "Notification permission was not granted." };
  }

  const token = await getAccessToken();
  const keyResponse = await fetch("/api/push/public-key");
  const keyPayload = await keyResponse.json().catch(() => ({}));
  if (!keyResponse.ok || !keyPayload?.publicKey) {
    throw new Error(keyPayload?.message || "Push notifications are not configured yet.");
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64ToUint8Array(keyPayload.publicKey),
  });
  const subscriptionJson = subscription.toJSON();
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      endpoint: subscriptionJson.endpoint,
      keys: subscriptionJson.keys,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || "Unable to save notification settings.");
  }

  return { ok: true, subscription };
}

export async function disablePushNotifications() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: true };
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return { ok: true };
  }

  const token = await getAccessToken();
  const response = await fetch("/api/push/unsubscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || "Unable to disable notifications.");
  }
  await subscription.unsubscribe();
  return { ok: true };
}
