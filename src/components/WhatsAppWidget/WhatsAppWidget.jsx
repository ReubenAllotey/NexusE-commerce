import { useEffect, useRef, useState } from "react";

const defaultMessage = "Hello Nexus Import Hub, I need assistance with an order or product.";

function getWhatsAppNumber() {
  const value = String(import.meta.env.VITE_WHATSAPP_NUMBER || "").trim();
  return /^\d{10,15}$/.test(value) ? value : "";
}

function getWhatsAppGroupUrl() {
  const value = String(import.meta.env.VITE_WHATSAPP_GROUP_URL || "").trim();

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "chat.whatsapp.com" ? url.toString() : "";
  } catch {
    return "";
  }
}

const whatsappNumber = getWhatsAppNumber();
const whatsappGroupUrl = getWhatsAppGroupUrl();

if (import.meta.env.DEV && !whatsappNumber) {
  console.warn("[Nexus WhatsApp] VITE_WHATSAPP_NUMBER is missing or invalid.");
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 3.3a12.6 12.6 0 0 0-10.8 19L3.7 28l5.9-1.5A12.6 12.6 0 1 0 16 3.3Z" />
      <path d="M11.4 10.2c.3-.3.7-.3 1-.1l1.5 1.8c.2.3.2.7 0 1l-.7.8c.8 1.5 2 2.7 3.5 3.5l.8-.7c.3-.2.7-.2 1 0l1.8 1.5c.3.3.3.7.1 1-.5.8-1.2 1.4-2 1.5-1.3.2-3.7-.8-5.7-2.8s-3-4.4-2.8-5.7c.1-.8.7-1.5 1.5-2Z" />
    </svg>
  );
}

function WhatsAppWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const widgetRef = useRef(null);
  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(defaultMessage)}`
    : "";

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (!widgetRef.current?.contains(event.target)) setIsOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <aside ref={widgetRef} className={`whatsapp-widget${isOpen ? " is-open" : ""}`} aria-label="WhatsApp support">
      {isOpen ? (
        <div className="whatsapp-widget__panel" role="dialog" aria-labelledby="whatsapp-widget-title">
          <button type="button" className="whatsapp-widget__close" aria-label="Close WhatsApp support" onClick={() => setIsOpen(false)}>
            X
          </button>
          <div className="whatsapp-widget__panel-icon"><WhatsAppIcon /></div>
          <p className="whatsapp-widget__eyebrow">WhatsApp</p>
          <h2 id="whatsapp-widget-title">How can we help?</h2>
          <div className="whatsapp-widget__options">
            {whatsappUrl ? (
              <a className="whatsapp-widget__option" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <span className="whatsapp-widget__option-icon"><WhatsAppIcon /></span>
                <span><strong>Chat with Nexus</strong><small>Questions, orders &amp; support</small></span>
                <span className="whatsapp-widget__option-arrow" aria-hidden="true">-&gt;</span>
              </a>
            ) : null}
            {whatsappGroupUrl ? (
              <a className="whatsapp-widget__option" href={whatsappGroupUrl} target="_blank" rel="noopener noreferrer">
                <span className="whatsapp-widget__option-icon"><WhatsAppIcon /></span>
                <span><strong>Join WhatsApp Group</strong><small>Updates, new arrivals &amp; batch news</small></span>
                <span className="whatsapp-widget__option-arrow" aria-hidden="true">-&gt;</span>
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      <button type="button" className="whatsapp-widget__trigger" aria-expanded={isOpen} aria-label={isOpen ? "Close WhatsApp support" : "Open WhatsApp support"} onClick={() => setIsOpen((open) => !open)}>
        <WhatsAppIcon />
        <span className="whatsapp-widget__pulse" aria-hidden="true" />
      </button>
    </aside>
  );
}

export default WhatsAppWidget;
