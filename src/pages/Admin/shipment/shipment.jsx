import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import { formatShortDate } from "../adminHelpers";
import {
  buildProductBundlePayloadFromLegacyProduct,
  saveProductBundle,
  useProducts,
} from "../../Products/productData";
import { loadAdminBatches } from "../../../shared/batchStorage";
import ShipmentTrack from "../../../shared/ShipmentTrack";
import {
  getShipmentStepsForFreight,
  archiveShipmentTrack,
  loadAdminShipmentTracks,
  saveShipmentTrack,
  saveShipmentTrackStages,
} from "../../../shared/shipmentStorage";

const EMPTY_TRACK = {
  id: "",
  batchId: "",
  freightType: "air",
  headline: "",
  announcement: "",
  currentStep: 0,
  currentStatus: "preparing",
  estimatedDeparture: "",
  estimatedArrival: "",
};

const EMPTY_FEE = { productName: "", shippingFee: "" };

function clean(value) {
  return String(value ?? "").trim();
}

function getStageOptions(freightType) {
  return [
    ...getShipmentStepsForFreight(freightType).map((step, index) => ({
      value: `${index}:${step.status}`,
      label: step.label,
      step: index,
      status: step.status,
    })),
    { value: "4:delivered", label: "Delivered", step: 4, status: "delivered" },
  ];
}

