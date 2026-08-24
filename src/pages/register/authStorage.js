let currentSessionUser = null;

const PROFILE_DEFAULTS = {
  photoUrl: null,
  phoneNumber: null,
  dateOfBirth: null,
  gender: null,
};

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function buildSessionUser(user = {}) {
  const metadata = user.user_metadata ?? user.userMetadata ?? {};
  return {
    id: user.id ?? "",
    name: user.full_name ?? user.name ?? "",
    email: normalizeEmail(user.email),
    createdAt: user.created_at ?? user.createdAt ?? "",
    updatedAt: user.updated_at ?? user.updatedAt ?? "",
    accountType: user.account_type ?? user.accountType ?? "member",
    mustChangePassword: Boolean(
      user.must_change_password ??
        user.mustChangePassword ??
        metadata.must_change_password ??
        metadata.mustChangePassword ??
        false,
    ),
    photoUrl: user.photo_url ?? user.photoUrl ?? null,
    phoneNumber: user.phone_number ?? user.phoneNumber ?? null,
    dateOfBirth: user.date_of_birth ?? user.dateOfBirth ?? null,
    gender: user.gender ?? null,
    role: user.role ?? "customer",
    status: user.status ?? "active",
  };
}

export function loadSessionUser() {
  return currentSessionUser ? { ...currentSessionUser } : null;
}

export function saveSessionUser(user) {
  currentSessionUser = user ? buildSessionUser(user) : null;
}

export function clearSessionUser() {
  currentSessionUser = null;
}

export function registerUser({ name, email, password }) {
  void name;
  void email;
  void password;

  return {
    ok: false,
    message: "Customer signup now uses Supabase Auth.",
  };
}

export function loginUser({ email, password }) {
  void password;

  if (!email?.trim()) {
    return { ok: false, message: "Please enter your email and password." };
  }

  return {
    ok: false,
    message: "Customer login now uses Supabase Auth.",
  };
}

export function createGuestCheckoutAccount({ name, email } = {}) {
  void name;
  void email;

  return Promise.resolve({
    ok: false,
    code: "GUEST_ACCOUNT_DISABLED",
    message: "Guest checkout credentials are created after payment succeeds.",
  });
}

export function updateStoredUserProfile(userId, updates = {}) {
  void userId;
  void updates;

  return {
    ok: false,
    message: "Profile updates are handled by Supabase.",
  };
}

export function updateStoredUserEmail(userId, email) {
  void userId;
  void email;

  return {
    ok: false,
    message: "Email changes are handled by Supabase Auth.",
  };
}

export function updateStoredUserPassword(userId, currentPassword, newPassword) {
  void userId;
  void currentPassword;
  void newPassword;

  return {
    ok: false,
    message: "Password changes are now handled by Supabase Auth.",
  };
}

export function deleteStoredUserAccount(userId) {
  void userId;

  return {
    ok: false,
    message: "Account deletion is not available yet.",
  };
}
