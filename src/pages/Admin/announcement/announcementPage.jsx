import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import { formatDateTime } from "../adminHelpers";
import {
  ANNOUNCEMENT_CATEGORY_OPTIONS,
  getAnnouncementAudienceLabel,
  getAnnouncementMetrics,
  getAnnouncementStatus,
  getAnnouncementStatusLabel,
  getAnnouncementStatusTone,
  normalizeAnnouncementCategory,
  saveAnnouncement,
  deleteAnnouncement,
  useAnnouncements,
} from "./announcementStorage";
import {
  defaultSiteBanner,
  normalizeSiteBanner,
} from "../../../shared/siteBannerStorage";

function StatCard({ label, value, note, tone = "blue" }) {
  return (
    <article className={`admin-announcement-stat admin-announcement-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Pill({ children, tone = "slate" }) {
  return <span className={`admin-announcement-pill admin-announcement-pill--${tone}`}>{children}</span>;
}

function ModalShell({ title, subtitle, onClose, children, actions }) {
  return (
    <div className="admin-announcement-modal" role="dialog" aria-modal="true">
      <button
        type="button"
        className="admin-announcement-modal__scrim"
        aria-label={`Close ${title}`}
        onClick={onClose}
      />

      <aside className="admin-announcement-modal__panel">
        <header className="admin-announcement-modal__header">
          <div>
            <p>Admin section</p>
            <h2>{title}</h2>
            <span>{subtitle}</span>
          </div>

          <button
            type="button"
            className="admin-announcement-modal__close"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="admin-announcement-modal__body">{children}</div>

        {actions ? <footer className="admin-announcement-modal__actions">{actions}</footer> : null}
      </aside>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="admin-announcement-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function formatDate(value) {
  if (!value) {
    return "Not set";
  }

  return formatDateTime(value);
}

function createAnnouncementDraft(announcement = null) {
  const base = announcement
    ? {
        title: announcement.title ?? "",
        category: normalizeAnnouncementCategory(announcement.category),
        body: announcement.body ?? "",
        publishDate: announcement.publishDate ? String(announcement.publishDate).slice(0, 10) : "",
        expireDate: announcement.expireDate ? String(announcement.expireDate).slice(0, 10) : "",
      }
    : {
        title: "",
        category: "shipping-update",
        body: "",
        publishDate: new Date().toISOString().slice(0, 10),
        expireDate: "",
      };

  return base;
}

function createReflectionDraft(siteBanner) {
  const safeBanner = normalizeSiteBanner(siteBanner ?? defaultSiteBanner);
  return {
    headline: safeBanner.reflection.headline,
    verse: safeBanner.reflection.verse,
  };
}

function createBatchDraft(siteBanner) {
  const safeBanner = normalizeSiteBanner(siteBanner ?? defaultSiteBanner);
  return {
    batchNumber: safeBanner.announcement.batchNumber,
    headline: safeBanner.announcement.headline,
    body: safeBanner.announcement.body,
    batchWindowStart: safeBanner.announcement.batchWindowStart ? String(safeBanner.announcement.batchWindowStart).slice(0, 10) : "",
    batchWindowEnd: safeBanner.announcement.batchWindowEnd ? String(safeBanner.announcement.batchWindowEnd).slice(0, 10) : "",
    shippingMode: safeBanner.announcement.shippingMode,
    airTransitDays: String(safeBanner.announcement.airTransitDays),
    seaTransitDays: String(safeBanner.announcement.seaTransitDays),
  };
}

function getCategoryOptionLabel(value) {
  return ANNOUNCEMENT_CATEGORY_OPTIONS.find((item) => item.value === value)?.label ?? "Announcement";
}

function getAnnouncementSearchBlob(announcement) {
  return [
    announcement.title,
    getCategoryOptionLabel(announcement.category),
    getAnnouncementAudienceLabel(announcement.category),
    getAnnouncementStatusLabel(getAnnouncementStatus(announcement)),
    announcement.body,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function AnnouncementPage({
  orders = [],
  onCreateNotification = () => {},
  siteBanner = defaultSiteBanner,
  onUpdateSiteBanner = () => {},
}) {
  const session = loadAdminSession();
  const {
    announcements,
    loading: announcementsLoading,
    error: announcementsLoadError,
    refresh: refreshAnnouncements,
  } = useAnnouncements({ includeArchived: true });
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [audienceFilter, setAudienceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeAnnouncementId, setActiveAnnouncementId] = useState("");
  const [editingAnnouncementId, setEditingAnnouncementId] = useState("");
  const [announcementModalMode, setAnnouncementModalMode] = useState("");
  const [announcementDraft, setAnnouncementDraft] = useState(() => createAnnouncementDraft());
  const [announcementError, setAnnouncementError] = useState("");
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const [reflectionDraft, setReflectionDraft] = useState(() => createReflectionDraft(siteBanner));
  const [batchDraft, setBatchDraft] = useState(() => createBatchDraft(siteBanner));
  const [openReflectionModal, setOpenReflectionModal] = useState(false);
  const [openBatchModal, setOpenBatchModal] = useState(false);

  useEffect(() => {
    setReflectionDraft(createReflectionDraft(siteBanner));
    setBatchDraft(createBatchDraft(siteBanner));
  }, [siteBanner]);

  const metrics = useMemo(() => getAnnouncementMetrics(announcements), [announcements]);

  const filteredAnnouncements = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return [...announcements]
      .sort((left, right) => new Date(right.updatedAt ?? right.createdAt ?? 0) - new Date(left.updatedAt ?? left.createdAt ?? 0))
      .filter((announcement) => {
        const status = getAnnouncementStatus(announcement);
        const categoryLabel = getCategoryOptionLabel(announcement.category);
        const audienceLabel = getAnnouncementAudienceLabel(announcement.category);
        const matchesStatus = statusFilter === "all" || status === statusFilter;
        const matchesCategory =
          categoryFilter === "all" ||
          normalizeAnnouncementCategory(announcement.category) === categoryFilter;
        const matchesAudience =
          audienceFilter === "all" ||
          announcement.audienceKey === audienceFilter ||
          audienceLabel.toLowerCase() === audienceFilter;
        const matchesSearch =
          !term ||
          getAnnouncementSearchBlob(announcement).includes(term) ||
          categoryLabel.toLowerCase().includes(term) ||
          audienceLabel.toLowerCase().includes(term);

        return matchesStatus && matchesCategory && matchesAudience && matchesSearch;
      });
  }, [announcements, audienceFilter, categoryFilter, searchTerm, statusFilter]);

  const activeAnnouncement = useMemo(
    () => announcements.find((announcement) => announcement.id === activeAnnouncementId) ?? null,
    [activeAnnouncementId, announcements],
  );

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  const closeAnnouncementModal = () => {
    setAnnouncementModalMode("");
    setEditingAnnouncementId("");
    setAnnouncementDraft(createAnnouncementDraft());
    setAnnouncementError("");
    setAnnouncementMessage("");
  };

  const openAddModal = () => {
    setAnnouncementDraft(createAnnouncementDraft());
    setAnnouncementModalMode("add");
    setAnnouncementError("");
    setAnnouncementMessage("");
  };

  const openEditModal = (announcement) => {
    setAnnouncementDraft(createAnnouncementDraft(announcement));
    setEditingAnnouncementId(announcement.id);
    setActiveAnnouncementId("");
    setAnnouncementModalMode("edit");
    setAnnouncementError("");
    setAnnouncementMessage("");
  };

  const handleAnnouncementSave = async () => {
    const title = announcementDraft.title.trim();
    const body = announcementDraft.body.trim();
    const category = normalizeAnnouncementCategory(announcementDraft.category);

    if (!title || !body) {
      setAnnouncementError("Please add a title and message before saving.");
      setAnnouncementMessage("");
      return;
    }

    const result = await saveAnnouncement({
      id: announcementModalMode === "edit" ? editingAnnouncementId : "",
      title,
      category,
      message: body,
      publishDate: announcementDraft.publishDate,
      expireDate: announcementDraft.expireDate,
    });

    if (!result.ok) {
      setAnnouncementError(result.message || "Unable to save the announcement.");
      setAnnouncementMessage("");
      return;
    }

    await refreshAnnouncements();
    setAnnouncementMessage("Announcement saved successfully.");
    setAnnouncementError("");
    setAnnouncementModalMode("");
    setEditingAnnouncementId("");
    setAnnouncementDraft(createAnnouncementDraft());
  };

  const handleDeleteAnnouncement = async (announcementId) => {
    const confirmDelete = window.confirm(
      "Delete this announcement? This cannot be undone.",
    );

    if (!confirmDelete) {
      return;
    }

    const result = await deleteAnnouncement(announcementId);

    if (!result.ok) {
      setAnnouncementError(result.message || "Unable to delete the announcement.");
      setAnnouncementMessage("");
      return;
    }

    await refreshAnnouncements();

    if (activeAnnouncementId === announcementId) {
      setActiveAnnouncementId("");
    }
    setAnnouncementMessage("Announcement deleted.");
  };

  const handleSaveReflection = async () => {
    if (!reflectionDraft.headline.trim() || !reflectionDraft.verse.trim()) {
      setAnnouncementError("Please add both a reflection headline and verse.");
      setAnnouncementMessage("");
      return;
    }

    const result = await onUpdateSiteBanner({
      reflection: {
        ...normalizeSiteBanner(siteBanner).reflection,
        headline: reflectionDraft.headline.trim(),
        verse: reflectionDraft.verse.trim(),
      },
    });

    if (!result?.ok) {
      setAnnouncementError(result?.message || "Unable to update the banner.");
      setAnnouncementMessage("");
      return;
    }

    setAnnouncementMessage("Daily reflection updated on the home banner.");
    setAnnouncementError("");
    setOpenReflectionModal(false);
  };

  const handleSaveBatch = async () => {
    if (!batchDraft.batchNumber.trim() || !batchDraft.headline.trim() || !batchDraft.body.trim()) {
      setAnnouncementError("Please complete the batch number, headline, and body.");
      setAnnouncementMessage("");
      return;
    }

    const result = await onUpdateSiteBanner({
      announcement: {
        ...normalizeSiteBanner(siteBanner).announcement,
        label: "Announcement",
        batchNumber: batchDraft.batchNumber.trim(),
        headline: batchDraft.headline.trim(),
        body: batchDraft.body.trim(),
        batchWindowStart: batchDraft.batchWindowStart,
        batchWindowEnd: batchDraft.batchWindowEnd,
        shippingMode: batchDraft.shippingMode,
        airTransitDays: Number(batchDraft.airTransitDays) || 16,
        seaTransitDays: Number(batchDraft.seaTransitDays) || 30,
      },
    });

    if (!result?.ok) {
      setAnnouncementError(result?.message || "Unable to update the banner.");
      setAnnouncementMessage("");
      return;
    }

    setAnnouncementMessage("Batch announcement updated on the home banner.");
    setAnnouncementError("");
    setOpenBatchModal(false);
  };

  return (
    <main className="admin-announcement-page">
      <section className="admin-announcement-shell">
        <header className="admin-announcement-header">
          <div className="admin-announcement-header__copy">
            <p>Admin section</p>
            <h1>Announcements</h1>
            <span>Create targeted announcements, send notifications to users, and keep the homepage banner updated.</span>
          </div>

          <div className="admin-announcement-header__actions">
            <Link to="/admin/dashboard" className="admin-announcement-header__button admin-announcement-header__button--ghost">
              Back to dashboard
            </Link>
            <button type="button" className="admin-announcement-header__button" onClick={openAddModal}>
              Add New Announcement
            </button>
            <button
              type="button"
              className="admin-announcement-header__button admin-announcement-header__button--secondary"
              onClick={() => setOpenReflectionModal(true)}
            >
              Update Daily Reflection
            </button>
            <button
              type="button"
              className="admin-announcement-header__button admin-announcement-header__button--accent"
              onClick={() => setOpenBatchModal(true)}
            >
              Update Batch Announcement
            </button>
          </div>
        </header>

        <section className="admin-announcement-summary">
          <StatCard
            label="Total Announcements"
            value={metrics.totalAnnouncements}
            note="All saved announcement records."
            tone="indigo"
          />
          <StatCard
            label="Active"
            value={metrics.activeAnnouncements}
            note="Currently visible to users."
            tone="green"
          />
          <StatCard
            label="Scheduled"
            value={metrics.scheduledAnnouncements}
            note="Waiting for their publish date."
            tone="amber"
          />
          <StatCard
            label="Expired"
            value={metrics.expiredAnnouncements}
            note="Past their active date range."
            tone="rose"
          />
        </section>

        <section className="admin-announcement-panel">
          <div className="admin-announcement-toolbar">
            <label className="admin-announcement-search" htmlFor="announcement-search">
              <span>Search by Announcement Title</span>
              <input
                id="announcement-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search announcements"
              />
            </label>

            <label className="admin-announcement-filter" htmlFor="announcement-category">
              <span>Category</span>
              <select
                id="announcement-category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="all">All Categories</option>
                {ANNOUNCEMENT_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-announcement-filter" htmlFor="announcement-audience">
              <span>Audience</span>
              <select
                id="announcement-audience"
                value={audienceFilter}
                onChange={(event) => setAudienceFilter(event.target.value)}
              >
                <option value="all">All Audiences</option>
                <option value="all_users">All users</option>
                <option value="active_orders">Users with active orders</option>
                <option value="pending_payment">Users with pending payment</option>
              </select>
            </label>

            <label className="admin-announcement-filter" htmlFor="announcement-status">
              <span>Status</span>
              <select
                id="announcement-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="scheduled">Scheduled</option>
                <option value="expired">Expired</option>
              </select>
            </label>
          </div>

          {announcementsLoadError ? (
            <p className="admin-announcement-message admin-announcement-message--error">
              {announcementsLoadError}
            </p>
          ) : null}
          {announcementError ? <p className="admin-announcement-message admin-announcement-message--error">{announcementError}</p> : null}
          {announcementMessage ? <p className="admin-announcement-message admin-announcement-message--success">{announcementMessage}</p> : null}

          <div className="admin-announcement-table-wrap">
            <table className="admin-announcement-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Audience</th>
                  <th>Status</th>
                  <th>Publish Date</th>
                  <th>Expire Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {announcementsLoading && filteredAnnouncements.length === 0 ? (
                  <tr className="admin-announcement-empty-row">
                    <td colSpan="7">
                      <div className="admin-announcement-empty">
                        <h2>Loading announcements...</h2>
                        <p>We are syncing the latest announcement records from Supabase.</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredAnnouncements.length > 0 ? (
                  filteredAnnouncements.map((announcement) => {
                    const status = getAnnouncementStatus(announcement);

                    return (
                      <tr key={announcement.id} className="admin-announcement-row">
                        <td>
                          <strong>{announcement.title}</strong>
                          <small>{announcement.body}</small>
                        </td>
                        <td>{getCategoryOptionLabel(announcement.category)}</td>
                        <td>{getAnnouncementAudienceLabel(announcement.category)}</td>
                        <td>
                          <Pill tone={getAnnouncementStatusTone(status)}>
                            {getAnnouncementStatusLabel(status)}
                          </Pill>
                        </td>
                        <td>{formatDate(announcement.publishDate)}</td>
                        <td>{formatDate(announcement.expireDate)}</td>
                        <td>
                          <div className="admin-announcement-actions">
                            <button
                              type="button"
                              className="admin-announcement-action admin-announcement-action--ghost"
                              onClick={() => setActiveAnnouncementId(announcement.id)}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="admin-announcement-action admin-announcement-action--primary"
                              onClick={() => openEditModal(announcement)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="admin-announcement-action admin-announcement-action--danger"
                              onClick={() => handleDeleteAnnouncement(announcement.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr className="admin-announcement-empty-row">
                    <td colSpan="7">
                      <div className="admin-announcement-empty">
                        <h2>No announcements found.</h2>
                        <p>Try another search term or change the filters.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {announcementModalMode ? (
        <ModalShell
          title={announcementModalMode === "edit" ? "Edit Announcement" : "Add New Announcement"}
          subtitle="Publish a message and notify the right customers."
          onClose={closeAnnouncementModal}
          actions={
            <>
              <button
                type="button"
                className="admin-announcement-modal__button admin-announcement-modal__button--ghost"
                onClick={closeAnnouncementModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-announcement-modal__button admin-announcement-modal__button--primary"
                onClick={handleAnnouncementSave}
              >
                {announcementModalMode === "edit" ? "Save Changes" : "Publish Announcement"}
              </button>
            </>
          }
        >
          <div className="admin-announcement-modal__grid">
            <Field label="Title">
              <input
                type="text"
                value={announcementDraft.title}
                onChange={(event) =>
                  setAnnouncementDraft((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="Announcement title"
              />
            </Field>

            <Field label="Category">
              <select
                value={announcementDraft.category}
                onChange={(event) =>
                  setAnnouncementDraft((current) => ({ ...current, category: event.target.value }))
                }
              >
                {ANNOUNCEMENT_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Audience"
              hint="The audience is derived automatically from the selected category."
            >
              <input
                type="text"
                readOnly
                value={getAnnouncementAudienceLabel(announcementDraft.category)}
              />
            </Field>

            <Field label="Message">
              <textarea
                rows="6"
                value={announcementDraft.body}
                onChange={(event) =>
                  setAnnouncementDraft((current) => ({ ...current, body: event.target.value }))
                }
                placeholder="Write the notification message"
              />
            </Field>

            <Field label="Publish Date">
              <input
                type="date"
                value={announcementDraft.publishDate}
                onChange={(event) =>
                  setAnnouncementDraft((current) => ({
                    ...current,
                    publishDate: event.target.value,
                  }))
                }
              />
            </Field>

            <Field label="Expire Date">
              <input
                type="date"
                value={announcementDraft.expireDate}
                onChange={(event) =>
                  setAnnouncementDraft((current) => ({
                    ...current,
                    expireDate: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
        </ModalShell>
      ) : null}

      {openReflectionModal ? (
        <ModalShell
          title="Update Daily Reflection"
          subtitle="Change the homepage reflection text and verse."
          onClose={() => setOpenReflectionModal(false)}
          actions={
            <>
              <button
                type="button"
                className="admin-announcement-modal__button admin-announcement-modal__button--ghost"
                onClick={() => setOpenReflectionModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-announcement-modal__button admin-announcement-modal__button--primary"
                onClick={handleSaveReflection}
              >
                Save Reflection
              </button>
            </>
          }
        >
          <div className="admin-announcement-modal__grid">
            <Field label="Headline">
              <textarea
                rows="5"
                value={reflectionDraft.headline}
                onChange={(event) =>
                  setReflectionDraft((current) => ({ ...current, headline: event.target.value }))
                }
                placeholder="Write the daily reflection headline"
              />
            </Field>
            <Field label="Verse">
              <input
                type="text"
                value={reflectionDraft.verse}
                onChange={(event) =>
                  setReflectionDraft((current) => ({ ...current, verse: event.target.value }))
                }
                placeholder="Proverbs 16:3"
              />
            </Field>
          </div>
        </ModalShell>
      ) : null}

      {openBatchModal ? (
        <ModalShell
          title="Update Batch Announcement"
          subtitle="Change the batch details and homepage shipping banner."
          onClose={() => setOpenBatchModal(false)}
          actions={
            <>
              <button
                type="button"
                className="admin-announcement-modal__button admin-announcement-modal__button--ghost"
                onClick={() => setOpenBatchModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-announcement-modal__button admin-announcement-modal__button--primary"
                onClick={handleSaveBatch}
              >
                Save Batch
              </button>
            </>
          }
        >
          <div className="admin-announcement-modal__grid">
            <Field label="Batch Number">
              <input
                type="text"
                value={batchDraft.batchNumber}
                onChange={(event) =>
                  setBatchDraft((current) => ({ ...current, batchNumber: event.target.value }))
                }
                placeholder="SEA-08"
              />
            </Field>

            <Field label="Headline">
              <input
                type="text"
                value={batchDraft.headline}
                onChange={(event) =>
                  setBatchDraft((current) => ({ ...current, headline: event.target.value }))
                }
                placeholder="Batch headline"
              />
            </Field>

            <Field label="Body">
              <textarea
                rows="5"
                value={batchDraft.body}
                onChange={(event) =>
                  setBatchDraft((current) => ({ ...current, body: event.target.value }))
                }
                placeholder="Describe the batch and shipping update"
              />
            </Field>

            <Field label="Batch Window Start">
              <input
                type="date"
                value={batchDraft.batchWindowStart}
                onChange={(event) =>
                  setBatchDraft((current) => ({
                    ...current,
                    batchWindowStart: event.target.value,
                  }))
                }
              />
            </Field>

            <Field label="Batch Window End">
              <input
                type="date"
                value={batchDraft.batchWindowEnd}
                onChange={(event) =>
                  setBatchDraft((current) => ({
                    ...current,
                    batchWindowEnd: event.target.value,
                  }))
                }
              />
            </Field>

            <Field label="Shipping Method">
              <select
                value={batchDraft.shippingMode}
                onChange={(event) =>
                  setBatchDraft((current) => ({ ...current, shippingMode: event.target.value }))
                }
              >
                <option value="sea">Sea</option>
                <option value="air">Air</option>
                <option value="both">Both</option>
              </select>
            </Field>

            <Field label="Air Transit Days">
              <input
                type="number"
                min="1"
                value={batchDraft.airTransitDays}
                onChange={(event) =>
                  setBatchDraft((current) => ({ ...current, airTransitDays: event.target.value }))
                }
              />
            </Field>

            <Field label="Sea Transit Days">
              <input
                type="number"
                min="1"
                value={batchDraft.seaTransitDays}
                onChange={(event) =>
                  setBatchDraft((current) => ({ ...current, seaTransitDays: event.target.value }))
                }
              />
            </Field>
          </div>
        </ModalShell>
      ) : null}

      {activeAnnouncement ? (
        <ModalShell
          title={activeAnnouncement.title}
          subtitle={`${getCategoryOptionLabel(activeAnnouncement.category)} | ${getAnnouncementAudienceLabel(activeAnnouncement.category)}`}
          onClose={() => setActiveAnnouncementId("")}
          actions={
            <>
              <button
                type="button"
                className="admin-announcement-modal__button admin-announcement-modal__button--ghost"
                onClick={() => setActiveAnnouncementId("")}
              >
                Close
              </button>
              <button
                type="button"
                className="admin-announcement-modal__button admin-announcement-modal__button--primary"
                onClick={() => {
                  setActiveAnnouncementId("");
                  openEditModal(activeAnnouncement);
                }}
              >
                Edit
              </button>
            </>
          }
        >
          <div className="admin-announcement-detail">
            <div className="admin-announcement-detail__meta">
              <div>
                <span>Category</span>
                <strong>{getCategoryOptionLabel(activeAnnouncement.category)}</strong>
              </div>
              <div>
                <span>Audience</span>
                <strong>{getAnnouncementAudienceLabel(activeAnnouncement.category)}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>
                  <Pill tone={getAnnouncementStatusTone(getAnnouncementStatus(activeAnnouncement))}>
                    {getAnnouncementStatusLabel(getAnnouncementStatus(activeAnnouncement))}
                  </Pill>
                </strong>
              </div>
              <div>
                <span>Publish</span>
                <strong>{formatDate(activeAnnouncement.publishDate)}</strong>
              </div>
              <div>
                <span>Expire</span>
                <strong>{formatDate(activeAnnouncement.expireDate)}</strong>
              </div>
              <div>
                <span>Sent</span>
                <strong>{activeAnnouncement.sentCount ?? 0} recipient{(activeAnnouncement.sentCount ?? 0) === 1 ? "" : "s"}</strong>
              </div>
            </div>

            <article className="admin-announcement-detail__body">
              <span>Message</span>
              <p>{activeAnnouncement.body}</p>
            </article>
          </div>
        </ModalShell>
      ) : null}
    </main>
  );
}

export default AnnouncementPage;
