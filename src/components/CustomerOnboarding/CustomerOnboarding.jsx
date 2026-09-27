import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { requestPwaInstall, usePwaInstall } from "../../shared/pwaInstall";

const SIGN_IN_DISMISSAL_KEY = "nexus:onboarding:signin-dismissed-at";
const INSTALL_DISMISSAL_KEY = "nexus:onboarding:install-dismissed-at";
const NOTIFICATION_DISMISSAL_KEY = "nexus:onboarding:notification-intro-dismissed-at";
const SIGN_IN_COOLDOWN = 5 * 24 * 60 * 60 * 1000;
const INSTALL_COOLDOWN = 7 * 24 * 60 * 60 * 1000;
const NOTIFICATION_COOLDOWN = 7 * 24 * 60 * 60 * 1000;

function readTimestamp(key) {
  if (typeof window === "undefined") {
    return 0;
  }

  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? value : 0;
}

function writeTimestamp(key) {
  window.localStorage.setItem(key, String(Date.now()));
}

function isCriticalPath(pathname = "") {
  return (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/payment") ||
    pathname.startsWith("/delivery") ||
    pathname.startsWith("/shipping") ||
    pathname === "/register" ||
    pathname.startsWith("/register/") ||
    pathname.startsWith("/account/")
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.7 3.2-5.5 7-5.5s6.2 1.8 7 5.5" />
    </svg>
  );
}

function InstallIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M12 7v6m0 0-2.5-2.5M12 13l2.5-2.5M9 18h6" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

