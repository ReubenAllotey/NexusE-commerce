import { useEffect, useRef, useState } from "react";

const defaultMessage = "Hello Nexus Import Hub, I need assistance with an order or product.";
const POSITION_KEY = "nexus-whatsapp-widget-position";
const EDGE_PADDING = 16;
const DRAG_THRESHOLD = 7;

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

function readSavedPosition() {
  try {
    const value = JSON.parse(window.localStorage.getItem(POSITION_KEY) || "null");
    if ((value?.side !== "left" && value?.side !== "right") || !Number.isFinite(value?.yRatio)) return null;
    return { side: value.side, yRatio: Math.min(Math.max(value.yRatio, 0), 1) };
  } catch {
    return null;
  }
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
  const [position, setPosition] = useState(() => readSavedPosition() || { side: "right", yRatio: 1 });
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [dragPreview, setDragPreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const widgetRef = useRef(null);
  const triggerRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const whatsappNumber = getWhatsAppNumber();
  const whatsappGroupUrl = getWhatsAppGroupUrl();
  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(defaultMessage)}`
    : "";

  useEffect(() => {
    function handleResize() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setDragPreview(null);
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

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

  function getBounds() {
    const rect = triggerRef.current?.getBoundingClientRect();
    const width = rect?.width || 60;
    const height = rect?.height || 60;
    return {
      width,
      height,
      maxX: Math.max(EDGE_PADDING, viewport.width - width - EDGE_PADDING),
      maxY: Math.max(EDGE_PADDING, viewport.height - height - EDGE_PADDING),
    };
  }

  function clampPoint(x, y) {
    const { maxX, maxY } = getBounds();
    return {
      x: Math.min(Math.max(x, EDGE_PADDING), maxX),
      y: Math.min(Math.max(y, EDGE_PADDING), maxY),
    };
  }

  function savePosition(side, y) {
    const { maxY } = getBounds();
    const yRatio = maxY > 0 ? Math.min(Math.max(y / maxY, 0), 1) : 1;
    const next = { side, yRatio };
    setPosition(next);
    try {
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable in private browsing; the in-memory position still works.
    }
  }

  function handlePointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
    triggerRef.current.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const next = clampPoint(drag.startLeft + deltaX, drag.startTop + deltaY);
    setIsDragging(true);
    setDragPreview(next);
    event.preventDefault();
  }

  function handlePointerUp(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    const point = dragPreview || { x: rect?.left || drag.startLeft, y: rect?.top || drag.startTop };

    if (drag.moved) {
      const side = point.x + (rect?.width || 60) / 2 < viewport.width / 2 ? "left" : "right";
      const clamped = clampPoint(point.x, point.y);
      savePosition(side, clamped.y);
      suppressClickRef.current = true;
    }

    dragRef.current = null;
    setDragPreview(null);
    setIsDragging(false);
    triggerRef.current?.releasePointerCapture?.(event.pointerId);
  }

  function handleTriggerClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setIsOpen((open) => !open);
  }

  const bounds = getBounds();
  const savedTop = Math.min(Math.max(position.yRatio * bounds.maxY, EDGE_PADDING), bounds.maxY);
  const left = dragPreview?.x ?? (position.side === "left" ? EDGE_PADDING : viewport.width - bounds.width - EDGE_PADDING);
  const top = dragPreview?.y ?? savedTop;
  const menuBelow = top < 240;
  const className = [
    "whatsapp-widget",
    `whatsapp-widget--${position.side}`,
    menuBelow ? "whatsapp-widget--menu-below" : "",
    isOpen ? "is-open" : "",
    isDragging ? "is-dragging" : "",
  ].filter(Boolean).join(" ");

  return (
    <aside ref={widgetRef} className={className} style={{ left, top }} aria-label="WhatsApp support">
      {isOpen ? (
        <div className="whatsapp-widget__panel" role="dialog" aria-labelledby="whatsapp-widget-title">
          <button type="button" className="whatsapp-widget__close" aria-label="Close WhatsApp support" onClick={() => setIsOpen(false)}>X</button>
          <div className="whatsapp-widget__panel-icon"><WhatsAppIcon /></div>
          <p className="whatsapp-widget__eyebrow">WhatsApp</p>
          <h2 id="whatsapp-widget-title">How can we help?</h2>
          <div className="whatsapp-widget__options">
            {whatsappUrl ? <a className="whatsapp-widget__option" href={whatsappUrl} target="_blank" rel="noopener noreferrer"><span className="whatsapp-widget__option-icon"><WhatsAppIcon /></span><span><strong>Chat with Nexus</strong><small>Questions, orders &amp; support</small></span><span className="whatsapp-widget__option-arrow" aria-hidden="true">-&gt;</span></a> : null}
            {whatsappGroupUrl ? <a className="whatsapp-widget__option" href={whatsappGroupUrl} target="_blank" rel="noopener noreferrer"><span className="whatsapp-widget__option-icon"><WhatsAppIcon /></span><span><strong>Join WhatsApp Group</strong><small>Updates, new arrivals &amp; batch news</small></span><span className="whatsapp-widget__option-arrow" aria-hidden="true">-&gt;</span></a> : null}
          </div>
        </div>
      ) : null}
      <button ref={triggerRef} type="button" className="whatsapp-widget__trigger" aria-expanded={isOpen} aria-label={isOpen ? "Close WhatsApp support" : "Open WhatsApp support"} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onClick={handleTriggerClick}>
        <WhatsAppIcon />
        <span className="whatsapp-widget__pulse" aria-hidden="true" />
      </button>
    </aside>
  );
}

export default WhatsAppWidget;
