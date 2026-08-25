import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { saveSessionUser } from "./authStorage";

const VERIFICATION_CODE_LENGTH = 8;
const VERIFICATION_RESEND_SECONDS = 60;

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

function Signup() {
  const navigate = useNavigate();
  const codeInputRefs = useRef([]);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState(() =>
    Array.from({ length: VERIFICATION_CODE_LENGTH }, () => ""),
  );
  const [verificationError, setVerificationError] = useState("");
  const [verificationMessage, setVerificationMessage] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  const verificationToken = useMemo(
    () => verificationCode.join("").trim(),
    [verificationCode],
  );
  const isVerificationComplete = verificationCode.every((digit) =>
    /^\d$/.test(digit),
  );

  useEffect(() => {
    if (!pendingVerificationEmail || resendCountdown <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setResendCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [pendingVerificationEmail, resendCountdown]);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const focusVerificationInput = (index) => {
    const input = codeInputRefs.current[index];

    if (input) {
      input.focus();
      input.select();
    }
  };

  const resetVerificationCode = () => {
    setVerificationCode(
      Array.from({ length: VERIFICATION_CODE_LENGTH }, () => ""),
    );
    codeInputRefs.current[0]?.focus?.();
  };

  const handleVerificationChange = (index, value) => {
    const digits = String(value ?? "").replace(/\D/g, "");

    if (!digits) {
      setVerificationCode((current) => {
        const next = [...current];
        next[index] = "";
        return next;
      });
      return;
    }

    setVerificationCode((current) => {
      const next = [...current];
      let targetIndex = index;

      for (const digit of digits.slice(0, VERIFICATION_CODE_LENGTH - index)) {
        next[targetIndex] = digit;
        targetIndex += 1;
      }

      const nextIndex = Math.min(targetIndex, VERIFICATION_CODE_LENGTH - 1);
      queueMicrotask(() => focusVerificationInput(nextIndex));

      return next;
    });
  };

  const handleVerificationPaste = (event) => {
    const pasted = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, VERIFICATION_CODE_LENGTH);

    if (!pasted) {
      return;
    }

    event.preventDefault();

    setVerificationCode(() => {
      const next = Array.from(
        { length: VERIFICATION_CODE_LENGTH },
        (_, index) => pasted[index] ?? "",
      );
      queueMicrotask(() =>
        focusVerificationInput(
          Math.min(pasted.length, VERIFICATION_CODE_LENGTH - 1),
        ),
      );
      return next;
    });
  };

  const handleVerificationKeyDown = (index, event) => {
    if (event.key === "Backspace" && !verificationCode[index] && index > 0) {
      event.preventDefault();
      focusVerificationInput(index - 1);
      setVerificationCode((current) => {
        const next = [...current];
        next[index - 1] = "";
        return next;
      });
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusVerificationInput(index - 1);
    }

    if (event.key === "ArrowRight" && index < VERIFICATION_CODE_LENGTH - 1) {
      event.preventDefault();
      focusVerificationInput(index + 1);
    }
  };

  const handleResendCode = async () => {
    if (!pendingVerificationEmail) {
      return;
    }

    setVerificationError("");
    setVerificationMessage("");
    setIsResending(true);

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: pendingVerificationEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/register/signup`,
        },
      });

      if (resendError) {
        throw resendError;
      }

      setResendCountdown(VERIFICATION_RESEND_SECONDS);
      setVerificationMessage(
        "We sent a fresh verification code to your email.",
      );
      resetVerificationCode();
    } catch (resendErr) {
      setVerificationError(
        resendErr.message ||
          "Unable to resend the verification code right now.",
      );
    } finally {
      setIsResending(false);
    }
  };

  const handleVerifyCode = async (event) => {
    event.preventDefault();

    if (!pendingVerificationEmail) {
      setVerificationError("Please complete signup first.");
      return;
    }

    if (!isVerificationComplete) {
      setVerificationError("Enter the verification code from your email.");
      return;
    }

    setIsVerifying(true);
    setVerificationError("");
    setVerificationMessage("");

    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email: pendingVerificationEmail,
        token: verificationToken,
        type: "email",
      });

      if (verifyError) {
        throw verifyError;
      }

      if (!data?.session?.user?.id) {
        throw new Error(
          "We could not verify your account yet. Please try again.",
        );
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
        throw new Error("Your profile could not be loaded after verification.");
      }

      saveSessionUser(profile);
      setPendingVerificationEmail("");
      setVerificationCode(
        Array.from({ length: VERIFICATION_CODE_LENGTH }, () => ""),
      );
      setResendCountdown(0);
      navigate("/profile/dashboard", { replace: true });
    } catch (verifyErr) {
      setVerificationError(
        verifyErr.message || "Unable to verify your account right now.",
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    const cleanName = formData.name.trim();
    const cleanEmail = formData.email.trim();
    const cleanPassword = formData.password.trim();
    const cleanConfirmPassword = formData.confirmPassword.trim();

    if (!cleanName || !cleanEmail || !cleanPassword || !cleanConfirmPassword) {
      setError("Please complete all signup fields.");
      return;
    }

    if (cleanPassword !== cleanConfirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password: cleanPassword,
        options: {
          data: {
            full_name: cleanName,
          },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      if (!data?.session) {
        setPendingVerificationEmail(cleanEmail.toLowerCase());
        setVerificationCode(
          Array.from({ length: VERIFICATION_CODE_LENGTH }, () => ""),
        );
        setResendCountdown(VERIFICATION_RESEND_SECONDS);
        setNotice(
          "We sent a verification code to your email. Enter it below to activate your account.",
        );
        return;
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
        throw new Error("Your profile could not be loaded after signup.");
      }

      saveSessionUser(profile);
      navigate("/profile/dashboard", { replace: true });
    } catch (authError) {
      setError(authError.message || "Unable to create your account right now.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page auth-page--signup">
      <section className="auth-shell">
        <aside className="auth-panel auth-panel--visual">
          <div className="auth-visual__text">
            <p className="auth-visual__eyebrow">Nexus Import Hub</p>
            <h2 className="auth-visual__title">
              Create your Nexus account with confidence.
            </h2>
            <p className="auth-visual__lead">
              Keep your details saved, shop faster, and track every shipment
              from one account.
            </p>

            <ul className="auth-visual__points" aria-label="Benefits">
              <li>
                <span className="auth-visual__point-icon" aria-hidden="true">
                  <SparkIcon />
                </span>
                <span>Saved details</span>
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
                <span>Secure profile</span>
              </li>
            </ul>
          </div>
        </aside>

        <section className="auth-panel auth-panel--form">
          <div className="auth-card__header">
            <div className="auth-card__badge">
              <strong>Nexus Imports</strong>
            </div>
            <h2>Create Your Account</h2>
            <span>
              Join Nexus to shop faster, track orders, and manage checkout with
              ease.
            </span>
          </div>

          {notice ? <div className="auth-card__notice">{notice}</div> : null}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Full name
              <input
                type="text"
                name="name"
                placeholder="Enter your name"
                value={formData.name}
                onChange={handleChange}
                autoComplete="name"
              />
            </label>
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
                  placeholder="Create a password"
                  value={formData.password}
                  onChange={handleChange}
                  autoComplete="new-password"
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
            <label className="auth-password">
              Confirm password
              <div className="auth-password__field">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  name="confirmPassword"
                  placeholder="Confirm your password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="auth-password__toggle"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  aria-label={
                    showConfirmPassword
                      ? "Hide confirm password"
                      : "Show confirm password"
                  }
                >
                  {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </label>

            {error ? <p className="auth-form__error">{error}</p> : null}

            <button
              type="submit"
              className="auth-form__button"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Creating account..." : "Create account"}
            </button>
          </form>

          {pendingVerificationEmail ? (
            <div
              className="auth-verification"
              role="dialog"
              aria-modal="true"
              aria-labelledby="signup-verification-title"
            >
              <div className="auth-verification__backdrop" aria-hidden="true" />
              <div className="auth-verification__panel">
                <p className="auth-verification__eyebrow">Email verification</p>
                <h3 id="signup-verification-title">
                  Enter the code we emailed you
                </h3>
                <p className="auth-verification__lead">
                  We sent a verification code to{" "}
                  <strong>{pendingVerificationEmail}</strong>. Enter the code
                  below to confirm your account and continue.
                </p>

                <form
                  className="auth-verification__form"
                  onSubmit={handleVerifyCode}
                >
                  <div
                    className="auth-verification__code"
                    aria-label="Verification code"
                  >
                    {verificationCode.map((digit, index) => (
                      <input
                        key={`verification-digit-${index}`}
                        ref={(node) => {
                          codeInputRefs.current[index] = node;
                        }}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={1}
                        value={digit}
                        onChange={(event) =>
                          handleVerificationChange(index, event.target.value)
                        }
                        onPaste={
                          index === 0 ? handleVerificationPaste : undefined
                        }
                        onKeyDown={(event) =>
                          handleVerificationKeyDown(index, event)
                        }
                        aria-label={`Verification code digit ${index + 1}`}
                        disabled={isVerifying || isResending}
                      />
                    ))}
                  </div>

                  <div className="auth-verification__meta">
                    <span>
                      {resendCountdown > 0
                        ? `Code expires soon. Resend available in ${Math.floor(resendCountdown / 60)}:${String(
                            resendCountdown % 60,
                          ).padStart(2, "0")}.`
                        : "If the code expires, request a new one."}
                    </span>
                  </div>

                  {verificationError ? (
                    <p className="auth-form__error">{verificationError}</p>
                  ) : null}
                  {verificationMessage ? (
                    <div className="auth-card__notice">
                      {verificationMessage}
                    </div>
                  ) : null}

                  <div className="auth-verification__actions">
                    <button
                      type="submit"
                      className="auth-form__button"
                      disabled={
                        isVerifying || isResending || !isVerificationComplete
                      }
                    >
                      {isVerifying ? "Verifying..." : "Verify code"}
                    </button>

                    <button
                      type="button"
                      className="auth-verification__resend"
                      onClick={handleResendCode}
                      disabled={
                        isVerifying || isResending || resendCountdown > 0
                      }
                    >
                      {isResending
                        ? "Resending..."
                        : resendCountdown > 0
                          ? `Resend in ${Math.floor(resendCountdown / 60)}:${String(
                              resendCountdown % 60,
                            ).padStart(2, "0")}`
                          : "Resend code"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          <p className="auth-switch">
            Already have an account? <Link to="/register/login">Login</Link>
          </p>
        </section>
      </section>
    </main>
  );
}

export default Signup;
