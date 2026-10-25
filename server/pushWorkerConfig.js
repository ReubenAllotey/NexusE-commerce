const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function isPushQueueEnabled() {
  return ENABLED_VALUES.has(String(process.env.PUSH_QUEUE_ENABLED ?? "").trim().toLowerCase());
}
