import { defaultSiteBanner, normalizeSiteBanner } from "../../shared/siteBannerStorage";

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3V4Z" />
      <path d="M8 8h6M8 12h6" />
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

function getShippingLabel(mode, airDays, seaDays) {
  if (mode === "both") {
    return `Air freight about ${airDays} days | Sea freight about ${seaDays} days`;
  }

  return mode === "air"
    ? `Air freight about ${airDays} days`
    : `Sea freight about ${seaDays} days`;
}

function SiteBannerStrip({ banner = defaultSiteBanner }) {
  const safeBanner = normalizeSiteBanner(banner);
  const { announcement, reflection, updatedAt } = safeBanner;
  const orderWindow = [formatDate(announcement.batchWindowStart), formatDate(announcement.batchWindowEnd)]
    .filter(Boolean)
    .join(" - ");

  return (
    <section className="site-banner-strip" aria-label="Announcement and daily reflection">
      <div className="site-banner-strip__inner">
        <div className="site-banner-strip__announcement">
          <div className="site-banner-strip__badge">
            <CalendarIcon />
            <span>{announcement.label}</span>
          </div>

          <div className="site-banner-strip__content">
            <p className="site-banner-strip__eyebrow">
              Batch {announcement.batchNumber}
            </p>
            <h2>{announcement.headline}</h2>
            <p>{announcement.body}</p>
            <p className="site-banner-strip__meta">
              Orders: {orderWindow || "Date range pending"} | {getShippingLabel(announcement.shippingMode, announcement.airTransitDays, announcement.seaTransitDays)}
            </p>
            <a href={announcement.ctaHref} className="site-banner-strip__link">
              {announcement.ctaLabel} <span aria-hidden="true">-&gt;</span>
            </a>
          </div>
        </div>

        <div className="site-banner-strip__divider" aria-hidden="true" />

        <div className="site-banner-strip__reflection">
          <div className="site-banner-strip__reflection-head">
            <BookIcon />
            <span>{reflection.label}</span>
          </div>
          <p className="site-banner-strip__reflection-copy">{reflection.headline}</p>
          <p className="site-banner-strip__reflection-verse">- {reflection.verse}</p>
          {reflection.body ? <span>{reflection.body}</span> : null}
        </div>

        <span className="site-banner-strip__updated">
          Updated {formatDate(updatedAt) || "just now"}
        </span>
      </div>
    </section>
  );
}

export default SiteBannerStrip;
