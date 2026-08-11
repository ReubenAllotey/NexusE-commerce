import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDateTime } from "../adminHelpers";
import {
  deleteSupportMessage,
  getRecentSupportMessages,
  getSupportMetrics,
  getSupportStatusLabel,
  getSupportStatusTone,
  loadStoredSupportMessages,
  markSupportMessageViewed,
  normalizeSupportStatus,
  replyToSupportMessage,
  setSupportMessageStatus,
} from "../../Profile/supportInboxStorage";
import {
  deleteContactMessage,
  getContactMetrics,
  getContactStatusLabel,
  getContactStatusTone,
  loadContactMessages,
  normalizeContactStatus,
  replyToContactMessage,
  setContactMessageStatus,
} from "../../Contact/contactStorage";

function MetricCard({ title, value, note }) {
  return (
    <article className="admin-support-metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function formatDaysAgo(value) {
  if (!value) {
    return "Today";
  }

  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) {
    return "Today";
  }

  const days = Math.max(Math.floor(diff / 86400000), 0);
  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "1 day ago";
  }

  return `${days} days ago`;
}

function getMessageTypeLabel(messageType) {
  return messageType === "contact" ? "Contact" : "Support";
}

function getMessageTypeTone(messageType) {
  return messageType === "contact" ? "green" : "blue";
}

function getMessageStatusLabel(message) {
  return message.messageType === "contact"
    ? getContactStatusLabel(message.status)
    : getSupportStatusLabel(message.status);
}

function normalizeMessageStatus(message) {
  return message.messageType === "contact"
    ? normalizeContactStatus(message.status)
    : normalizeSupportStatus(message.status);
}

function SupportStatusPill({ messageType, status }) {
  const tone = messageType === "contact" ? getContactStatusTone(status) : getSupportStatusTone(status);

  return (
    <span className={`admin-support-pill admin-support-pill--${tone}`}>
      {messageType === "contact" ? getContactStatusLabel(status) : getSupportStatusLabel(status)}
    </span>
  );
}

