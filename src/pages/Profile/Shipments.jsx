import ProfileSectionShell from "./ProfileSectionShell";
import ShipmentTrack from "../../shared/ShipmentTrack";
import { useCustomerShipmentTracks } from "../../shared/shipmentStorage";

function formatDate(value) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not scheduled"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function getOptionLabel(options = []) {
  return options
    .map((option) => {
      const label = option?.label ?? option?.value ?? option?.option_label ?? option?.option_value ?? "";
      return String(label).trim();
    })
    .filter(Boolean)
    .join(" / ");
}

function ShipmentItem({ item }) {
  const variation = getOptionLabel(item.selectedOptions);
  return (
    <li className="orders-item">
      <div className="orders-item__media">
        {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span aria-hidden="true">N</span>}
      </div>
      <div className="orders-item__details">
        <strong>{item.productName}</strong>
        {item.brand ? <span>{item.brand}</span> : null}
        {variation ? <span>{variation}</span> : null}
        {item.selectedColor ? <span>Color: {item.selectedColor}</span> : null}
        {item.selectedSize ? <span>Size: {item.selectedSize}</span> : null}
      </div>
      <div className="orders-item__price"><span>Qty</span><strong>{item.quantity}</strong></div>
    </li>
  );
}

function ShipmentCard({ track }) {
  const orderNumbers = [...new Set(track.orders.map((order) => order.orderNumber).filter(Boolean))];
  return (
    <article className="shipment-card is-active">
      <div className="shipment-card__header">
        <div><p>{track.batchNumber}</p><strong>{track.shippingMethodLabel} Shipment Tracking</strong></div>
        <span>{track.currentStatusLabel}</span>
      </div>
      <div className="shipment-card__bar"><span style={{ width: `${track.progressPercent}%` }} /></div>
      <ShipmentTrack stepStates={track.stepStates} compact />
      <div className="shipment-card__meta">
        <div><span>Headline</span><strong>{track.headline || track.stepLabel}</strong></div>
        <div><span>Departure</span><strong>{formatDate(track.estimatedDeparture)}</strong></div>
        <div><span>Arrival</span><strong>{formatDate(track.estimatedArrival)}</strong></div>
        <div><span>Orders</span><strong>{orderNumbers.length || track.orderCount}</strong></div>
      </div>
      {track.announcement ? <div className="shipment-card__meta"><div style={{ gridColumn: "1 / -1" }}><span>Latest note</span><strong>{track.announcement}</strong></div></div> : null}
      <div className="shipment-card__details">
        <div className="orders-panel__header"><div><p className="orders-panel__eyebrow">Products in this shipment</p><h3>{track.items.length} item{track.items.length === 1 ? "" : "s"}</h3></div><span>{orderNumbers.join(", ") || "Paid order"}</span></div>
        {track.items.length > 0 ? <ul className="orders-items">{track.items.map((item) => <ShipmentItem key={item.id} item={item} />)}</ul> : <p>No matching item details are available yet.</p>}
      </div>
    </article>
  );
}

function Shipments() {
  const { tracks, loading, error } = useCustomerShipmentTracks();
  const activeTracks = tracks.filter((track) => track.currentStatus !== "delivered");
  const deliveredTracks = tracks.filter((track) => track.currentStatus === "delivered");
  const totalItems = tracks.reduce((sum, track) => sum + track.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);

  const stats = [
    { label: "Total Shipments", value: tracks.length, note: "Freight tracks linked to your paid orders." },
    { label: "In Transit", value: activeTracks.length, note: "Tracks currently moving." },
    { label: "Delivered", value: deliveredTracks.length, note: "Tracks completed successfully." },
    { label: "Items Tracked", value: totalItems, note: "Units matched to freight tracks." },
  ];

  return (
    <ProfileSectionShell eyebrow="Delivery" title="Shipments" description="Follow separate Air and Sea freight progress for your eligible orders.">
      <div className="shipments-stack">
        {error ? <div className="shipment-empty"><h3>Unable to load shipment progress</h3><p>{error}</p></div> : null}
        {loading ? <div className="shipment-empty"><h3>Loading shipment progress</h3><p>We are fetching live shipment tracks.</p></div> : null}
        <div className="shipment-stats" aria-label="Shipment summary">{stats.map((item) => <article className="shipment-stat" key={item.label}><strong>{item.value}</strong><span>{item.label}</span><small>{item.note}</small></article>)}</div>
        <section className="shipment-panel"><div className="shipment-panel__header"><div><p className="orders-panel__eyebrow">Freight tracking</p><h2>Shipment tracks</h2></div><span>{tracks.length} track{tracks.length === 1 ? "" : "s"}</span></div>
          {tracks.length > 0 ? <div className="shipment-cards">{tracks.map((track) => <ShipmentCard key={track.id} track={track} />)}</div> : <div className="shipment-empty"><h3>No shipment tracks yet</h3><p>Once a managed track matches one of your paid order items, it will appear here.</p></div>}
        </section>
      </div>
    </ProfileSectionShell>
  );
}

export default Shipments;
