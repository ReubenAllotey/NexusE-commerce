import { useState } from "react";

function UnavailableStockButton({ className = "", children, ...props }) {
  const [pointer, setPointer] = useState(null);

  const handlePointerMove = (event) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") {
      return;
    }

    setPointer({ x: event.clientX, y: event.clientY });
  };

  return (
    <>
      <button
        {...props}
        type="button"
        disabled
        className={`${className} stock-unavailable-control`}
        onPointerMove={handlePointerMove}
        onPointerEnter={handlePointerMove}
        onPointerLeave={() => setPointer(null)}
      >
        {children}
      </button>
      {pointer ? (
        <span
          className="stock-unavailable-pointer"
          aria-hidden="true"
          style={{ left: pointer.x, top: pointer.y }}
        />
      ) : null}
    </>
  );
}

export default UnavailableStockButton;
