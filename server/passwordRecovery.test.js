import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const login = fs.readFileSync(path.join(root, "src", "pages", "register", "login.jsx"), "utf8");
const recovery = fs.readFileSync(path.join(root, "src", "pages", "register", "ForgotPassword.jsx"), "utf8");
const setup = fs.readFileSync(path.join(root, "src", "pages", "register", "PasswordSetup.jsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");

test("login links to the dedicated forgot-password route", () => {
  assert.match(login, /<Link to="\/register\/forgot-password">Forgot password\?<\/Link>/);
});

test("forgot-password requests Supabase Auth recovery with the existing setup route", () => {
  assert.match(recovery, /supabase\.auth\.resetPasswordForEmail\(normalizedEmail/);
  assert.match(recovery, /redirectTo: `\$\{window\.location\.origin\}\/account\/set-password`/);
  assert.match(recovery, /If an account exists for that email/);
});

test("forgot-password validates input, throttles resend requests, and avoids token logging", () => {
  assert.match(recovery, /RESEND_COOLDOWN_SECONDS = 60/);
  assert.match(recovery, /Please wait \$\{cooldown\} seconds/);
  assert.match(recovery, /isSubmitting \|\| cooldown > 0/);
  assert.doesNotMatch(recovery, /console\.(log|error|warn)/);
  assert.doesNotMatch(recovery, /access_token|refresh_token|token_hash/);
});

test("the existing password setup page still handles recovery payloads securely", () => {
  assert.match(setup, /exchangeCodeForSession/);
  assert.match(setup, /verifyOtp\([\s\S]*type: "recovery"/);
  assert.match(setup, /supabase\.auth\.updateUser\([\s\S]*password: newPassword/);
  assert.match(setup, /INVALID_RESET_MESSAGE/);
  assert.match(setup, /if \(hasRecoveryPayload\) \{[\s\S]*history\.replaceState/);
});

test("forgot-password and guest password setup are both routed without changing signup verification", () => {
  assert.match(app, /path="\/register\/forgot-password"/);
  assert.match(app, /path="\/account\/set-password"/);
  const signup = fs.readFileSync(path.join(root, "src", "pages", "register", "signup.jsx"), "utf8");
  assert.match(signup, /supabase\.auth\.verifyOtp/);
  assert.match(signup, /type: "signup"/);
});
