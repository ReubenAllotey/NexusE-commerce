let currentAdminSession = null;

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function buildAdminSession(profile = {}) {
  const metadata = profile.user_metadata ?? profile.userMetadata ?? {};
  return {
    id: profile.id ?? "",
    name: profile.full_name ?? profile.name ?? "",
    email: normalizeEmail(profile.email),
    createdAt: profile.created_at ?? profile.createdAt ?? "",
    updatedAt: profile.updated_at ?? profile.updatedAt ?? "",
    accountType: profile.account_type ?? profile.accountType ?? "member",
    mustChangePassword: Boolean(
      profile.must_change_password ??
        profile.mustChangePassword ??
        metadata.must_change_password ??
        metadata.mustChangePassword ??
        false,
    ),
    photoUrl: profile.photo_url ?? profile.photoUrl ?? null,
    phoneNumber: profile.phone_number ?? profile.phoneNumber ?? null,
    dateOfBirth: profile.date_of_birth ?? profile.dateOfBirth ?? null,
    gender: profile.gender ?? null,
    role: profile.role ?? "customer",
    status: profile.status ?? "active",
  };
}

export function isActiveAdminProfile(profile = null) {
  return profile?.role === "admin" && profile?.status === "active";
}

export function loadAdminSession() {
  return currentAdminSession ? { ...currentAdminSession } : null;
}

export function saveAdminSession(profile = null) {
  currentAdminSession = isActiveAdminProfile(profile)
    ? buildAdminSession(profile)
    : null;
}

export function clearAdminSession() {
  currentAdminSession = null;
}

export function loginAdmin() {
  return {
    ok: false,
    message: "Admin login now uses Supabase Auth.",
  };
}
