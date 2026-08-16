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

function formatDateRange(start, end) {
  const values = [formatDate(start), formatDate(end)].filter(Boolean);

  if (values.length === 0) {
    return "Active date pending";
  }

  return values.join(" - ");
}

function buildTickerMessage({ announcement, reflection }) {
  const batchNumber = announcement.batchNumber || "current batch";
  const activeDate = formatDateRange(
    announcement.batchWindowStart,
    announcement.batchWindowEnd,
  );
  const reflectionText = reflection.headline || "Daily reflection";
  const verse = reflection.verse || "Genesis 1:1";

  return (
    `Orders  are open  for   (${activeDate}) for the Batch  ${batchNumber} | ` +
    " " +
    "Sea freight shipment takes 1-2 months after the active batch date is closed | " +
    "Air freight shipment takes 10-16 days after the active batch date is closed | " +
    `${reflectionText} (${verse})`
  );
}

function SiteBannerStrip({ banner = defaultSiteBanner }) {
  const safeBanner = normalizeSiteBanner(banner);
  const { announcement, reflection, updatedAt } = safeBanner;
  const tickerMessage = buildTickerMessage({ announcement, reflection });

  return (
    <section
      className="site-banner-strip"
      aria-label="Batch announcement and daily reflection"
    >
      <div className="site-banner-strip__inner">
        <article className="site-banner-strip__announcement-card">
          <div className="site-banner-strip__badge">
            <CalendarIcon />
            <span>{announcement.label || "Announcement"}</span>
          </div>

          <div className="site-banner-strip__announcement-copy">
            <p className="site-banner-strip__eyebrow">
              Batch {announcement.batchNumber}
            </p>
            <p className="site-banner-strip__meta">
              Active date:{" "}
              {formatDateRange(
                announcement.batchWindowStart,
                announcement.batchWindowEnd,
              )}
            </p>
          </div>
        </article>

        <div
          className="site-banner-strip__ticker"
          aria-label="Orders and reflection updates"
        >
          <div className="site-banner-strip__ticker-viewport">
            <div className="site-banner-strip__ticker-track">
              <p>{tickerMessage}</p>
              <p aria-hidden="true">{tickerMessage}</p>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

export default SiteBannerStrip;
