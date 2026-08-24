import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { clearGuestLoginHint, loadGuestLoginHint, saveSessionUser } from "./authStorage";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M21.3 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.2c-.2 1-.9 2.1-1.8 2.7v2.3h2.9c1.7-1.6 3-4 3-6.7Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.5 0 4.6-.8 6.2-2.1l-2.9-2.3c-.8.5-1.8.9-3.3.9-2.6 0-4.8-1.8-5.6-4.2H3.3v2.4A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.4 14.3a6 6 0 0 1 0-4.6V7.3H3.3a10 10 0 0 0 0 9.4l3.1-2.4Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.9c1.4 0 2.7.5 3.7 1.4l2.8-2.8A9.9 9.9 0 0 0 12 2 10 10 0 0 0 3.3 7.3l3.1 2.4A6 6 0 0 1 12 5.9Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M13.5 21v-7h2.4l.4-2.8h-2.8V9.3c0-.8.2-1.4 1.5-1.4h1.5V5.2c-.3 0-1.4-.1-2.6-.1-2.5 0-4.2 1.5-4.2 4.3v1.8H7.4V14h2.3v7h3.8Z"
        fill="#1877F2"
      />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.8 13.9 9l5.2 1.9-5.2 1.9L12 18l-1.9-5.2L4.9 10.9 10.1 9 12 3.8Z" />
    </svg>
  );
}

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5a2.5 2.5 0 1 1 0 5A2.5 2.5 0 0 1 7 4.5Z" />
      <path d="M17 14.5a2.5 2.5 0 1 1 0 5A2.5 2.5 0 0 1 17 14.5Z" />
      <path d="M9.2 6.8h3.9c1.8 0 3.2 1.4 3.2 3.2v4.1" />
      <path d="M7 9.8v2.7c0 1.8 1.4 3.2 3.2 3.2h3.1" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.8 18 6v5.1c0 4-2.2 6.7-6 9-3.8-2.3-6-5-6-9V6l6-2.2Z" />
      <path d="M9.6 12.2 11 13.6l3.4-3.5" />
    </svg>
  );
}

function BrandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8 19.5 5.9 12 9 4.5 5.9 12 2.8Z" />
      <path d="m4.5 8.1 7.5 3.1 7.5-3.1" />
      <path d="M4.5 12.1 12 15.2l7.5-3.1" />
      <path d="M4.5 16.1 12 19.2l7.5-3.1" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5c5.6 0 9.8 4 11 7-1.2 3-5.4 7-11 7S2.2 15 1 12c1.2-3 5.4-7 11-7Z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.7A3.1 3.1 0 0 0 12 15.1a3.2 3.2 0 0 0 1-.16" />
      <path d="M5.2 8.1C3.8 9.4 2.8 10.8 2 12c1.2 3 5.4 7 10 7 1 0 2-.17 3-.5" />
      <path d="M10.3 4.8C10.9 4.6 11.4 4.5 12 4.5c5.6 0 9.8 4 11 7a21 21 0 0 1-3.6 4.9" />
    </svg>
  );
}

