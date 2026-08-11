import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import {
  clearAdminSession,
  isActiveAdminProfile,
  loadAdminSession,
  saveAdminSession,
} from "./adminAuthStorage";
import { clearSessionUser, saveSessionUser } from "../../register/authStorage";
import logo from "../../../assets/images/nexuslogo.png";

async function loadProfileByUserId(userId) {
  if (!userId) {
    return { profile: null, error: new Error("Missing authenticated user.") };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, email, phone_number, photo_url, date_of_birth, gender, role, account_type, status, created_at, updated_at",
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { profile: null, error };
  }

  if (!data) {
    return { profile: null, error: new Error("We could not load this admin profile.") };
  }

  return { profile: data, error: null };
}

function AdminLogin({ authUser = null, authReady = true }) {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    let isActive = true;

    const verifySession = async () => {
      const currentSession = authUser ?? loadAdminSession();

      if (!currentSession) {
        if (isActive) {
          setIsCheckingSession(false);
        }

        return;
      }

      if (!isActiveAdminProfile(currentSession)) {
        await supabase.auth.signOut();
        clearAdminSession();
        clearSessionUser();

        if (isActive) {
          setError("Access denied. This account is not an active administrator.");
          setIsCheckingSession(false);
        }

        return;
      }

      saveAdminSession(currentSession);
      saveSessionUser(currentSession);

      if (isActive) {
        setIsCheckingSession(false);
        navigate("/admin/dashboard", { replace: true });
      }
    };

    verifySession();

    return () => {
      isActive = false;
    };
  }, [authReady, authUser, navigate]);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const cleanEmail = formData.email.trim().toLowerCase();
    const cleanPassword = formData.password.trim();

    if (!cleanEmail || !cleanPassword) {
      setError("Please enter your admin email and password.");
      setIsSubmitting(false);
      return;
    }

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });

      if (signInError) {
        throw signInError;
      }

      if (!data?.session) {
        throw new Error("Check your email to confirm your account before signing in.");
      }

      const { profile, error: profileError } = await loadProfileByUserId(data.session.user.id);

      if (profileError) {
        throw profileError;
      }

      if (!isActiveAdminProfile(profile)) {
        await supabase.auth.signOut();
        clearAdminSession();
        clearSessionUser();
        setError("Access denied. This account is not an active administrator.");
        return;
      }

      const sessionProfile = {
        ...profile,
        must_change_password: data.session?.user?.user_metadata?.must_change_password ?? false,
      };

      saveAdminSession(sessionProfile);
      saveSessionUser(sessionProfile);
      navigate("/admin/dashboard", { replace: true });
    } catch (authError) {
      clearAdminSession();
      clearSessionUser();
      setError(authError.message || "Unable to sign in as administrator.");
    } finally {
      setIsSubmitting(false);
      setIsCheckingSession(false);
    }
  };

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-shell">
        <form className="admin-auth-card" onSubmit={handleSubmit}>
          <div className="admin-auth-card__header">
            <Link to="/" className="admin-auth-brand" aria-label="Nexus home">
              <img src={logo} alt="" className="admin-auth-brand__logo" />
            </Link>

            <h1>Nexus Admin</h1>
            <p>Sign in to access the admin dashboard.</p>
          </div>

          <label className="admin-auth-field">
            <input
              type="email"
              name="email"
              placeholder="admin@nexus.com"
              value={formData.email}
              onChange={handleChange}
              autoComplete="email"
            />
          </label>

          <label className="admin-auth-field">
            <input
              type="password"
              name="password"
              placeholder="Enter your password"
              value={formData.password}
              onChange={handleChange}
              autoComplete="current-password"
            />
          </label>

          {error ? <p className="auth-form__error">{error}</p> : null}

          <button
            type="submit"
            className="admin-auth-card__button"
            disabled={isSubmitting || isCheckingSession}
          >
            {isSubmitting || isCheckingSession ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default AdminLogin;
