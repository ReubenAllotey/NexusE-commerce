import { useEffect, useState } from "react";
import logo from "../../assets/images/logo1.png";
import "./AppLoader.css";

const SPLASH_DURATION = 1500;
const FADE_DURATION = 500;

function AppLoader() {
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (!logoLoaded) {
      return undefined;
    }

    const fadeTimer = window.setTimeout(() => {
      setIsExiting(true);
    }, SPLASH_DURATION);
    const removeTimer = window.setTimeout(() => {
      setIsVisible(false);
    }, SPLASH_DURATION + FADE_DURATION);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [logoLoaded]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={`app-loader${isExiting ? " app-loader--exiting" : ""}`}
      role="status"
      aria-label="Loading Nexus Import Hub"
    >
      <div className="app-loader__content">
        <img
          className={`app-loader__logo${logoLoaded ? " is-ready" : ""}`}
          src={logo}
          alt="Nexus Import Hub"
          onLoad={() => setLogoLoaded(true)}
          onError={() => setLogoLoaded(true)}
        />
        <p className="app-loader__tagline">Importing Made Simple.</p>
        <div className="app-loader__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

export default AppLoader;
