function ShipmentTrack({ stepStates = [], compact = false, className = "" }) {
  return (
    <div
      className={`admin-shipment-track${compact ? " admin-shipment-track--compact" : ""}${className ? ` ${className}` : ""}`}
      aria-label="Shipment progress track"
    >
      {stepStates.map((step, index) => (
        <div
          key={step.key}
          className={`admin-shipment-track__step admin-shipment-track__step--${step.state}`}
        >
          <span className="admin-shipment-track__node">{index + 1}</span>
          <strong>{step.label}</strong>
        </div>
      ))}
    </div>
  );
}

export default ShipmentTrack;