function SummaryCard({ title, value, note }) {
  return (
    <article className="admin-products-metric admin-shipment-metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function TrackRow({ track, onEdit, onView, onManage, onDelete }) {
  return (
    <article className="admin-shipment-card">
      <div className="admin-shipment-card__header">
        <div>
          <p>{track.batchNumber || "Managed batch"}</p>
          <h3>{track.headline || track.stepLabel}</h3>
          <span>{track.announcement || "Tracking updates are synced to eligible customer orders."}</span>
        </div>
        <span className="admin-shipment-pill">{track.shippingMethodLabel}</span>
      </div>
      <ShipmentTrack stepStates={track.stepStates} />
      <div className="admin-shipment-card__progress" aria-label={`${track.progressPercent}% complete`}>
        <span style={{ width: `${track.progressPercent}%` }} />
      </div>
      <div className="admin-shipment-card__meta">
        <div><span>Stage</span><strong>{track.currentStatusLabel}</strong></div>
        <div><span>Progress</span><strong>{track.completedStageCount}/{track.totalStageCount} stages</strong></div>
        <div><span>Departure</span><strong>{formatShortDate(track.estimatedDeparture)}</strong></div>
        <div><span>Arrival</span><strong>{formatShortDate(track.estimatedArrival)}</strong></div>
        <div><span>Updated</span><strong>{formatShortDate(track.updatedAt)}</strong></div>
      </div>
      <div className="admin-shipment-card__actions">
        <button type="button" className="admin-products-action admin-products-action--edit" onClick={onView}>View</button>
        <button type="button" className="admin-products-action admin-products-action--edit" onClick={onEdit}>Edit</button>
        <button type="button" className="admin-products-action admin-products-action--edit" onClick={onManage}>Manage Stages</button>
        <button type="button" className="admin-products-action admin-products-action--delete" onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}

function ShipmentPage({ authUser = null }) {
  const session = authUser ?? loadAdminSession();
  const [batches, setBatches] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [stageTrack, setStageTrack] = useState(null);
  const [stageDraft, setStageDraft] = useState([]);
  const [trackDraft, setTrackDraft] = useState(EMPTY_TRACK);
  const [trackModalOpen, setTrackModalOpen] = useState(false);
  const [feeModalOpen, setFeeModalOpen] = useState(false);
  const [feeDraft, setFeeDraft] = useState(EMPTY_FEE);
  const [loading, setLoading] = useState(true);
  const [trackLoadError, setTrackLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingFee, setSavingFee] = useState(false);
  const [savingStages, setSavingStages] = useState(false);
  const { products, loading: productsLoading, refresh: refreshProducts } = useProducts();

  const pendingFeeProducts = useMemo(
    () => products.filter((product) => product.shippingFeeStatus === "pending" || product.shippingFee == null),
    [products],
  );

  const refresh = async () => {
    setLoading(true);
    setError("");
    const [batchResult, trackResult] = await Promise.all([
      loadAdminBatches().catch((loadError) => ({ error: loadError })),
      loadAdminShipmentTracks(),
    ]);

    if (batchResult?.error) setError(batchResult.error.message || "Unable to load managed batches.");
    else setBatches(batchResult ?? []);
    if (!trackResult.ok) {
      setTrackLoadError(trackResult.message || "Unable to load shipment tracks.");
      setTracks([]);
    } else {
      setTrackLoadError("");
      setTracks(trackResult.tracks);
    }
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  if (!session) return <Navigate to="/admin/login" replace />;

  const closeDialogs = () => {
    setTrackModalOpen(false);
    setFeeModalOpen(false);
    setSelectedTrack(null);
    setStageTrack(null);
    setStageDraft([]);
    setError("");
  };

  const openNew = () => {
    const openBatch = batches.find((batch) => batch.status === "open") ?? batches[0];
    setTrackDraft({ ...EMPTY_TRACK, batchId: openBatch?.id ?? "" });
    setSelectedTrack(null);
    setTrackModalOpen(true);
    setFeeModalOpen(false);
    setError("");
  };

  const openEdit = (track) => {
    setTrackDraft({
      id: track.id,
      batchId: track.batchId,
      freightType: track.freightType,
      headline: track.headline,
      announcement: track.announcement,
      currentStep: track.currentStep,
      currentStatus: track.currentStatus,
      estimatedDeparture: track.estimatedDeparture ?? "",
      estimatedArrival: track.estimatedArrival ?? "",
    });
    setSelectedTrack(null);
    setTrackModalOpen(true);
    setFeeModalOpen(false);
    setError("");
  };

  const openManageStages = (track) => {
    setStageTrack(track);
    setStageDraft((track.stages ?? []).map((stage, index) => ({
      ...stage,
      position: index,
      completedAt: stage.completedAt ? String(stage.completedAt).slice(0, 10) : "",
    })));
    setSelectedTrack(null);
    setTrackModalOpen(false);
    setFeeModalOpen(false);
    setError("");
  };

  const updateStage = (stageId, field, value) => {
    setStageDraft((current) => current.map((stage) => (stage.id || stage.key) === stageId ? { ...stage, [field]: value } : stage));
  };

  const moveStage = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= stageDraft.length) return;
    setStageDraft((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next.map((stage, position) => ({ ...stage, position }));
    });
  };

  const addStage = () => {
    setStageDraft((current) => ([...current, {
      id: "",
      key: `stage-${Date.now()}`,
      label: "New stage",
      description: "",
      position: current.length,
      isCompleted: false,
      completedAt: "",
    }]));
  };

  const removeStage = (stage, index) => {
    if (!window.confirm(`Remove stage "${stage.label || `Stage ${index + 1}`}"? Existing shipment history will be preserved.`)) return;
    setStageDraft((current) => current.filter((_, itemIndex) => itemIndex !== index).map((item, position) => ({ ...item, position })));
  };

  const handleSaveStages = async (event) => {
    event.preventDefault();
    if (!stageTrack || stageDraft.length === 0) {
      setError("Add at least one shipment stage before saving.");
      return;
    }
    if (stageDraft.some((stage) => !clean(stage.label))) {
      setError("Every shipment stage needs a name.");
      return;
    }
    setSavingStages(true);
    setError("");
    const result = await saveShipmentTrackStages(stageTrack.id, stageDraft.map((stage, position) => ({
      id: stage.id || null,
      stage_key: stage.key || `stage-${position + 1}`,
      stage_name: clean(stage.label),
      description: clean(stage.description),
      position,
      is_completed: Boolean(stage.isCompleted),
      completed_at: stage.isCompleted ? stage.completedAt || null : null,
    })));
    if (!result.ok) setError(result.message);
    else {
      await refresh();
      setStageTrack(null);
      setStageDraft([]);
    }
    setSavingStages(false);
  };

  const handleDeleteTrack = async (track) => {
    const reference = track.batchNumber || track.id;
    const linkedOrders = track.orderCount > 0 ? ` ${track.orderCount} linked order${track.orderCount === 1 ? " is" : "s are"} present; orders and history will not be deleted.` : "";
    if (!window.confirm(`Archive shipment track ${reference} (${track.shippingMethodLabel})?${linkedOrders}`)) return;
    setError("");
    const result = await archiveShipmentTrack(track.id);
    if (!result.ok) setError(result.message);
    else await refresh();
  };

  const handleTrackChange = (field, value) => {
    setTrackDraft((current) => ({ ...current, [field]: value }));
  };

  const handleSaveTrack = async (event) => {
    event.preventDefault();
    if (!trackDraft.batchId) {
      setError("Select a managed batch before saving.");
      return;
    }
    setSaving(true);
    setError("");
    const result = await saveShipmentTrack(trackDraft);
    if (!result.ok) {
      setError(result.message);
      setSaving(false);
      return;
    }
    await refresh();
    setTrackModalOpen(false);
    setTrackDraft(EMPTY_TRACK);
    setSaving(false);
  };

  const handleSaveFee = async (event) => {
    event.preventDefault();
    const amount = Number(feeDraft.shippingFee);
    const name = clean(feeDraft.productName).toLowerCase();
    if (!name || !Number.isFinite(amount) || amount < 0) {
      setError("Enter a product and a valid shipping fee.");
      return;
    }
    const product = products.find((item) => [item.slug, item.name].some((value) => clean(value).toLowerCase().includes(name)));
    if (!product) {
      setError("We could not find that product in the catalog.");
      return;
    }
    setSavingFee(true);
    const result = await saveProductBundle(buildProductBundlePayloadFromLegacyProduct({
      ...product,
      shippingFee: amount,
      shippingFeeStatus: "ready",
    }));
    if (!result.ok) setError(result.message || "Unable to update the shipping fee.");
    else {
      await refreshProducts();
      setFeeModalOpen(false);
      setFeeDraft(EMPTY_FEE);
    }
    setSavingFee(false);
  };

  const activeTracks = tracks.filter((track) => track.currentStatus !== "delivered");
  const airTracks = tracks.filter((track) => track.freightType === "air");
  const seaTracks = tracks.filter((track) => track.freightType === "sea");
  const completedTracks = tracks.filter((track) => track.currentStatus === "delivered");
  const stageValue = `${trackDraft.currentStep}:${trackDraft.currentStatus}`;

  return (
    <main className="admin-products-page admin-shipment-page">
      <section className="admin-products-shell admin-shipment-shell">
        <header className="admin-products-header admin-shipment-header">
          <div><p>Admin operations</p><h1>Shipment Management</h1><span>Create and update freight tracking for managed batches.</span></div>
          <div className="admin-products-header__actions">
            <button type="button" className="admin-products-header__button" onClick={openNew}>New Shipment Track</button>
            <button type="button" className="admin-products-header__button admin-products-header__button--ghost" onClick={() => { setFeeModalOpen(true); setTrackModalOpen(false); setError(""); }} disabled={pendingFeeProducts.length === 0 || productsLoading}>Update Shipping Fee</button>
          </div>
        </header>

        {error ? <p className="admin-shipment-modal__error">{error}</p> : null}

        <section className="admin-products-summary">
          <SummaryCard title="Active Tracks" value={activeTracks.length} note="Tracks currently moving through fulfillment." />
          <SummaryCard title="Air Freight" value={airTracks.length} note="Managed Air freight tracks." />
          <SummaryCard title="Sea Freight" value={seaTracks.length} note="Managed Sea freight tracks." />
          <SummaryCard title="Completed" value={completedTracks.length} note="Tracks marked delivered." />
        </section>

        <section className="admin-products-panel admin-shipment-panel">
          <div className="admin-shipment-panel__heading"><div><p>Managed tracking</p><h2>Existing tracks</h2></div><span>{loading ? "Loading..." : `${tracks.length} track${tracks.length === 1 ? "" : "s"}`}</span></div>
          {loading ? <div className="admin-products-empty"><h2>Loading shipment tracks...</h2><p>We are checking the managed shipment records.</p></div> : trackLoadError ? <div className="admin-products-empty admin-shipment-empty--error"><h2>Unable to load shipment tracks.</h2><p>{trackLoadError}</p><p>Apply the shipment tracking migration in Supabase, then try again.</p></div> : tracks.length > 0 ? <div className="admin-shipment-cards">{tracks.map((track) => <TrackRow key={track.id} track={track} onView={() => setSelectedTrack(track)} onEdit={() => openEdit(track)} onManage={() => openManageStages(track)} onDelete={() => handleDeleteTrack(track)} />)}</div> : <div className="admin-products-empty"><h2>No shipment tracks yet.</h2><p>Create an Air or Sea track for any managed batch, even before orders exist.</p></div>}
        </section>
      </section>

      {trackModalOpen ? (
        <div className="admin-shipment-modal" role="dialog" aria-modal="true" aria-label="Shipment track editor">
          <button type="button" className="admin-shipment-modal__scrim" onClick={closeDialogs} aria-label="Close shipment editor" />
          <aside className="admin-shipment-modal__panel">
            <header className="admin-shipment-modal__header"><div><p>Shipment tracking</p><h2>{trackDraft.id ? "Update shipment track" : "New shipment track"}</h2><span>Tracks can be created before customer orders exist.</span></div><button type="button" className="admin-shipment-modal__close" onClick={closeDialogs}>Close</button></header>
            <form className="admin-shipment-modal__form" onSubmit={handleSaveTrack}>
              <div className="admin-shipment-modal__grid">
                <label className="admin-shipment-modal__field"><span>Managed Batch</span><select value={trackDraft.batchId} onChange={(event) => handleTrackChange("batchId", event.target.value)} required><option value="">Select batch</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batchNumber}{batch.title ? ` - ${batch.title}` : ""}</option>)}</select></label>
                <label className="admin-shipment-modal__field"><span>Freight Type</span><select value={trackDraft.freightType} onChange={(event) => { const freightType = event.target.value; handleTrackChange("freightType", freightType); handleTrackChange("currentStep", 0); handleTrackChange("currentStatus", "preparing"); }}><option value="air">Air Freight</option><option value="sea">Sea Freight</option><option value="both">Both</option></select></label>
              </div>
              <div className="admin-shipment-modal__grid">
                <label className="admin-shipment-modal__field"><span>Headline</span><input value={trackDraft.headline} onChange={(event) => handleTrackChange("headline", event.target.value)} placeholder="Shipment headline" /></label>
                <label className="admin-shipment-modal__field"><span>Current Stage</span><select value={stageValue} onChange={(event) => { const [step, status] = event.target.value.split(":"); handleTrackChange("currentStep", Number(step)); handleTrackChange("currentStatus", status); }}>{getStageOptions(trackDraft.freightType).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              </div>
              <div className="admin-shipment-modal__grid">
                <label className="admin-shipment-modal__field"><span>Estimated Departure</span><input type="date" value={String(trackDraft.estimatedDeparture ?? "").slice(0, 10)} onChange={(event) => handleTrackChange("estimatedDeparture", event.target.value)} /></label>
                <label className="admin-shipment-modal__field"><span>Estimated Arrival</span><input type="date" value={String(trackDraft.estimatedArrival ?? "").slice(0, 10)} onChange={(event) => handleTrackChange("estimatedArrival", event.target.value)} /></label>
              </div>
              <label className="admin-shipment-modal__field"><span>Announcement / Note</span><textarea value={trackDraft.announcement} onChange={(event) => handleTrackChange("announcement", event.target.value)} placeholder="Add a short customer-facing shipment note." /></label>
              <div className="admin-shipment-modal__actions"><button type="button" className="admin-shipment-modal__button admin-shipment-modal__button--ghost" onClick={closeDialogs}>Cancel</button><button type="submit" className="admin-shipment-modal__button admin-shipment-modal__button--primary" disabled={saving}>{saving ? "Saving..." : "Save Tracking"}</button></div>
            </form>
          </aside>
        </div>
      ) : null}

      {stageTrack ? (
        <div className="admin-shipment-modal" role="dialog" aria-modal="true" aria-label="Manage shipment stages">
          <button type="button" className="admin-shipment-modal__scrim" onClick={closeDialogs} aria-label="Close stage manager" />
          <aside className="admin-shipment-modal__panel admin-shipment-stages-modal__panel">
            <header className="admin-shipment-modal__header"><div><p>{stageTrack.shippingMethodLabel}</p><h2>Manage Stages</h2><span>{stageTrack.batchNumber || "Shipment track"} · {stageDraft.length} stage{stageDraft.length === 1 ? "" : "s"}</span></div><button type="button" className="admin-shipment-modal__close" onClick={closeDialogs}>Close</button></header>
            <form className="admin-shipment-modal__form" onSubmit={handleSaveStages}>
              <div className="admin-shipment-stages__toolbar"><button type="button" className="admin-shipment-modal__button admin-shipment-modal__button--ghost" onClick={addStage}>Add Stage</button><span>Changes to completion state can notify linked customers through the existing tracking event flow.</span></div>
              <div className="admin-shipment-stages">
                {stageDraft.map((stage, index) => (
                  <div className="admin-shipment-stage-editor" key={stage.id || stage.key || index}>
                    <div className="admin-shipment-stage-editor__top"><strong>Stage {index + 1}</strong><label className="admin-shipment-stage-editor__check"><input type="checkbox" checked={Boolean(stage.isCompleted)} onChange={(event) => updateStage(stage.id || stage.key, "isCompleted", event.target.checked)} /> Completed</label><span className={stage.isCompleted ? "admin-shipment-stage-editor__status admin-shipment-stage-editor__status--complete" : "admin-shipment-stage-editor__status"}>{stage.isCompleted ? "Complete" : "Pending"}</span></div>
                    <div className="admin-shipment-stage-editor__grid">
                      <label className="admin-shipment-modal__field"><span>Stage name</span><input value={stage.label} onChange={(event) => updateStage(stage.id || stage.key, "label", event.target.value)} required /></label>
                      <label className="admin-shipment-modal__field"><span>Completion date</span><input type="date" value={stage.completedAt || ""} disabled={!stage.isCompleted} onChange={(event) => updateStage(stage.id || stage.key, "completedAt", event.target.value)} /></label>
                    </div>
                    <label className="admin-shipment-modal__field"><span>Description</span><textarea value={stage.description || ""} onChange={(event) => updateStage(stage.id || stage.key, "description", event.target.value)} placeholder="What should the customer know about this stage?" /></label>
                    <div className="admin-shipment-stage-editor__actions"><button type="button" className="admin-products-action admin-products-action--edit" onClick={() => moveStage(index, -1)} disabled={index === 0}>Up</button><button type="button" className="admin-products-action admin-products-action--edit" onClick={() => moveStage(index, 1)} disabled={index === stageDraft.length - 1}>Down</button><button type="button" className="admin-products-action admin-products-action--delete" onClick={() => removeStage(stage, index)}>Delete</button></div>
                  </div>
                ))}
              </div>
              <div className="admin-shipment-modal__actions"><button type="button" className="admin-shipment-modal__button admin-shipment-modal__button--ghost" onClick={closeDialogs}>Cancel</button><button type="submit" className="admin-shipment-modal__button admin-shipment-modal__button--primary" disabled={savingStages}>{savingStages ? "Saving..." : "Save Stages"}</button></div>
            </form>
          </aside>
        </div>
      ) : null}

      {selectedTrack ? (
        <div className="admin-shipment-modal" role="dialog" aria-modal="true" aria-label="Shipment track details">
          <button type="button" className="admin-shipment-modal__scrim" onClick={closeDialogs} aria-label="Close shipment details" />
          <aside className="admin-shipment-modal__panel">
            <header className="admin-shipment-modal__header"><div><p>{selectedTrack.shippingMethodLabel}</p><h2>{selectedTrack.batchNumber}</h2><span>{selectedTrack.headline || selectedTrack.stepLabel}</span></div><button type="button" className="admin-shipment-modal__close" onClick={closeDialogs}>Close</button></header>
            <ShipmentTrack stepStates={selectedTrack.stepStates} />
            <div className="admin-shipment-modal__stage-list">{(selectedTrack.stages ?? []).map((stage) => <div key={stage.id} className="admin-shipment-modal__stage-item"><div><strong>{stage.label}</strong><span>{stage.description || "No stage description"}</span></div><em>{stage.isCompleted ? `Completed${stage.completedAt ? ` · ${formatShortDate(stage.completedAt)}` : ""}` : "Pending"}</em></div>)}</div>
            <div className="admin-shipment-modal__details"><div><span>Status</span><strong>{selectedTrack.currentStatusLabel}</strong></div><div><span>Announcement</span><strong>{selectedTrack.announcement || "No announcement"}</strong></div><div><span>Departure</span><strong>{formatShortDate(selectedTrack.estimatedDeparture)}</strong></div><div><span>Arrival</span><strong>{formatShortDate(selectedTrack.estimatedArrival)}</strong></div><div><span>Last updated</span><strong>{formatShortDate(selectedTrack.updatedAt)}</strong></div></div>
            <div className="admin-shipment-modal__actions"><button type="button" className="admin-shipment-modal__button admin-shipment-modal__button--primary" onClick={() => openEdit(selectedTrack)}>Edit Track</button></div>
          </aside>
        </div>
      ) : null}

      {feeModalOpen ? (
        <div className="admin-shipment-modal" role="dialog" aria-modal="true" aria-label="Shipping fee editor">
          <button type="button" className="admin-shipment-modal__scrim" onClick={closeDialogs} aria-label="Close shipping fee editor" />
          <aside className="admin-shipment-modal__panel"><header className="admin-shipment-modal__header"><div><p>Catalog operations</p><h2>Update Shipping Fee</h2><span>Keep existing shipping-fee behavior unchanged.</span></div><button type="button" className="admin-shipment-modal__close" onClick={closeDialogs}>Close</button></header><form className="admin-shipment-modal__form" onSubmit={handleSaveFee}><label className="admin-shipment-modal__field"><span>Product</span><input value={feeDraft.productName} onChange={(event) => setFeeDraft((current) => ({ ...current, productName: event.target.value }))} placeholder="Product name or slug" /></label><label className="admin-shipment-modal__field"><span>Shipping Fee</span><input type="number" min="0" step="0.01" value={feeDraft.shippingFee} onChange={(event) => setFeeDraft((current) => ({ ...current, shippingFee: event.target.value }))} placeholder="0.00" /></label><div className="admin-shipment-modal__actions"><button type="button" className="admin-shipment-modal__button admin-shipment-modal__button--ghost" onClick={closeDialogs}>Cancel</button><button type="submit" className="admin-shipment-modal__button admin-shipment-modal__button--primary" disabled={savingFee}>{savingFee ? "Updating..." : "Update Fee"}</button></div></form></aside>
        </div>
      ) : null}
    </main>
  );
}

export default ShipmentPage;
