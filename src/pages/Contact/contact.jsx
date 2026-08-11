import { useState } from "react";
import { Link } from "react-router-dom";
import { recordContactMessage } from "./contactStorage";

const contactInfo = [
  {
    label: "Phone",
    value: "+233 XXX XXX XXX",
    href: "tel:+233XXXXXXXXX",
  },
  {
    label: "Email",
    value: "info@nexuscompany.com",
    href: "mailto:info@nexuscompany.com",
  },
  {
    label: "Office Address",
    value: "Accra, Ghana",
    href: null,
  },
];

const businessHours = [
  "Monday - Friday: 8:00 AM - 6:00 PM",
  "Saturday: 9:00 AM - 3:00 PM",
  "Sunday: Closed",
];

const faqs = [
  {
    question: "What services does Nexus Company provide?",
    answer:
      "Nexus Company specializes in importing goods from China and delivering them directly to customers in Ghana. We offer both air freight and sea freight shipping options.",
  },
  {
    question: "How does the shipping process work?",
    answer:
      "Simply send us the details of the items you wish to purchase or ship. We arrange procurement, consolidation, shipping, customs clearance, and final delivery to your location.",
  },
  {
    question: "What is batch shipping?",
    answer:
      "Batch shipping means goods from multiple customers are grouped into scheduled shipments. This helps reduce shipping costs and improve logistics efficiency.",
  },
  {
    question: "What is the difference between air freight and sea freight?",
    answer:
      "Air freight is faster and suitable for urgent shipments. Sea freight is more affordable and ideal for large or heavy cargo.",
  },
  {
    question: "How long does shipping take?",
    answer:
      "Air freight usually takes about 5-14 business days, while sea freight usually takes about 30-60 days. Delivery times may vary due to customs and logistics factors.",
  },
  {
    question: "Do you deliver directly to customers?",
    answer:
      "Yes. We provide doorstep delivery services, ensuring your goods reach your home, office, or business location safely.",
  },
  {
    question: "Can I track my shipment?",
    answer:
      "Yes. Customers receive shipment updates throughout the shipping process, and our support team can provide the latest status on request.",
  },
  {
    question: "Are there any restricted items that cannot be shipped?",
    answer:
      "Yes. Certain products may be restricted by customs regulations or shipping carriers. Contact our team before purchasing any specialized or regulated products.",
  },
  {
    question: "How are shipping charges calculated?",
    answer:
      "Shipping costs are typically based on weight, volume, shipping method, and destination. Contact us for a personalized quote.",
  },
  {
    question: "How can I contact customer support?",
    answer:
      "You can reach us by phone, email, WhatsApp, or through the contact form on this page. Our support team is ready to assist you.",
  },
];

function Contact() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!formData.fullName.trim() || !formData.email.trim() || !formData.subject.trim() || !formData.message.trim()) {
      setStatusMessage("Please complete your name, email, subject, and message.");
      return;
    }

    setIsSubmitting(true);
    setStatusMessage("");

    const result = await recordContactMessage({
      fullName: formData.fullName,
      email: formData.email,
      phoneNumber: formData.phone,
      subject: formData.subject,
      message: formData.message,
    });

    if (!result.ok) {
      setStatusMessage(result.message || "Unable to send your message.");
      setIsSubmitting(false);
      return;
    }

    setStatusMessage("Thanks, your message has been sent.");
    setFormData({
      fullName: "",
      email: "",
      phone: "",
      subject: "",
      message: "",
    });
    setIsSubmitting(false);
  }

  return (
    <main className="contact-page">
      <section className="contact-hero">
        <div className="site-shell contact-hero__grid">
          <div className="contact-hero__copy">
            <p className="contact-hero__eyebrow">Contact Us</p>
            <h1>Get In Touch With Nexus Company</h1>
            <p className="contact-hero__lead">
              Have questions about importing goods from China? Need a shipping
              quote, delivery update, or assistance with your order? Our team
              is here to help.
            </p>
            <p className="contact-hero__text">
              Whether you are importing products for personal use or business
              purposes, we are committed to providing reliable support
              throughout your shipping journey.
            </p>
          </div>

          <aside className="contact-hero__panel" aria-label="Contact information">
            <div>
              <p className="contact-panel__label">Contact Information</p>
              <div className="contact-info">
                {contactInfo.map((item) => (
                  <div className="contact-info__item" key={item.label}>
                    <strong>{item.label}</strong>
                    {item.href ? (
                      <a href={item.href}>{item.value}</a>
                    ) : (
                      <span>{item.value}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="contact-panel__label">Business Hours</p>
              <ul className="contact-hours">
                {businessHours.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </section>

      <section className="site-shell contact-section">
        <div className="section-header contact-section__header">
          <div>
            <p className="section-label">
              <span />
              Send Us a Message
            </p>
            <h2>Fill out the form below and our team will respond as soon as possible.</h2>
          </div>
        </div>

        <div className="contact-layout">
          <form className="contact-form" onSubmit={handleSubmit}>
            <div className="contact-form__grid">
              <label>
                <span>Full Name</span>
                <input
                  type="text"
                  name="fullName"
                  placeholder="Your full name"
                  value={formData.fullName}
                  onChange={handleChange}
                />
              </label>

              <label>
                <span>Email Address</span>
                <input
                  type="email"
                  name="email"
                  placeholder="you@example.com"
                  value={formData.email}
                  onChange={handleChange}
                />
              </label>

              <label>
                <span>Phone Number</span>
                <input
                  type="tel"
                  name="phone"
                  placeholder="+233 XXX XXX XXX"
                  value={formData.phone}
                  onChange={handleChange}
                />
              </label>

              <label>
                <span>Subject</span>
                <input
                  type="text"
                  name="subject"
                  placeholder="How can we help?"
                  value={formData.subject}
                  onChange={handleChange}
                />
              </label>
            </div>

            <label className="contact-form__message">
              <span>Message</span>
              <textarea
                name="message"
                rows="6"
                placeholder="Tell us about your shipment or question."
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

          <aside className="contact-support">
            <p className="contact-panel__label">Need a quick quote?</p>
            <h3>We can help with shipping updates, quotes, and order support.</h3>
            <p>
              Reach out with your item details, shipping preference, and
              destination, and we will guide you through the next steps.
            </p>
            <Link to="/products" className="contact-support__link">
              Browse Products
            </Link>
          </aside>
        </div>
      </section>

      <section className="site-shell contact-section">
        <div className="section-header contact-section__header">
          <div>
            <p className="section-label">
              <span />
              Frequently Asked Questions
            </p>
            <h2>Common questions about shipping, delivery, and support.</h2>
          </div>
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

      <section className="site-shell contact-cta">
        <div>
          <p className="section-label">
            <span />
            Ready to Ship With Nexus?
          </p>
          <h2>Let Nexus Company handle your imports from China while you focus on growing your business.</h2>
          <p>Contact us today for a shipping quote or consultation.</p>
        </div>

        <div className="contact-cta__actions">
          <a href="mailto:info@nexuscompany.com" className="contact-cta__button">
            Email Us
          </a>
          <a href="tel:+233XXXXXXXXX" className="contact-cta__button contact-cta__button--secondary">
            Call Now
          </a>
        </div>
      </section>
    </main>
  );
}

export default Contact;
