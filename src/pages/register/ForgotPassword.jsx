import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

const RESEND_COOLDOWN_SECONDS = 60;
const GENERIC_MESSAGE = "If an account exists for that email, we will send password reset instructions shortly.";

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    setMessage("");
    setError("");

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (cooldown > 0) {
      setError(`Please wait ${cooldown} seconds before requesting another email.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/account/set-password`,
      });

      if (resetError) {
        throw resetError;
      }

      setMessage(GENERIC_MESSAGE);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (resetError) {
      // Keep provider responses generic so account existence and auth details
      // are never disclosed through the recovery form.
      setError("We could not complete that request right now. Please try again later.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-card__header">
          <p>Account recovery</p>
          <h1>Forgot your password?</h1>
          <span>Enter your email and we will help you securely set a new password.</span>
        </div>

        {message ? <div className="auth-card__notice">{message}</div> : null}
        {error ? <p className="auth-form__error">{error}</p> : null}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label>
            Email address
            <input
              type="email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              autoComplete="email"
              disabled={isSubmitting}
              required
            />
          </label>
          <button type="submit" className="auth-form__button" disabled={isSubmitting || cooldown > 0}>
            {isSubmitting ? "Sending instructions..." : cooldown > 0 ? `Try again in ${cooldown}s` : "Send reset instructions"}
          </button>
        </form>

        <p className="auth-switch">
          Remembered your password? <Link to="/register/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}

export default ForgotPassword;
