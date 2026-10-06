import { useEffect, useRef, useState } from "react";
import {
  defaultSiteBanner,
  normalizeSiteBanner,
} from "../../shared/siteBannerStorage";

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function MegaphoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 10 11-4v12L4 14z" />
      <path d="M15 9h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-3" />
      <path d="m6 14 1.2 5h3L9 15" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5z" />
      <path d="M5 4.5v17M8.5 6H16M8.5 10H16" />
    </svg>
  );
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateRange(start, end) {
  const values = [formatDate(start), formatDate(end)].filter(Boolean);

  if (values.length === 0) {
    return "Active date pending";
  }

  return values.join(" - ");
}

function SiteBannerStrip({ banner = defaultSiteBanner, currentBatch = null }) {
  const tickerViewportRef = useRef(null);
  const tickerGroupRef = useRef(null);
  const [tickerDuration, setTickerDuration] = useState("45s");
  const safeBanner = normalizeSiteBanner(banner);
  const { announcement, reflection } = safeBanner;
  const announcementMessage = [announcement.headline, announcement.body]
    .filter(Boolean)
    .join(" - ");
  const reflectionMessage = [reflection.headline, reflection.body]
    .filter(Boolean)
    .join(" - ");
  const reflectionReference = reflection.verse;
  const reflectionTickerText = [reflectionMessage, reflectionReference].filter(Boolean).join(" - ");

  useEffect(() => {
    const updateTickerDuration = () => {
      const viewportWidth = tickerViewportRef.current?.clientWidth || 0;
      const groupWidth = tickerGroupRef.current?.getBoundingClientRect().width || 0;

      if (viewportWidth > 0 && groupWidth > 0) {
        const seconds = Math.max(18, (viewportWidth + groupWidth) / 40);
        setTickerDuration(`${seconds}s`);
      }
    };

    updateTickerDuration();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(updateTickerDuration);
    if (tickerViewportRef.current) {
      observer.observe(tickerViewportRef.current);
    }
    if (tickerGroupRef.current) {
      observer.observe(tickerGroupRef.current);
    }

    return () => observer.disconnect();
  }, [announcementMessage, reflectionTickerText]);

  const renderTickerGroup = (ref = null, hidden = false) => (
    <span
      ref={ref}
      className={`site-banner-strip__ticker-group${hidden ? " site-banner-strip__ticker-group--clone" : ""}`}
      aria-hidden={hidden ? "true" : undefined}
    >
      <span className="site-banner-strip__ticker-announcement">{announcementMessage}</span>
      <span className="site-banner-strip__ticker-separator" aria-hidden="true">
        •
      </span>
      <span className="site-banner-strip__ticker-reflection">
        <BookIcon />
        <strong>Daily Reflection</strong>
        <span>{reflectionTickerText}</span>
      </span>
      <span className="site-banner-strip__ticker-separator" aria-hidden="true">
        •
      </span>
    </span>
  );
  const activeBatchNumber = currentBatch?.batchNumber?.trim() || "";
  const activeBatchStart = currentBatch?.startDate || "";
  const activeBatchEnd = currentBatch?.endDate || "";
  const hasActiveBatch = Boolean(activeBatchNumber || activeBatchStart || activeBatchEnd);

  return (
    <div className="site-banner-strip" aria-label="Store announcement and current batch">
      <section className="site-banner-strip__announcement-bar" aria-label="Store announcement ticker">
        <div className="site-banner-strip__announcement-fixed">
          <MegaphoneIcon />
          <strong>Announcement</strong>
        </div>
        <div
          ref={tickerViewportRef}
          className="site-banner-strip__ticker-viewport"
          role="status"
          aria-live="polite"
        >
          <div
            className="site-banner-strip__ticker-track"
            style={{ "--ticker-duration": tickerDuration }}
          >
            {renderTickerGroup(tickerGroupRef)}
            {renderTickerGroup(null, true)}
          </div>
        </div>
      </section>

      <section className="site-banner-strip__batch-bar" aria-label="Current batch">
        <div className="site-banner-strip__bar-inner">
          <div className="site-banner-strip__batch-summary">
            <span className="site-banner-strip__batch-icon" aria-hidden="true">
              <CalendarIcon />
            </span>
            <span className="site-banner-strip__batch-copy">
              <strong>Current batch</strong>
              <b>{hasActiveBatch ? activeBatchNumber : "No active batch"}</b>
            </span>
          </div>
          <span className="site-banner-strip__batch-divider" aria-hidden="true" />
          <div className="site-banner-strip__batch-date">
            <CalendarIcon />
            <span>{hasActiveBatch ? `Active date: ${formatDateRange(activeBatchStart, activeBatchEnd)}` : "Active date pending"}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

export default SiteBannerStrip;
