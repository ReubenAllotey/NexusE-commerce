import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.SHIPPING_ADJUSTMENT_HARNESS_URL || "http://127.0.0.1:4176/browser-tests/shipping-adjustment-index.html";
const cdpPort = process.env.SHIPPING_ADJUSTMENT_HARNESS_CDP_PORT || "9238";
const viewport = process.env.SHIPPING_ADJUSTMENT_HARNESS_VIEWPORT || "desktop";
const sizes = { desktop: [1440, 900], tablet: [768, 1024], mobile: [390, 844] };
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

async function targetSocket(browserSocket, targetId) {
  for (let i = 0; i < 60; i += 1) {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const target = targets.find((entry) => entry.id === targetId);
    if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out locating shipping adjustment harness target");
}

const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
const browserSocket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { browserSocket.addEventListener("open", resolve, { once: true }); browserSocket.addEventListener("error", reject, { once: true }); });
const context = await call(browserSocket, "Target.createBrowserContext");
const target = await call(browserSocket, "Target.createTarget", { browserContextId: context.browserContextId, url: `${baseUrl}?case=shipping-adjustment` });
const socket = new WebSocket(await targetSocket(browserSocket, target.targetId));
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
const [width, height] = sizes[viewport] || sizes.desktop;
await call(socket, "Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: viewport === "mobile", screenWidth: width, screenHeight: height });
await call(socket, "Page.enable");
await call(socket, "Runtime.enable");
const consoleErrors = [];
socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (message.method === "Runtime.exceptionThrown") consoleErrors.push("uncaught exception"); });
let report;
for (let i = 0; i < 150; i += 1) {
  const value = await call(socket, "Runtime.evaluate", { expression: "document.querySelector('#harness-result')?.textContent || ''", returnByValue: true });
  if (value?.result?.value) { report = JSON.parse(value.result.value); break; }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!report) throw new Error("Timed out waiting for harness result");
const screenshot = await call(socket, "Page.captureScreenshot", { format: "png" });
const screenshotPath = path.join(os.tmpdir(), `nexus-shipping-adjustment-${viewport}.png`);
fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
report.viewport = viewport;
report.screenshotPath = screenshotPath;
report.consoleErrors = consoleErrors;
console.log(JSON.stringify(report, null, 2));
if (report.results.some((result) => !result.passed) || consoleErrors.length) process.exitCode = 1;
socket.close();
browserSocket.close();