function Login() {
  const navigate = useNavigate();
  const guestHint = loadGuestLoginHint();
  const [formData, setFormData] = useState({
    email: guestHint?.email ?? "",
    password: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleProviderLogin = async (provider) => {
    setError("");

    try {
      const { error: providerError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/profile/dashboard`,
        },
      });

      if (providerError) {
        throw providerError;
      }
    } catch (providerLoginError) {
      setError(providerLoginError.message || "Unable to continue with social login right now.");
    }
  };

  useEffect(() => {
    if (!guestHint?.email) {
      return;
    }

    setFormData((current) => ({
      ...current,
      email: guestHint.email || current.email,
    }));
  }, [guestHint?.email]);

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

    const cleanEmail = formData.email.trim();
    const cleanPassword = formData.password.trim();

    if (!cleanEmail || !cleanPassword) {
      setError("Please enter your email and password.");
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
        throw new Error("Unable to restore your session. Please sign in again.");
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select(
          "id, full_name, email, phone_number, photo_url, date_of_birth, gender, role, account_type, status, created_at, updated_at",
        )
        .eq("id", data.session.user.id)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      if (!profile) {
        throw new Error("We signed you in, but your profile could not be loaded.");
      }

      saveSessionUser({
        ...profile,
        must_change_password: data.session.user.user_metadata?.must_change_password ?? false,
      });
      clearGuestLoginHint();
      navigate(
        (data.session.user.user_metadata?.must_change_password ?? profile.must_change_password)
          ? "/profile/settings"
          : "/profile/dashboard",
        { replace: true },
      );
    } catch (authError) {
      setError(authError.message || "Unable to log you in right now.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page auth-page--login">
      <section className="auth-shell">
        <aside className="auth-panel auth-panel--visual">
          <div className="auth-visual__text">
            <p className="auth-visual__eyebrow">Nexus Import Hub</p>
            <h2 className="auth-visual__title">Shop smarter with your Nexus account.</h2>
            <p className="auth-visual__lead">
              Sign in to continue shopping, track every order, and enjoy a faster checkout
              experience.
            </p>

            <ul className="auth-visual__points" aria-label="Benefits">
              <li>
                <span className="auth-visual__point-icon" aria-hidden="true">
                  <SparkIcon />
                </span>
                <span>Fast checkout</span>
              </li>
              <li>
                <span className="auth-visual__point-icon" aria-hidden="true">
                  <RouteIcon />
                </span>
                <span>Order tracking</span>
              </li>
              <li>
                <span className="auth-visual__point-icon" aria-hidden="true">
                  <ShieldIcon />
                </span>
                <span>Secure access</span>
              </li>
            </ul>
          </div>

        </aside>

        <section className="auth-panel auth-panel--form">
          <div className="auth-card__header">
            <div className="auth-card__badge">
              <strong>Nexus Imports</strong>
            </div>
            <h2>Welcome Back</h2>
            <span>Please login to your account.</span>
          </div>

          {guestHint ? (
            <div className="auth-card__notice">
              Guest checkout detected. Use the email from your payment success page. If the
              email already has an account, sign in or use Forgot Password to track your order.
              If this was a new guest checkout, open the secure password setup link we emailed
              you.
            </div>
          ) : null}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Email address
              <input
                type="email"
                name="email"
                placeholder="Enter your email"
                value={formData.email}
                onChange={handleChange}
                autoComplete="email"
              />
            </label>
            <label className="auth-password">
              Password
              <div className="auth-password__field">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={handleChange}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="auth-password__toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </label>

            <div className="auth-form__row">
              <label className="auth-form__check">
                <input type="checkbox" />
                <span>Remember me</span>
              </label>
              <a href="#footer">Forgot password?</a>
            </div>

            {error ? <p className="auth-form__error">{error}</p> : null}

            <button type="submit" className="auth-form__button" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Login"}
            </button>

            <div className="auth-social">
              <div className="auth-social__divider">
                <span>Or log in with</span>
              </div>

              <div className="auth-social__buttons">
                <button
                  type="button"
                  className="auth-social__button auth-social__button--google"
                  onClick={() => handleProviderLogin("google")}
                >
                  <span className="auth-social__button-icon" aria-hidden="true">
                    <GoogleIcon />
                  </span>
                  <span>Google</span>
                </button>

                <button
                  type="button"
                  className="auth-social__button auth-social__button--facebook"
                  onClick={() => handleProviderLogin("facebook")}
                >
                  <span className="auth-social__button-icon" aria-hidden="true">
                    <FacebookIcon />
                  </span>
                  <span>Facebook</span>
                </button>
              </div>
            </div>
          </form>

          <p className="auth-switch">
            New here? <Link to="/register/signup">Create an account</Link>
          </p>
        </section>
      </section>
    </main>
  );
}

export default Login;
