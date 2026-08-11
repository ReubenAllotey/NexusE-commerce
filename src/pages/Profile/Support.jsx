import { useEffect, useMemo, useState } from "react";
import ProfileSectionShell from "./ProfileSectionShell";
import {
  getRecentSupportMessages,
  getSupportStatusLabel,
  getSupportStatusTone,
  loadStoredSupportMessages,
  recordSupportMessage,
} from "./supportInboxStorage";

const faqs = [
  {
    question: "How long does shipping take?",
    answer:
      "Shipping times depend on the delivery method and destination. Air freight is faster, while sea freight is more affordable for larger shipments.",
  },
  {
    question: "Can I track my shipment?",
    answer:
      "Yes. You can track shipment updates from your account and our team can also help if you need a status update.",
  },
  {
    question: "How can I contact customer support?",
    answer:
      "Send us a message through the support form and include your title and details. We will review it and get back to you as soon as possible.",
  },
];

function Support({ authUser = null }) {
  const [formData, setFormData] = useState({
    title: "",
    message: "",
  });
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const recentMessages = useMemo(() => getRecentSupportMessages(messages, 12), [messages]);

  useEffect(() => {
    let isActive = true;

    async function loadMessages() {
      if (!authUser?.id) {
        if (isActive) {
          setMessages([]);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);

      try {
        const nextMessages = await loadStoredSupportMessages({
          userId: authUser.id,
          profileFallback: authUser,
        });

        if (isActive) {
          setMessages(nextMessages);
        }
      } catch (error) {
        if (isActive) {
          setStatusMessage(
            error instanceof Error ? error.message : "Unable to load your support messages.",
          );
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
  }, [authUser?.id, authUser]);

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!formData.title.trim() || !formData.message.trim()) {
      setStatusMessage("Please add both a title and a message.");
      return;
    }

    setIsSubmitting(true);
    setStatusMessage("");

    const result = await recordSupportMessage({
      title: formData.title,
      message: formData.message,
    });

    if (!result.ok) {
      setStatusMessage(result.message || "Unable to send your support message.");
      setIsSubmitting(false);
      return;
    }

    setStatusMessage("Thanks, your message has been sent to support.");
    setFormData({
      title: "",
      message: "",
    });
    setMessages((current) => [result.message, ...current]);
    setIsSubmitting(false);
  }

  return (
    <ProfileSectionShell
      eyebrow="Help"
      title="Support Center"
      description="Need help? We're here to assist you with your orders, shipments, payments, and account."
    >
      <div className="support-stack">
        <section>
          <div className="support-message__intro">
            <p className="section-label">
              <span />
              Send a Message
            </p>
            <h2>Tell us what you need help with.</h2>
            <p className="support-message__copy">
              Share a short title and a message so our support team can respond quickly.
            </p>
          </div>

          <form className="contact-form support-message__form" onSubmit={handleSubmit}>
            <label>
              <span>Title</span>
              <input
                type="text"
                name="title"
                placeholder="Order issue, payment question, account help..."
                value={formData.title}
                onChange={handleChange}
              />
            </label>

            <label className="contact-form__message">
              <span>Message</span>
              <textarea
                name="message"
                rows="6"
                placeholder="Type your message here."
                value={formData.message}
                onChange={handleChange}
              />
            </label>

            {statusMessage ? (
              <p className="support-message__status" aria-live="polite">
                {statusMessage}
              </p>
            ) : null}

            <button type="submit" className="contact-form__button" disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : "Send Message"}
            </button>
          </form>
        </section>

        <section>
          <div className="support-message__intro">
            <p className="section-label">
              <span />
              Your Messages
            </p>
            <h2>Track the support requests you have sent.</h2>
            <p className="support-message__copy">
              See the latest responses from our team and follow the status of each request.
            </p>
          </div>

          {isLoading ? (
            <div className="dashboard-empty">
              <p>Loading your support messages...</p>
              <span>Please wait while we fetch your latest requests.</span>
            </div>
          ) : recentMessages.length > 0 ? (
            <div className="contact-faq">
              {recentMessages.map((message, index) => (
                <details className="contact-faq__item" key={message.id} open={index === 0}>
                  <summary>
                    {message.title}
                    <span className={`admin-support-pill admin-support-pill--${getSupportStatusTone(message.status)}`}>
                      {getSupportStatusLabel(message.status)}
                    </span>
                  </summary>
                  <p>{message.message}</p>
                  {message.replyMessage ? (
                    <div className="support-message__reply">
                      <strong>Admin reply</strong>
                      <p>{message.replyMessage}</p>
                    </div>
                  ) : null}
                </details>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty">
              <p>No support messages yet.</p>
              <span>Send your first message using the form above.</span>
            </div>
          )}
        </section>

        <section>
          <div className="support-message__intro">
            <p className="section-label">
              <span />
              Frequently Asked Questions
            </p>
            <h2>Quick answers before you reach out.</h2>
          </div>

          <div className="contact-faq">
            {faqs.map((faq, index) => (
              <details className="contact-faq__item" key={faq.question} open={index < 2}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </ProfileSectionShell>
  );
}

export default Support;