function SupportInboxPage() {
  const [supportMessages, setSupportMessages] = useState([]);
  const [contactMessages, setContactMessages] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [activeMessageId, setActiveMessageId] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [formError, setFormError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function loadMessages() {
      setIsLoading(true);

      try {
        const [nextSupportMessages, nextContactMessages] = await Promise.all([
          loadStoredSupportMessages({ includeAll: true }),
          loadContactMessages(),
        ]);

        if (!isActive) {
          return;
        }

        setSupportMessages(nextSupportMessages);
        setContactMessages(nextContactMessages);
      } catch (error) {
        if (isActive) {
          setFormError(error instanceof Error ? error.message : "Unable to load the inbox.");
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadMessages();

    return () => {
      isActive = false;
    };
  }, []);

  const inboxMessages = useMemo(() => {
    const combined = [...supportMessages, ...contactMessages];
    return getRecentSupportMessages(combined, 500);
  }, [supportMessages, contactMessages]);

  const metrics = useMemo(() => {
    const supportMetrics = getSupportMetrics(supportMessages);
    const contactMetrics = getContactMetrics(contactMessages);
    return {
      totalMessages: supportMetrics.totalMessages + contactMetrics.totalMessages,
      newMessages: supportMetrics.newMessages + contactMetrics.newMessages,
      openMessages: supportMetrics.openMessages + contactMetrics.openMessages,
      resolvedMessages: supportMetrics.resolvedMessages + contactMetrics.resolvedMessages,
    };
  }, [supportMessages, contactMessages]);

  const filteredMessages = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return inboxMessages.filter((message) => {
      const messageType = message.messageType === "contact" ? "contact" : "support";
      const matchesType = typeFilter === "all" || messageType === typeFilter;
      const matchesStatus =
        statusFilter === "all" || normalizeMessageStatus(message) === statusFilter;
      const matchesSearch =
        term.length === 0 ||
        `${message.customerName ?? ""} ${message.customerEmail ?? ""} ${message.title ?? ""} ${message.message ?? ""} ${messageType}`
          .toLowerCase()
          .includes(term);

      return matchesType && matchesStatus && matchesSearch;
    });
  }, [inboxMessages, searchTerm, statusFilter, typeFilter]);

  const activeMessage = useMemo(
    () => inboxMessages.find((message) => message.id === activeMessageId) ?? null,
    [activeMessageId, inboxMessages],
  );

  useEffect(() => {
    if (!activeMessageId) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setActiveMessageId("");
        setReplyDraft("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeMessageId]);

  const syncMessage = (nextMessage) => {
    if (nextMessage.messageType === "contact") {
      setContactMessages((current) =>
        current.map((message) => (message.id === nextMessage.id ? nextMessage : message)),
      );
      return;
    }

    setSupportMessages((current) =>
      current.map((message) => (message.id === nextMessage.id ? nextMessage : message)),
    );
  };

  const removeMessage = (messageId, messageType) => {
    if (messageType === "contact") {
      setContactMessages((current) => current.filter((message) => message.id !== messageId));
      return;
    }

    setSupportMessages((current) => current.filter((message) => message.id !== messageId));
  };

  const handleViewMessage = async (message) => {
    setFormError("");

    const result =
      message.messageType === "contact"
        ? await setContactMessageStatus(message.id, "open")
        : await markSupportMessageViewed(message.id);

    if (!result.ok) {
      setFormError(result.message || "Unable to open this message.");
      return;
    }

    syncMessage(result.message);
    setActiveMessageId(message.id);
    setReplyDraft(result.message.replyMessage ?? "");
  };

  const handleToggleStatus = async (message) => {
    const currentStatus = normalizeMessageStatus(message);
    const nextStatus = currentStatus === "resolved" ? "open" : "resolved";
    const result =
      message.messageType === "contact"
        ? await setContactMessageStatus(message.id, nextStatus)
        : await setSupportMessageStatus(message.id, nextStatus);

    if (!result.ok) {
      setFormError(result.message || "Unable to change the message status.");
      return;
    }

    syncMessage(result.message);
    if (activeMessageId === message.id) {
      setReplyDraft(result.message.replyMessage ?? "");
    }
    setFormError("");
  };

  const handleDeleteMessage = async (message) => {
    const confirmDelete = window.confirm(
      "Delete this message? This action cannot be undone.",
    );

    if (!confirmDelete) {
      return;
    }

    const result =
      message.messageType === "contact"
        ? await deleteContactMessage(message.id)
        : await deleteSupportMessage(message.id);

    if (!result.ok) {
      setFormError(result.message || "Unable to delete the message.");
      return;
    }

    removeMessage(message.id, message.messageType);
    if (activeMessageId === message.id) {
      setActiveMessageId("");
      setReplyDraft("");
    }
    setFormError("");
  };

  const handleSendReply = async () => {
    if (!activeMessage) {
      return;
    }

    const nextStatus = normalizeMessageStatus(activeMessage) === "resolved" ? "resolved" : "open";
    const result =
      activeMessage.messageType === "contact"
        ? await replyToContactMessage(activeMessage.id, replyDraft, nextStatus)
        : await replyToSupportMessage(activeMessage.id, replyDraft, nextStatus);

    if (!result.ok) {
      setFormError(result.message || "Please write a reply before sending.");
      return;
    }

    syncMessage(result.message);
    setReplyDraft(result.message.replyMessage ?? "");
    setFormError("");
  };

  const handleMarkResolved = async () => {
    if (!activeMessage) {
      return;
    }

    const result =
      activeMessage.messageType === "contact"
        ? await setContactMessageStatus(activeMessage.id, "resolved")
        : await setSupportMessageStatus(activeMessage.id, "resolved");

    if (!result.ok) {
      setFormError(result.message || "Unable to resolve this message.");
      return;
    }

    syncMessage(result.message);
    setReplyDraft(result.message.replyMessage ?? "");
    setFormError("");
  };

  return (
    <main className="admin-support-page">
      <section className="admin-support-shell">
        <header className="admin-support-header">
          <div>
            <p>Admin inbox</p>
            <h1>Contact & Support Inbox</h1>
            <span>
              Review user messages, reply to concerns, and track what has already been resolved.
            </span>
          </div>

          <div className="admin-support-header__actions">
            <Link
              to="/admin/dashboard"
              className="admin-support-header__button admin-support-header__button--ghost"
            >
              Back to dashboard
            </Link>
          </div>
        </header>

        <section className="admin-support-summary">
          <MetricCard
            title="Total Messages"
            value={metrics.totalMessages}
            note="Support requests and contact submissions."
          />
          <MetricCard
            title="New Messages"
            value={metrics.newMessages}
            note="Unread and waiting for the first action."
          />
          <MetricCard
            title="Open Messages"
            value={metrics.openMessages}
            note="Viewed by admin and currently being handled."
          />
          <MetricCard
            title="Resolved Messages"
            value={metrics.resolvedMessages}
            note="Issues closed and marked complete."
          />
        </section>

        <section className="admin-support-panel">
          <div className="admin-support-toolbar">
            <label className="admin-support-search" htmlFor="admin-support-search">
              <span>Search</span>
              <input
                id="admin-support-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search customer, title, email, or message"
              />
            </label>

            <label className="admin-support-filter" htmlFor="admin-support-status">
              <span>Status</span>
              <select
                id="admin-support-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">All Messages</option>
                <option value="new">New</option>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>

            <label className="admin-support-filter" htmlFor="admin-support-type">
              <span>Type</span>
              <select
                id="admin-support-type"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
              >
                <option value="all">All Types</option>
                <option value="support">Support</option>
                <option value="contact">Contact</option>
              </select>
            </label>
          </div>

          {formError ? <p className="admin-support-error">{formError}</p> : null}

          <div className="admin-support-table-wrap">
            <table className="admin-support-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Customer Name</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr className="admin-support-empty-row">
                    <td colSpan="6">
                      <div className="admin-support-empty">
                        <h2>Loading inbox messages...</h2>
                        <p>Please wait while we fetch support and contact messages.</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredMessages.length > 0 ? (
                  filteredMessages.map((message) => {
                    const nextStatusLabel =
                      normalizeMessageStatus(message) === "resolved" ? "Reopen" : "Resolve";

                    return (
                      <tr key={message.id} className="admin-support-row">
                        <td>
                          <span
                            className={`admin-support-pill admin-support-pill--${getMessageTypeTone(message.messageType)}`}
                          >
                            {getMessageTypeLabel(message.messageType)}
                          </span>
                        </td>
                        <td>
                          <strong>{message.customerName || "Guest user"}</strong>
                          <small>{message.customerEmail || "No email captured"}</small>
                        </td>
                        <td>
                          <strong>{message.title}</strong>
                          <small>{message.message}</small>
                        </td>
                        <td>
                          <SupportStatusPill messageType={message.messageType} status={message.status} />
                        </td>
                        <td>
                          <strong>{formatDateTime(message.createdAt)}</strong>
                          <small>{formatDaysAgo(message.createdAt)}</small>
                        </td>
                        <td>
                          <div className="admin-support-actions">
                            <button
                              type="button"
                              className="admin-support-action admin-support-action--ghost"
                              onClick={() => handleViewMessage(message)}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="admin-support-action admin-support-action--primary"
                              onClick={() => handleToggleStatus(message)}
                            >
                              {nextStatusLabel}
                            </button>
                            <button
                              type="button"
                              className="admin-support-action admin-support-action--danger"
                              onClick={() => handleDeleteMessage(message)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr className="admin-support-empty-row">
                    <td colSpan="6">
                      <div className="admin-support-empty">
                        <h2>No messages found.</h2>
                        <p>Try a different search term, message type, or status filter.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {activeMessage ? (
        <div
          className="admin-support-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Message details"
        >
          <button
            type="button"
            className="admin-support-modal__scrim"
            onClick={() => {
              setActiveMessageId("");
              setReplyDraft("");
            }}
            aria-label="Close support message"
          />

          <aside className="admin-support-modal__panel">
            <header className="admin-support-modal__header">
              <div>
                <p>{getMessageTypeLabel(activeMessage.messageType)} request</p>
                <h2>{activeMessage.title}</h2>
                <span>
                  {activeMessage.customerName || "Guest user"} · {formatDateTime(activeMessage.createdAt)}
                </span>
              </div>

              <div className="admin-support-modal__status">
                <SupportStatusPill
                  messageType={activeMessage.messageType}
                  status={activeMessage.status}
                />
                <button
                  type="button"
                  className="admin-support-modal__close"
                  onClick={() => {
                    setActiveMessageId("");
                    setReplyDraft("");
                  }}
                >
                  Close
                </button>
              </div>
            </header>

            <div className="admin-support-modal__body">
              <section className="admin-support-modal__summary">
                <div>
                  <span>Message Type</span>
                  <strong>{getMessageTypeLabel(activeMessage.messageType)}</strong>
                  <small>{activeMessage.messageType}</small>
                </div>
                <div>
                  <span>Customer</span>
                  <strong>{activeMessage.customerName || "Guest user"}</strong>
                  <small>{activeMessage.customerEmail || "No email captured"}</small>
                </div>
                <div>
                  <span>Sent</span>
                  <strong>{formatDateTime(activeMessage.createdAt)}</strong>
                  <small>{formatDaysAgo(activeMessage.createdAt)}</small>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{getMessageStatusLabel(activeMessage)}</strong>
                  <small>Updated {formatDateTime(activeMessage.updatedAt)}</small>
                </div>
              </section>

              <article className="admin-support-modal__message">
                <span>Message</span>
                <p>{activeMessage.message}</p>
              </article>

              <label className="admin-support-modal__reply" htmlFor="support-reply">
                <span>Reply</span>
                <textarea
                  id="support-reply"
                  rows="5"
                  value={replyDraft}
                  onChange={(event) => setReplyDraft(event.target.value)}
                  placeholder="Type your reply to the customer..."
                />
              </label>

              {activeMessage.replyMessage ? (
                <article className="admin-support-modal__reply-preview">
                  <span>Latest reply</span>
                  <p>{activeMessage.replyMessage}</p>
                  {activeMessage.repliedAt ? <small>Sent {formatDateTime(activeMessage.repliedAt)}</small> : null}
                </article>
              ) : null}
            </div>

            <footer className="admin-support-modal__actions">
              <button
                type="button"
                className="admin-support-modal__button admin-support-modal__button--ghost"
                onClick={() => {
                  setActiveMessageId("");
                  setReplyDraft("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-support-modal__button admin-support-modal__button--primary"
                onClick={handleSendReply}
              >
                Reply
              </button>
              <button
                type="button"
                className="admin-support-modal__button admin-support-modal__button--secondary"
                onClick={handleMarkResolved}
              >
                Mark Resolved
              </button>
              <button
                type="button"
                className="admin-support-modal__button admin-support-modal__button--danger"
                onClick={() => handleDeleteMessage(activeMessage)}
              >
                Delete
              </button>
            </footer>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

export default SupportInboxPage;