function CustomerOnboarding({ authReady = false, authUser = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const pwa = usePwaInstall();
  const [modal, setModal] = useState(null);
  const [installHelp, setInstallHelp] = useState(null);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [signinDismissedAt, setSigninDismissedAt] = useState(() => readTimestamp(SIGN_IN_DISMISSAL_KEY));
  const [installDismissedAt, setInstallDismissedAt] = useState(() => readTimestamp(INSTALL_DISMISSAL_KEY));
  const [notificationDismissedAt, setNotificationDismissedAt] = useState(() => readTimestamp(NOTIFICATION_DISMISSAL_KEY));
  const closeButtonRef = useRef(null);
  const installHelpCloseRef = useRef(null);

  const isExcluded = isCriticalPath(location.pathname);
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const isRecent = (timestamp, cooldown) => timestamp > 0 && Date.now() - timestamp < cooldown;

  const dismissSignin = () => {
    const timestamp = Date.now();
    writeTimestamp(SIGN_IN_DISMISSAL_KEY);
    setSigninDismissedAt(timestamp);
    setModal(null);
  };

  const dismissInstall = () => {
    const timestamp = Date.now();
    writeTimestamp(INSTALL_DISMISSAL_KEY);
    setInstallDismissedAt(timestamp);
    setModal(null);
  };

  const dismissNotifications = () => {
    const timestamp = Date.now();
    writeTimestamp(NOTIFICATION_DISMISSAL_KEY);
    setNotificationDismissedAt(timestamp);
    setModal(null);
  };

  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__NEXUS_RESET_ONBOARDING__ = () => {
        [SIGN_IN_DISMISSAL_KEY, INSTALL_DISMISSAL_KEY, NOTIFICATION_DISMISSAL_KEY].forEach((key) => {
          window.localStorage.removeItem(key);
        });
        window.location.reload();
      };

      return () => {
        delete window.__NEXUS_RESET_ONBOARDING__;
      };
    }

    return undefined;
  }, []);

  useEffect(() => {
    if (!modal) {
      return undefined;
    }

    if (installHelp) {
      installHelpCloseRef.current?.focus();
    } else {
      closeButtonRef.current?.focus();
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (installHelp) {
          setInstallHelp(null);
          return;
        }

        if (modal === "signin") dismissSignin();
        if (modal === "install") dismissInstall();
        if (modal === "notifications") dismissNotifications();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [installHelp, modal]);

  useEffect(() => {
    const handleFooterInstall = () => {
      if (!isExcluded && !pwa.installed && !modal) {
        setModal("install");
      }
    };

    window.addEventListener("nexus:open-install", handleFooterInstall);
    return () => window.removeEventListener("nexus:open-install", handleFooterInstall);
  }, [isExcluded, modal, pwa.canInstall, pwa.installed]);

  useEffect(() => {
    const signinIsSuppressed = isRecent(signinDismissedAt, SIGN_IN_COOLDOWN);

    if (
      !authReady ||
      isExcluded ||
      pwa.installed ||
      !pwa.manualGuidanceAvailable ||
      modal === "signin" ||
      (!authUser && !signinIsSuppressed)
    ) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      if (!isRecent(installDismissedAt, INSTALL_COOLDOWN)) {
        setModal("install");
      }
    }, 6000);

    return () => window.clearTimeout(timer);
  }, [authReady, authUser, isExcluded, modal, pwa.installed, pwa.manualGuidanceAvailable, installDismissedAt, signinDismissedAt]);

  useEffect(() => {
    if (!authReady || authUser || isExcluded || isRecent(signinDismissedAt, SIGN_IN_COOLDOWN)) {
      return undefined;
    }

    const timer = window.setTimeout(() => setModal("signin"), 900);
    return () => window.clearTimeout(timer);
  }, [authReady, authUser, isExcluded, signinDismissedAt]);

  const handleInstall = async () => {
    if (pwa.deferredPromptAvailable) {
      const result = await requestPwaInstall();

      if (!result.ok) {
        return;
      }

      setModal(
        typeof Notification !== "undefined" &&
          Notification.permission === "default" &&
          !isRecent(notificationDismissedAt, NOTIFICATION_COOLDOWN)
          ? "notifications"
          : null,
      );
      return;
    }

    if (pwa.isIos) {
      setInstallHelp("ios");
      return;
    }

    setInstallHelp("desktop");
  };

  const handleNotificationPermission = async () => {
    if (typeof Notification === "undefined") {
      setNotificationMessage("Browser notifications are not supported here.");
      return;
    }

    if (Notification.permission === "denied") {
      setNotificationMessage("Notifications are currently blocked in your browser settings.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === "denied") {
      setNotificationMessage("Notifications are currently blocked in your browser settings.");
    } else {
      setModal(null);
    }
  };

  if (!modal || isExcluded) {
    return null;
  }

  const title = modal === "signin"
    ? "Enjoy a better shopping experience"
    : modal === "install"
      ? "Add Nexus to your Home Screen"
      : "Stay updated with Nexus";

  return (
    <div className="customer-onboarding" role="presentation">
      <button
        type="button"
        className="customer-onboarding__scrim"
        aria-label="Close onboarding dialog"
        onClick={modal === "signin" ? dismissSignin : modal === "install" ? dismissInstall : dismissNotifications}
      />
      <section className="customer-onboarding__dialog" role="dialog" aria-modal="true" aria-labelledby="customer-onboarding-title">
        <button
          ref={closeButtonRef}
          type="button"
          className="customer-onboarding__close"
          aria-label="Close"
          onClick={modal === "signin" ? dismissSignin : modal === "install" ? dismissInstall : dismissNotifications}
        >
          <CloseIcon />
        </button>
        <div className="customer-onboarding__icon">
          {modal === "signin" ? <AccountIcon /> : modal === "install" ? <InstallIcon /> : <BellIcon />}
        </div>
        <p className="customer-onboarding__eyebrow">Nexus Import Hub</p>
        <h2 id="customer-onboarding-title">{title}</h2>

        {modal === "signin" ? (
          <>
            <p>Sign in to track your orders, receive shipping updates, manage payments and stay informed about your deliveries.</p>
            <button
              type="button"
              className="customer-onboarding__primary"
              onClick={() => navigate("/register/login", { state: { returnTo } })}
            >
              Sign In / Create Account
            </button>
            <button type="button" className="customer-onboarding__secondary" onClick={dismissSignin}>Maybe later</button>
          </>
        ) : null}

        {modal === "install" ? (
          <>
            <p>Get faster access to Nexus and stay closer to your orders, shipping updates and account.</p>
            <button type="button" className="customer-onboarding__primary" onClick={handleInstall}>
              Install App
            </button>
            <button type="button" className="customer-onboarding__secondary" onClick={dismissInstall}>Not now</button>
          </>
        ) : null}

        {modal === "notifications" ? (
          <>
            <p>Allow browser notifications for important Nexus updates when browser delivery is available.</p>
            <ul className="customer-onboarding__list">
              <li>Order and shipment updates</li>
              <li>Shipping fee reminders</li>
              <li>Important account notices</li>
            </ul>
            {notificationMessage ? <p className="customer-onboarding__message" role="status">{notificationMessage}</p> : null}
            <button type="button" className="customer-onboarding__primary" onClick={handleNotificationPermission}>Allow Notifications</button>
            <button type="button" className="customer-onboarding__secondary" onClick={dismissNotifications}>Maybe later</button>
          </>
        ) : null}
      </section>
      {modal === "install" && installHelp ? (
        <div className="customer-onboarding__help-layer" role="presentation">
          <button
            type="button"
            className="customer-onboarding__help-scrim"
            aria-label="Close installation instructions"
            onClick={() => setInstallHelp(null)}
          />
          <section className="customer-onboarding__help-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-install-help-title">
            <h3 id="customer-install-help-title">Install Nexus</h3>
            {installHelp === "ios" ? (
              <ol className="customer-onboarding__help-list">
                <li>Tap the <ShareIcon /> Share button at the bottom of Safari.</li>
                <li>Scroll down and tap “Add to Home Screen”.</li>
                <li>Tap “Add”.</li>
              </ol>
            ) : (
              <p className="customer-onboarding__help-copy">
                Direct installation is not available from this browser right now. When your browser offers installation, use its install icon or browser menu.
              </p>
            )}
            <button ref={installHelpCloseRef} type="button" className="customer-onboarding__help-close" onClick={() => setInstallHelp(null)}>
              Close
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default CustomerOnboarding;
