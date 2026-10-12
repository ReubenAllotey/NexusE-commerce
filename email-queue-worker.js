const endpoint =
  "https://nexuse-commerce.onrender.com/internal/email-queue/worker";

async function run() {
  const secret = process.env.EMAIL_QUEUE_WORKER_SECRET;

  if (!secret) {
    throw new Error("EMAIL_QUEUE_WORKER_SECRET is missing");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Email worker failed: HTTP ${response.status}`);
  }

  console.log("Email queue worker completed successfully");
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
