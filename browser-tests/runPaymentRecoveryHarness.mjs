const baseUrl = process.env.PAYMENT_HARNESS_URL || "http://127.0.0.1:4174/browser-tests/index.html";
const cdpPort = process.env.PAYMENT_HARNESS_CDP_PORT || "9237";

let nextCdpId = 1;

function cdpCall(socket, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextCdpId++;
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", handleMessage);
      reject(new Error(`Timed out calling ${method}.`));
    }, 10000);
    const handleMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", handleMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    socket.addEventListener("message", handleMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function waitForPageTarget(targetId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const target = targets.find((entry) => entry.id === targetId);
    if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out locating browser target ${targetId}.`);
}

async function runScenario(browserSocket, scenario) {
  const context = await cdpCall(browserSocket, "Target.createBrowserContext");
  const target = await cdpCall(browserSocket, "Target.createTarget", {
    browserContextId: context.browserContextId,
    url: `${baseUrl}?case=${encodeURIComponent(scenario)}`,
  });
  const pageSocket = new WebSocket(await waitForPageTarget(target.targetId));
  await new Promise((resolve, reject) => {
    pageSocket.addEventListener("open", resolve, { once: true });
    pageSocket.addEventListener("error", reject, { once: true });
  });

  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const result = await cdpCall(pageSocket, "Runtime.evaluate", {
        expression: "document.querySelector('#harness-result')?.textContent || ''",
        returnByValue: true,
      });
      if (result?.result?.value) return JSON.parse(result.result.value);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${scenario} harness result.`);
  } finally {
    pageSocket.close();
    await cdpCall(browserSocket, "Target.disposeBrowserContext", {
      browserContextId: context.browserContextId,
    });
  }
}

const scenarios = [
  "auth-return",
  "already-authenticated",
  "authenticated-invalid-bearer",
  "valid-guest-token",
  "expired-guest-token",
  "incorrect-account",
  "already-paid",
  "pending-payment",
  "duplicate-payment",
  "order-balance",
  "standard-guest-no-address",
  "standard-guest-valid",
  "refresh-login",
  "external-return",
  "failed-auth",
  "repeated-401",
];

const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
const browserSocket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  browserSocket.addEventListener("open", resolve, { once: true });
  browserSocket.addEventListener("error", reject, { once: true });
});

try {
  const reports = [];
  for (const scenario of scenarios) {
    const report = await runScenario(browserSocket, scenario);
    const failed = report.results.filter((result) => !result.passed);
    reports.push({ scenario, passed: failed.length === 0, failed });
  }
  console.log(JSON.stringify({ scenarios: reports }, null, 2));
  if (reports.some((report) => !report.passed)) process.exitCode = 1;
} finally {
  browserSocket.close();
}
