import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { clearGuestLoginHint, loadGuestLoginHint, saveSessionUser } from "./authStorage";
import logo from "../../assets/images/nexuslogo.png";

function Login() {
  const navigate = useNavigate();
  const guestHint = loadGuestLoginHint();
  const [formData, setFormData] = useState({
    email: guestHint?.email ?? "",
    password: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    <main className="auth-page">
      <section className="auth-card">
        <Link to="/" className="auth-brand" aria-label="Nexus home">
          <img src={logo} alt="Nexus logo" className="auth-brand__logo" />
        </Link>

        <div className="auth-card__header">
          <p>Welcome back</p>
          <h1>Log in to Nexus</h1>
          <span>Access your account to continue shopping with ease.</span>
        </div>

        {guestHint ? (
          <div className="auth-card__notice">
            Guest checkout detected. Use the email from your payment success page. If the email already has an account, sign in or use Forgot Password to track your order. If this was a new guest checkout, open the secure password setup link we emailed you.
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
          <label>
            Password
            <input
              type="password"
              name="password"
              placeholder="Enter your password"
              value={formData.password}
              onChange={handleChange}
              autoComplete="current-password"
            />
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
        </form>

        <p className="auth-switch">
          New here? <Link to="/register/signup">Create an account</Link>
        </p>
      </section>
    </main>
  );
}

export default Login;
