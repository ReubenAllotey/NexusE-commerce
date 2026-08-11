import { useEffect, useState } from "react";
import {
  defaultSiteBanner,
  normalizeSiteBanner,
} from "../../../shared/siteBannerStorage";

function Field({ label, children, hint }) {
  return (
    <label className="admin-banner-editor__field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function createDraft(banner) {
  const safe = normalizeSiteBanner(banner ?? defaultSiteBanner);
  return {
    announcement: {
      label: safe.announcement.label,
      batchNumber: safe.announcement.batchNumber,
      headline: safe.announcement.headline,
      body: safe.announcement.body,
      batchWindowStart: safe.announcement.batchWindowStart,
      batchWindowEnd: safe.announcement.batchWindowEnd,
      shippingMode: safe.announcement.shippingMode,
      airTransitDays: String(safe.announcement.airTransitDays),
      seaTransitDays: String(safe.announcement.seaTransitDays),
      ctaLabel: safe.announcement.ctaLabel,
      ctaHref: safe.announcement.ctaHref,
    },
    reflection: {
      label: safe.reflection.label,
      headline: safe.reflection.headline,
      verse: safe.reflection.verse,
      body: safe.reflection.body,
    },
  };
}

function BannerEditor({ banner, onSave = () => {} }) {
  const [draft, setDraft] = useState(() => createDraft(banner));
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(createDraft(banner));
  }, [banner]);

  const updateAnnouncement = (key, value) => {
    setDraft((current) => ({
      ...current,
      announcement: {
        ...current.announcement,
        [key]: value,
      },
    }));
  };

  const updateReflection = (key, value) => {
    setDraft((current) => ({
      ...current,
      reflection: {
        ...current.reflection,
        [key]: value,
      },
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!draft.announcement.headline.trim() || !draft.reflection.headline.trim()) {
      setErrorMessage("Please add an announcement and daily reflection headline.");
      setStatusMessage("");
      return;
    }

    setIsSaving(true);

    try {
      const result = await onSave({
        announcement: {
          ...draft.announcement,
          airTransitDays: Number(draft.announcement.airTransitDays) || 16,
          seaTransitDays: Number(draft.announcement.seaTransitDays) || 30,
        },
        reflection: draft.reflection,
      });

      if (result?.ok === false) {
        setErrorMessage(result.message || "Unable to update the banner.");
        setStatusMessage("");
        return;
      }

      setErrorMessage("");
      setStatusMessage("Banner updated successfully.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(createDraft(defaultSiteBanner));
    setErrorMessage("");
    setStatusMessage("Reset to default banner content.");
  };

  return (
    <div className="admin-banner-editor">
      <form className="admin-banner-editor__form" onSubmit={handleSubmit}>
        <div className="admin-banner-editor__layout">
          <fieldset className="admin-banner-editor__panel">
            <legend>Announcement Banner</legend>

            <Field label="Banner label" hint="Shown as the gold badge on the home page.">
              <input
                type="text"
                value={draft.announcement.label}
                onChange={(event) => updateAnnouncement("label", event.target.value)}
              />
            </Field>

            <Field label="Batch number">
              <input
                type="text"
                value={draft.announcement.batchNumber}
                onChange={(event) => updateAnnouncement("batchNumber", event.target.value)}
                placeholder="SEA-08"
              />
            </Field>

            <Field label="Headline">
              <input
                type="text"
                value={draft.announcement.headline}
                onChange={(event) => updateAnnouncement("headline", event.target.value)}
              />
            </Field>

            <Field label="Announcement copy">
              <textarea
                rows="5"
                value={draft.announcement.body}
                onChange={(event) => updateAnnouncement("body", event.target.value)}
              />
            </Field>

            <div className="admin-banner-editor__grid">
              <Field label="Batch start">
                <input
                  type="date"
                  value={draft.announcement.batchWindowStart}
                  onChange={(event) =>
                    updateAnnouncement("batchWindowStart", event.target.value)
                  }
                />
              </Field>

              <Field label="Batch end">
                <input
                  type="date"
                  value={draft.announcement.batchWindowEnd}
                  onChange={(event) =>
                    updateAnnouncement("batchWindowEnd", event.target.value)
                  }
                />
              </Field>
            </div>

            <Field label="Shipment type">
              <select
                value={draft.announcement.shippingMode}
                onChange={(event) => updateAnnouncement("shippingMode", event.target.value)}
              >
                <option value="sea">Sea freight</option>
                <option value="air">Air freight</option>
                <option value="both">Both</option>
              </select>
            </Field>

            <div className="admin-banner-editor__grid">
              <Field label="Air freight days">
                <input
                  type="number"
                  min="1"
                  value={draft.announcement.airTransitDays}
                  onChange={(event) =>
                    updateAnnouncement("airTransitDays", event.target.value)
                  }
                />
              </Field>

              <Field label="Sea freight days">
                <input
                  type="number"
                  min="1"
                  value={draft.announcement.seaTransitDays}
                  onChange={(event) =>
                    updateAnnouncement("seaTransitDays", event.target.value)
                  }
                />
              </Field>
            </div>

            <div className="admin-banner-editor__grid">
              <Field label="Button label">
                <input
                  type="text"
                  value={draft.announcement.ctaLabel}
                  onChange={(event) => updateAnnouncement("ctaLabel", event.target.value)}
                />
              </Field>

              <Field label="Button link">
                <input
                  type="text"
                  value={draft.announcement.ctaHref}
                  onChange={(event) => updateAnnouncement("ctaHref", event.target.value)}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className="admin-banner-editor__panel">
            <legend>Daily Reflection</legend>

            <Field label="Banner label" hint="Shown beside the book icon.">
              <input
                type="text"
                value={draft.reflection.label}
                onChange={(event) => updateReflection("label", event.target.value)}
              />
            </Field>

            <Field label="Reflection">
              <textarea
                rows="5"
                value={draft.reflection.headline}
                onChange={(event) => updateReflection("headline", event.target.value)}
              />
            </Field>

            <div className="admin-banner-editor__grid">
              <Field label="Verse reference">
                <input
                  type="text"
                  value={draft.reflection.verse}
                  onChange={(event) => updateReflection("verse", event.target.value)}
                  placeholder="Proverbs 16:3"
                />
              </Field>

              <Field label="Short note">
                <input
                  type="text"
                  value={draft.reflection.body}
                  onChange={(event) => updateReflection("body", event.target.value)}
                  placeholder="A short encouragement for the day"
                />
              </Field>
            </div>
          </fieldset>
        </div>

        {errorMessage ? <p className="admin-banner-editor__message admin-banner-editor__message--error">{errorMessage}</p> : null}
        {statusMessage ? <p className="admin-banner-editor__message admin-banner-editor__message--success">{statusMessage}</p> : null}

        <div className="admin-banner-editor__actions">
          <button type="button" className="admin-banner-editor__button admin-banner-editor__button--ghost" onClick={handleReset}>
            Reset to defaults
          </button>
          <button
            type="submit"
            className="admin-banner-editor__button admin-banner-editor__button--primary"
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Banner"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default BannerEditor;
