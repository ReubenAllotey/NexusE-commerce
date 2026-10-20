function ShipmentTrack({ stepStates = [], compact = false, className = "", interactive = false, onStepSelect = () => {}, saving = false }) {
  return (
    <div
      className={`admin-shipment-track${compact ? " admin-shipment-track--compact" : ""}${className ? ` ${className}` : ""}`}
      aria-label="Shipment progress track"
    >
      {stepStates.map((step, index) => (
        interactive ? (
          <button
            type="button"
            key={step.key}
            className={`admin-shipment-track__step admin-shipment-track__step--${step.state}`}
            onClick={() => onStepSelect(step, index)}
            disabled={saving}
            aria-label={`Set shipment stage to ${step.label}`}
          >
            <span className="admin-shipment-track__node">{index + 1}</span>
            <strong>{step.label}</strong>
          </button>
        ) : (
          <div
            key={step.key}
            className={`admin-shipment-track__step admin-shipment-track__step--${step.state}`}
          >
            <span className="admin-shipment-track__node">{index + 1}</span>
            <strong>{step.label}</strong>
          </div>
        )
      ))}
    </div>
  );
}

export default ShipmentTrack;
