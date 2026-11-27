import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.SHIPPING_CREDIT_HARNESS_URL || "http://127.0.0.1:4176/browser-tests/shipping-credit-dashboard-index.html";
const cdpPort = process.env.SHIPPING_CREDIT_HARNESS_CDP_PORT || "9238";
const viewport = process.env.SHIPPING_CREDIT_HARNESS_VIEWPORT || "desktop";
const caseName = process.env.SHIPPING_CREDIT_HARNESS_CASE || "credit-dashboard";
const sizes = { desktop: [1440, 900], mobile: [390, 844] };
let nextId = 1;

function call(socket, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => reject(new Error(`Timed out calling ${method}`)), 10000);
    const listener = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", listener);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
const browserSocket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { browserSocket.addEventListener("open", resolve, { once: true }); browserSocket.addEventListener("error", reject, { once: true }); });
const context = await call(browserSocket, "Target.createBrowserContext");
const target = await call(browserSocket, "Target.createTarget", { browserContextId: context.browserContextId, url: `${baseUrl}?case=${caseName}` });
let targetInfo;
for (let attempt = 0; attempt < 50 && !targetInfo; attempt += 1) {
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  targetInfo = targets.find((entry) => entry.id === target.targetId);
  if (!targetInfo) await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!targetInfo) throw new Error(`Unable to find browser target ${target.targetId}`);
const socket = new WebSocket(targetInfo.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
const [width, height] = sizes[viewport] || sizes.desktop;
await call(socket, "Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: viewport === "mobile", screenWidth: width, screenHeight: height });
await call(socket, "Runtime.enable");
await call(socket, "Page.enable");
await call(socket, "Network.enable");
await call(socket, "Log.enable");
const errors = [];
const failedRequests = [];
const requestUrls = new Map();
const ignoredExternalHosts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    const details = message.params.exceptionDetails || {};
    errors.push(details.exception?.description || details.text || "uncaught exception");
  }
  if (message.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(message.params.type)) {
    const text = message.params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") || "console error";
    if (!text.startsWith("Failed to load resource:")) errors.push(text);
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error" && !message.params.entry.text.startsWith("Failed to load resource:")) errors.push(message.params.entry.text);
  if (message.method === "Network.requestWillBeSent") requestUrls.set(message.params.requestId, message.params.request.url);
  if (message.method === "Network.loadingFailed") {
    const url = requestUrls.get(message.params.requestId) || "unknown URL";
    if (!ignoredExternalHosts.has(new URL(url).hostname)) failedRequests.push(`${message.params.type || "request"}: ${message.params.errorText} (${url})`);
  }
  if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
    const url = message.params.response.url;
    if (!ignoredExternalHosts.has(new URL(url).hostname)) failedRequests.push(`${message.params.response.status} ${url}`);
  }
});
let report;
for (let i = 0; i < 150; i += 1) {
  const value = await call(socket, "Runtime.evaluate", { expression: "document.querySelector('#harness-result')?.textContent || ''", returnByValue: true });
  if (value?.result?.value) { report = JSON.parse(value.result.value); break; }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!report) {
  const page = await call(socket, "Runtime.evaluate", {
    expression: "JSON.stringify({ url: location.href, readyState: document.readyState, bodyText: document.body?.innerText || '', html: document.documentElement?.outerHTML?.slice(0, 4000) || '' })",
    returnByValue: true,
  });
  const screenshot = await call(socket, "Page.captureScreenshot", { format: "png" });
  const screenshotPath = path.join(os.tmpdir(), `nexus-shipping-credit-dashboard-timeout-${viewport}.png`);
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  console.error(JSON.stringify({
    error: "Timed out waiting for dashboard harness result",
    diagnostics: JSON.parse(page.result.value),
    consoleErrors: errors,
    failedRequests,
    screenshotPath,
  }, null, 2));
  process.exitCode = 1;
  process.exit();
}
const screenshot = await call(socket, "Page.captureScreenshot", { format: "png" });
const screenshotPath = path.join(os.tmpdir(), `nexus-shipping-credit-dashboard-${viewport}.png`);
fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
report.viewport = viewport;
report.screenshotPath = screenshotPath;
report.consoleErrors = errors;
report.failedRequests = failedRequests;
console.log(JSON.stringify(report, null, 2));
if (report.results.some((result) => !result.passed) || errors.length) process.exitCode = 1;
