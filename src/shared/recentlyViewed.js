const STORAGE_KEY = "nexus:recently-viewed";
const CHANGE_EVENT = "nexus:recently-viewed-change";
const MAX_RECENTLY_VIEWED = 12;

function isBrowser() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function normalizeEntry(entry) {
  if (typeof entry === "string" || typeof entry === "number") {
    const productId = String(entry).trim();
    return productId ? { productId, viewedAt: null } : null;
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const productId = String(entry.productId ?? entry.product_id ?? entry.id ?? "").trim();
  return productId ? { productId, viewedAt: entry.viewedAt ?? entry.viewed_at ?? null } : null;
}

function readEntries() {
  if (!isBrowser()) {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seen = new Set();
    return parsed
      .map(normalizeEntry)
      .filter((entry) => {
        if (!entry || seen.has(entry.productId)) {
          return false;
        }

        seen.add(entry.productId);
        return true;
      })
      .slice(0, MAX_RECENTLY_VIEWED);
  } catch {
    return [];
  }
}

function publish(entries) {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: entries }));
  } catch {
    // Browsers can deny storage access; recently viewed is non-critical.
  }
}

export function getRecentlyViewed() {
  return readEntries();
}

export function recordRecentlyViewed(productId) {
  const normalizedId = String(productId ?? "").trim();
  if (!normalizedId) {
    return readEntries();
  }

  const entries = readEntries().filter((entry) => entry.productId !== normalizedId);
  const nextEntries = [
    { productId: normalizedId, viewedAt: new Date().toISOString() },
    ...entries,
  ].slice(0, MAX_RECENTLY_VIEWED);
  publish(nextEntries);
  return nextEntries;
}

export function pruneRecentlyViewed(validProductIds) {
  const validIds = new Set(
    (Array.isArray(validProductIds) ? validProductIds : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean),
  );
  const entries = readEntries();
  const nextEntries = entries.filter((entry) => validIds.has(entry.productId));

  if (nextEntries.length !== entries.length) {
    publish(nextEntries);
  }

  return nextEntries;
}

export function subscribeToRecentlyViewed(listener) {
  if (!isBrowser() || typeof listener !== "function") {
    return () => {};
  }

  const handleChange = (event) => {
    if (event.type === "storage" && event.key !== STORAGE_KEY) {
      return;
    }

    listener(getRecentlyViewed());
  };

  window.addEventListener(CHANGE_EVENT, handleChange);
  window.addEventListener("storage", handleChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handleChange);
    window.removeEventListener("storage", handleChange);
  };
}
