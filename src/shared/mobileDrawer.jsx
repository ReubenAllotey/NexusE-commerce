import { useEffect } from "react";

function MobileDrawer({
  open = false,
  title = "",
  onClose = () => {},
  className = "",
  children,
  footer = null,
  maxWidth = "min(82vw, 320px)",
}) {
  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const handleResize = () => {
      if (window.innerWidth > 768) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [open, onClose]);

  return (
    <div className={`mobile-drawer${open ? " is-open" : ""} ${className}`.trim()} aria-hidden={!open}>
      <button
        type="button"
        className="mobile-drawer__scrim"
        aria-label={`Close ${title || "navigation"}`}
        onClick={onClose}
      />

      <aside
        className="mobile-drawer__panel"
        style={{ "--mobile-drawer-width": maxWidth }}
        aria-label={title || "Navigation"}
      >
        <header className="mobile-drawer__header">
          <div>
            <p>{title}</p>
          </div>

          <button
            type="button"
            className="mobile-drawer__close"
            aria-label={`Close ${title || "navigation"}`}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="mobile-drawer__body">{children}</div>

        {footer ? <footer className="mobile-drawer__footer">{footer}</footer> : null}
      </aside>
    </div>
  );
}

export default MobileDrawer;
