const STATIC_CACHE = "nexus-static-v1";

function safeNotificationUrl(value) {
  try {
    const parsed = new URL(value || "/profile/notifications", self.location.origin);
    if (parsed.origin !== self.location.origin || !parsed.pathname.startsWith("/")) {
      return "/profile/notifications";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/profile/notifications";
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() || "You have a new Nexus notification." };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Nexus Import Hub", {
      body: payload.body || "You have a new Nexus notification.",
      icon: payload.icon || "/nexus-pwa-192.png",
      badge: payload.badge || "/nexus-pwa-192.png",
      data: { url: safeNotificationUrl(payload.url) },
      tag: payload.tag || "nexus-notification-unknown",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(safeNotificationUrl(event.notification.data?.url), self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const existingClient = clientList.find((client) => "focus" in client);
      if (existingClient) {
        existingClient.navigate(targetUrl);
        return existingClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (["document", "fetch"].includes(request.destination) || url.pathname.startsWith("/api/")) {
    return;
  }

  if (!["script", "style", "image", "font"].includes(request.destination)) {
    return;
  }

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);

      if (cached) {
        return cached;
      }

      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
