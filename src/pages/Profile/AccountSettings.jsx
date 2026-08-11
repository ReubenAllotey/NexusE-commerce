import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

function getInitials(name = "") {
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function normalizeOptionalText(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function formatDateForInput(value) {
  if (!value) {
    return "";
  }

  return String(value).slice(0, 10);
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    return { ok: false, message: error.message || "Unable to restore your session.", accessToken: "" };
  }

  const accessToken = data?.session?.access_token ?? "";

  if (!accessToken) {
    return { ok: false, message: "Please sign in again to continue.", accessToken: "" };
  }

  return { ok: true, accessToken };
}

function AccountSettings({ authUser = null, onUpdateAuthUser = () => {} }) {
  const profileRequestIdRef = useRef(0);
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({
    fullName: "",
    phoneNumber: "",
    dateOfBirth: "",
    gender: "",
  });
  const [loginForm, setLoginForm] = useState({
    email: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [photoPreview, setPhotoPreview] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  useEffect(() => {
    let isActive = true;
    const requestId = ++profileRequestIdRef.current;

    const loadProfile = async () => {
      setIsLoadingProfile(true);
      setError("");
      setProfileMessage("");
      setPasswordMessage("");

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (!isActive || requestId !== profileRequestIdRef.current) {
        return;
      }

      if (userError) {
        setError(userError.message || "Unable to load your account profile.");
        setProfile(null);
        setIsLoadingProfile(false);
        return;
      }

      const userId = userData?.user?.id ?? "";

      if (!userId) {
        setError("Please sign in again to access your account settings.");
        setProfile(null);
        setIsLoadingProfile(false);
        return;
      }

      const { data, error: profileError } = await supabase
        .from("profiles")
        .select(
          "id, full_name, email, phone_number, photo_url, date_of_birth, gender, role, account_type, status, created_at, updated_at",
        )
        .eq("id", userId)
        .maybeSingle();

      if (!isActive || requestId !== profileRequestIdRef.current) {
        return;
      }

      if (profileError) {
        setError(profileError.message || "Unable to load your account profile.");
        setProfile(null);
        setIsLoadingProfile(false);
        return;
      }

      if (!data) {
        setError("Your profile could not be loaded.");
        setProfile(null);
        setIsLoadingProfile(false);
        return;
      }

      setProfile(data);
      setProfileForm({
        fullName: data.full_name ?? "",
        phoneNumber: data.phone_number ?? "",
        dateOfBirth: formatDateForInput(data.date_of_birth),
        gender: data.gender ?? "",
      });
      setLoginForm({
        email: data.email ?? "",
      });
      setPhotoPreview(data.photo_url ?? "");
      setIsLoadingProfile(false);
    };

    void loadProfile();

    return () => {
      isActive = false;
    };
  }, [authUser?.id]);

  const isAccountEditable = profile?.status === "active";
  const passwordResetRequired = Boolean(authUser?.mustChangePassword);
  const statusMessage =
    profile?.status && profile.status !== "active"
      ? `Your account is ${profile.status}. Profile changes are disabled for suspended or disabled accounts.`
      : "";
  const photoStatus = photoPreview ? "Uploaded" : "Not uploaded";
  const avatarLabel = useMemo(
    () =>
      photoPreview
        ? "Profile photo"
        : getInitials(profileForm.fullName || authUser?.name || profile?.full_name || "User"),
    [authUser?.name, photoPreview, profile?.full_name, profileForm.fullName],
  );

  const handleProfileChange = (event) => {
    const { name, value } = event.target;
    setProfileForm((current) => ({ ...current, [name]: value }));
  };

  const handlePasswordChange = (event) => {
    const { name, value } = event.target;
    setPasswordForm((current) => ({ ...current, [name]: value }));
  };

  const handlePhotoChange = (event) => {
    if (!isAccountEditable) {
      return;
    }

    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(String(reader.result ?? ""));
      setProfileMessage("Profile photo selected. Click Save Profile to store it.");
      setError("");
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    setError("");
    setProfileMessage("");
    setPasswordMessage("");

    if (!profile?.id) {
      setError("Please sign in again to update your profile.");
      return;
    }

    if (!isAccountEditable) {
      setError("Your account is not active, so profile changes are disabled.");
      return;
    }

    const cleanedFullName = profileForm.fullName.trim();

    if (!cleanedFullName) {
      setError("Please add your full name.");
      return;
    }

    setIsSavingProfile(true);

    try {
      const { data, error: updateError } = await supabase
        .from("profiles")
        .update({
          full_name: cleanedFullName,
          phone_number: normalizeOptionalText(profileForm.phoneNumber),
          date_of_birth: normalizeOptionalText(profileForm.dateOfBirth),
          gender: normalizeOptionalText(profileForm.gender),
          photo_url: normalizeOptionalText(photoPreview),
        })
        .eq("id", profile.id)
        .select(
          "id, full_name, email, phone_number, photo_url, date_of_birth, gender, role, account_type, status, created_at, updated_at",
        )
        .single();

      if (updateError) {
        throw updateError;
      }

      setProfile(data);
      setProfileForm({
        fullName: data.full_name ?? "",
        phoneNumber: data.phone_number ?? "",
        dateOfBirth: formatDateForInput(data.date_of_birth),
        gender: data.gender ?? "",
      });
      setLoginForm({
        email: data.email ?? "",
      });
      setPhotoPreview(data.photo_url ?? "");
      onUpdateAuthUser(data);
      setProfileMessage("Profile saved successfully.");
    } catch (saveError) {
      setError(saveError.message || "Unable to save your profile right now.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleEmailSectionSubmit = (event) => {
    event.preventDefault();
    setError("");
    setProfileMessage("");
    setPasswordMessage("");
    setProfileMessage("Email is read-only and managed by Supabase Auth.");
  };

  const handleUpdatePassword = async (event) => {
    event.preventDefault();
    setError("");
    setPasswordMessage("");
    setProfileMessage("");

    if (!isAccountEditable) {
      setError("Your account is not active, so password changes are disabled.");
      return;
    }

    const newPassword = passwordForm.newPassword.trim();
    const confirmPassword = passwordForm.confirmPassword.trim();

    if (!newPassword || !confirmPassword) {
      setError("Please enter and confirm your new password.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }

    setIsUpdatingPassword(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        throw updateError;
      }

      const tokenResult = await getAccessToken();

      if (!tokenResult.ok) {
        throw new Error(tokenResult.message);
      }

      const response = await fetch("/api/account/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenResult.accessToken}`,
        },
        body: JSON.stringify({
          newPassword,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || "Unable to update your password right now.");
      }

      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      const nextProfile = {
        ...(profile ?? {}),
        must_change_password: false,
      };

      setProfile(nextProfile);
      onUpdateAuthUser(nextProfile);
      setPasswordMessage("Password updated successfully.");
    } catch (passwordError) {
      setError(passwordError.message || "Unable to update your password right now.");
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <main className="account-settings-page">
      <section className="account-settings-shell">
        <header className="account-settings-header">
          <div>
            <p className="account-settings-header__eyebrow">Account Settings</p>
            <h1>Account Settings</h1>
            <span>Manage your profile, password, and account access.</span>
          </div>

          <div className="account-settings-header__avatar" aria-label="Profile avatar">
            {photoPreview ? (
              <img src={photoPreview} alt="Profile" />
            ) : (
              <span>{avatarLabel || "U"}</span>
            )}
          </div>
        </header>

        {isLoadingProfile ? (
          <p className="account-settings-message">Loading your profile...</p>
        ) : null}

        {statusMessage ? <p className="account-settings-error">{statusMessage}</p> : null}
        {passwordResetRequired ? (
          <p className="account-settings-message">
            Your account was created for guest checkout. Please change your password now to keep access to your order history.
          </p>
        ) : null}

        <section className="account-settings-panel">
          <div className="account-settings-panel__header">
            <div>
              <p>Profile Information</p>
              <h2>Basic information</h2>
            </div>

            <span className={`account-settings-status${photoPreview ? " is-active" : ""}`}>
              {photoStatus}
            </span>
          </div>

          <form className="account-settings-form" onSubmit={handleSaveProfile}>
            <div className="account-settings-profile">
              <label className="account-settings-photo">
                <span>Profile Photo</span>
                <div className="account-settings-photo__preview">
                  {photoPreview ? (
                    <img src={photoPreview} alt="Uploaded profile" />
                  ) : (
                    <strong>{avatarLabel || "U"}</strong>
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  disabled={!isAccountEditable || isLoadingProfile || isSavingProfile}
                />
                <small>{photoPreview ? "Uploaded" : "No photo uploaded yet"}</small>
              </label>

              <div className="account-settings-grid">
                <label className="account-settings-field">
                  <span>Full Name</span>
                  <input
                    type="text"
                    name="fullName"
                    value={profileForm.fullName}
                    onChange={handleProfileChange}
                    placeholder="Enter your full name"
                    disabled={!isAccountEditable || isLoadingProfile || isSavingProfile}
                  />
                </label>

                <label className="account-settings-field">
                  <span>Phone Number</span>
                  <input
                    type="tel"
                    name="phoneNumber"
                    value={profileForm.phoneNumber}
                    onChange={handleProfileChange}
                    placeholder="024 XXX XXXX"
                    disabled={!isAccountEditable || isLoadingProfile || isSavingProfile}
                  />
                </label>

                <label className="account-settings-field">
                  <span>Date of Birth</span>
                  <input
                    type="date"
                    name="dateOfBirth"
                    value={profileForm.dateOfBirth}
                    onChange={handleProfileChange}
                    disabled={!isAccountEditable || isLoadingProfile || isSavingProfile}
                  />
                </label>

                <label className="account-settings-field">
                  <span>Gender</span>
                  <select
                    name="gender"
                    value={profileForm.gender}
                    onChange={handleProfileChange}
                    disabled={!isAccountEditable || isLoadingProfile || isSavingProfile}
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="prefer-not-to-say">Prefer not to say</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="account-settings-actions">
              {error ? <p className="account-settings-error">{error}</p> : null}
              {profileMessage ? <p className="account-settings-message">{profileMessage}</p> : null}
              <button
                type="submit"
                className="account-settings-button"
                disabled={!isAccountEditable || isLoadingProfile || isSavingProfile}
              >
                {isSavingProfile ? "Saving..." : "Save Profile"}
              </button>
            </div>
          </form>
        </section>

        <div className="account-settings-grid--two">
          <section className="account-settings-panel">
            <div className="account-settings-panel__header">
              <div>
                <p>Login Information</p>
                <h2>Update email</h2>
              </div>
            </div>

            <form className="account-settings-form" onSubmit={handleEmailSectionSubmit}>
              <label className="account-settings-field">
                <span>Email</span>
                <input
                  type="email"
                  name="email"
                  value={loginForm.email}
                  readOnly
                  aria-readonly="true"
                  placeholder="Managed by Supabase Auth"
                />
              </label>

              <p className="account-settings-message">
                Email is read-only and managed by Supabase Auth.
              </p>

              <button
                type="submit"
                className="account-settings-button account-settings-button--ghost"
                disabled
              >
                Managed by Supabase Auth
              </button>
            </form>
          </section>

          <section className="account-settings-panel">
            <div className="account-settings-panel__header">
              <div>
                <p>Change Password</p>
                <h2>Security</h2>
              </div>
            </div>

            <form className="account-settings-form" onSubmit={handleUpdatePassword}>
              <div className="account-settings-grid">
                <label className="account-settings-field">
                  <span>New Password</span>
                  <input
                    type="password"
                    name="newPassword"
                    value={passwordForm.newPassword}
                    onChange={handlePasswordChange}
                    placeholder="Create new password"
                    disabled={!isAccountEditable || isLoadingProfile || isUpdatingPassword}
                  />
                </label>

                <label className="account-settings-field">
                  <span>Confirm New Password</span>
                  <input
                    type="password"
                    name="confirmPassword"
                    value={passwordForm.confirmPassword}
                    onChange={handlePasswordChange}
                    placeholder="Confirm password"
                    disabled={!isAccountEditable || isLoadingProfile || isUpdatingPassword}
                  />
                </label>
              </div>

              {passwordMessage ? <p className="account-settings-message">{passwordMessage}</p> : null}

              <button
                type="submit"
                className="account-settings-button"
                disabled={!isAccountEditable || isLoadingProfile || isUpdatingPassword}
              >
                {isUpdatingPassword ? "Updating..." : "Update Password"}
              </button>
            </form>
          </section>
        </div>

        <section className="account-settings-panel account-settings-panel--danger">
          <div className="account-settings-panel__header">
            <div>
              <p>Danger Zone</p>
              <h2>Delete Account</h2>
            </div>
          </div>

          <p className="account-settings-danger__text">
            Account deletion is not available yet.
          </p>

          <div className="account-settings-actions account-settings-actions--danger">
            <button
              type="button"
              className="account-settings-button account-settings-button--danger"
              disabled
            >
              Delete My Account
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

export default AccountSettings;
