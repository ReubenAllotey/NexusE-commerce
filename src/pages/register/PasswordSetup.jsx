import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

const INVALID_RESET_MESSAGE =
  "This password reset link is invalid or has expired. Please request a new one.";

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    return { ok: false, message: error.message || "Unable to restore your session.", accessToken: "" };
  }

  const accessToken = data?.session?.access_token ?? "";

  if (!accessToken) {
    return { ok: false, message: "Please open the password setup link from your email again.", accessToken: "" };
  }

  return { ok: true, accessToken };
}

function PasswordSetup() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [sessionEmail, setSessionEmail] = useState("");
  const [sessionAccessToken, setSessionAccessToken] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe = () => {};

    const applySession = (session) => {
      if (!isMounted) {
        return;
      }

      setSessionEmail(session?.user?.email ?? "");
      setSessionAccessToken(session?.access_token ?? "");
      setSessionReady(Boolean(session?.access_token));
      setIsLoading(false);
    };

    const restoreSession = async () => {
      const url = new URL(window.location.href);
      const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
      const authCode = url.searchParams.get("code") || "";
      const tokenHash = url.searchParams.get("token_hash") || "";
      const authType = url.searchParams.get("type") || "";
      const hashAccessToken = hashParams.get("access_token") || "";
      const hashRefreshToken = hashParams.get("refresh_token") || "";
      const hashType = hashParams.get("type") || "";
      const hasRecoveryPayload = Boolean(
        authCode || tokenHash || hashAccessToken || hashRefreshToken || hashType,
      );
      let sessionResult = null;
      let sessionError = null;

      if (authCode) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);
        sessionResult = data ?? null;
        sessionError = error ?? null;
      } else if (hashAccessToken && hashRefreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: hashAccessToken,
          refresh_token: hashRefreshToken,
        });
        sessionResult = data ?? null;
        sessionError = error ?? null;
      } else if (tokenHash && authType === "recovery") {
        const { data, error } = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: tokenHash,
        });
        sessionResult = data ?? null;
        sessionError = error ?? null;
      } else {
        const { data, error } = await supabase.auth.getSession();
        sessionResult = data ?? null;
        sessionError = error ?? null;
      }

      if (!isMounted) {
        return;
      }

      if (sessionError) {
        setError(INVALID_RESET_MESSAGE);
        setIsLoading(false);
        return;
      }

      if (!sessionResult?.session) {
        setError(INVALID_RESET_MESSAGE);
        setIsLoading(false);
        return;
      }

      if (hasRecoveryPayload) {
        window.history.replaceState({}, document.title, "/account/set-password");
      }

      applySession(sessionResult?.session ?? null);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) {
        return;
      }

      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        applySession(session ?? null);
      }
    });

    unsubscribe = () => subscription.unsubscribe();

    void restoreSession();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setPasswordForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

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

    setIsSubmitting(true);

    try {
      const { data: currentSession } = await supabase.auth.getSession();
      const token = currentSession?.session?.access_token || sessionAccessToken || (await getAccessToken()).accessToken;

      if (!token) {
        throw new Error(INVALID_RESET_MESSAGE);
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        throw updateError;
      }

      const { data: refreshedSession } = await supabase.auth.getSession();
      const refreshedToken = refreshedSession?.session?.access_token || token;

      const response = await fetch("/api/account/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshedToken}`,
        },
        body: JSON.stringify({
          newPassword,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || "Unable to finish password setup right now.");
      }

      setPasswordForm({
        newPassword: "",
        confirmPassword: "",
      });
      setMessage("Your password has been set successfully.");
      setTimeout(() => {
        navigate("/profile/dashboard", { replace: true });
      }, 800);
    } catch (setupError) {
      setError(setupError.message || "Unable to finish password setup right now.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-card__header">
          <p>Password setup</p>
          <h1>Create your password</h1>
          <span>Use the secure link from your email to set a password for your guest order account.</span>
        </div>

        {isLoading ? <div className="auth-card__notice">Loading your secure password setup session...</div> : null}

        {sessionEmail ? (
          <div className="auth-card__notice">
            Setting up password for <strong>{sessionEmail}</strong>
          </div>
        ) : null}

        {message ? <div className="auth-card__notice">{message}</div> : null}
        {error ? <p className="auth-form__error">{error}</p> : null}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            New password
            <input
              type="password"
              name="newPassword"
              placeholder="Create a secure password"
              value={passwordForm.newPassword}
              onChange={handleChange}
              autoComplete="new-password"
              disabled={isLoading || isSubmitting}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              name="confirmPassword"
              placeholder="Confirm your password"
              value={passwordForm.confirmPassword}
              onChange={handleChange}
              autoComplete="new-password"
              disabled={isLoading || isSubmitting}
            />
          </label>

          <button
            type="submit"
            className="auth-form__button"
            disabled={isLoading || isSubmitting || !sessionReady}
          >
            {isSubmitting ? "Saving password..." : "Save password"}
          </button>
        </form>

        <p className="auth-switch">
          Already set your password? <Link to="/register/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}

export default PasswordSetup;
