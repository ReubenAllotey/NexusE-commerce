import { pathToFileURL } from "node:url";

const DEFAULT_WORKER_URL = "https://nexuse-commerce.onrender.com/internal/email-queue/worker";
const REQUEST_TIMEOUT_MS = 15_000;
const TRUSTED_WORKER_HOST = "nexuse-commerce.onrender.com";

function clean(value) {
  return String(value ?? "").trim();
}

export async function runEmailQueueRecovery({
  fetchImpl = globalThis.fetch,
  workerUrl = process.env.EMAIL_QUEUE_WORKER_URL || DEFAULT_WORKER_URL,
  workerSecret = process.env.EMAIL_QUEUE_WORKER_SECRET,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const url = clean(workerUrl);
  const secret = clean(workerSecret);
  if (!url || !secret) {
    throw new Error("Email queue recovery requires a worker URL and worker secret.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Email queue recovery requires fetch support.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Email queue recovery requires a valid HTTPS worker URL.");
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== TRUSTED_WORKER_HOST) {
    throw new Error("Email queue recovery worker URL is not trusted.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ source: "scheduled_recovery" }),
      signal: controller.signal,
    });

    if (!response || !response.ok) {
      throw new Error(`Email queue worker returned HTTP ${response?.status ?? "no response"}.`);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error("Email queue worker returned malformed JSON.");
    }
    if (!body || body.ok !== true) {
      throw new Error("Email queue worker returned an invalid success response.");
    }

    return { ok: true, status: response.status, processed: Number(body.processed) || 0 };
  } finally {
    clearTimeout(timeout);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEmailQueueRecovery()
    .then((result) => {
      console.info(`Email queue recovery worker invoked: HTTP ${result.status}.`);
    })
    .catch((error) => {
      console.error(error.message || "Email queue recovery failed.");
      process.exitCode = 1;
    });
}
