import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const password = "Synthetic-CI-Only-Password-2026!";
const suffix = Date.now().toString(36);
const adminEmail = `ci-admin-${suffix}@example.invalid`;
const registeredEmail = `ci-customer-${suffix}@example.invalid`;

async function createUser(email) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { account_type: "registered" },
  });
  if (error) throw error;
  return data.user;
}

const admin = await createUser(adminEmail);
const registered = await createUser(registeredEmail);
const { error } = await supabase
  .from("profiles")
  .update({ role: "admin", status: "active", account_type: "registered", full_name: "Synthetic CI Administrator" })
  .eq("id", admin.id);
if (error) throw error;

console.log(`CI_ADMIN_EMAIL=${adminEmail}`);
console.log(`CI_REGISTERED_EMAIL=${registeredEmail}`);
console.log(`CI_ADMIN_USER_ID=${admin.id}`);
console.log(`CI_REGISTERED_USER_ID=${registered.id}`);
console.log(`CI_TEST_PASSWORD=${password}`);
