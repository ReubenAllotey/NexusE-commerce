const originalFetch = globalThis.fetch;
const logPath = process.env.BREVO_MOCK_LOG || "/tmp/nexus-brevo-mock.ndjson";

globalThis.fetch = async (input, init) => {
  if (String(input) !== "https://api.brevo.com/v3/smtp/email") {
    return originalFetch(input, init);
  }

  const body = JSON.parse(init?.body || "{}");
  const fs = await import("node:fs/promises");
  await fs.appendFile(logPath, `${JSON.stringify({
    recipient: body.to?.[0]?.email || null,
    subject: body.subject || null,
    containsShippingLink: /purpose=shipping-balance[^\s"&]*(?:&amp;|&)token=/.test(`${body.textContent || ""} ${body.htmlContent || ""}`),
    containsSyntheticProduct: /Synthetic Test 2/.test(`${body.textContent || ""} ${body.htmlContent || ""}`),
  })}\n`);
  return new Response(JSON.stringify({ messageId: `synthetic-brevo-${Date.now()}` }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
};
