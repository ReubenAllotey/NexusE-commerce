import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import { formatMoney, formatShortDate } from "../adminHelpers";
import { loadAdminBatches, normalizeBatch, saveBatch, updateBatchStatus, BATCH_STATUSES } from "../../../shared/batchStorage";

const emptyDraft = () => normalizeBatch({ shipmentType: "both", status: "draft" });

function Field({ label, children }) {
  return <label className="admin-batch-management-field"><span>{label}</span>{children}</label>;
}

function BatchManagementPage({ orders = [] }) {
  const session = loadAdminSession();
  const [batches, setBatches] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      setBatches(await loadAdminBatches());
      setError("");
    } catch (loadError) {
      setError(loadError?.message || "Unable to load batches. Apply the batch management migration first.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const currentBatch = batches.find((batch) => batch.status === "open") ?? null;
  const orderCounts = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      const key = String(order.batchNumber ?? order.batch_number ?? "").trim();
      if (!key) return;
      const itemCount = (order.items ?? []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const current = map.get(key) ?? { orders: 0, units: 0, value: 0 };
      current.orders += 1;
      current.units += itemCount;
      current.value += Number(order.total) || 0;
      map.set(key, current);
    });
    return map;
  }, [orders]);

  if (!session) return <Navigate to="/admin/login" replace />;

  const updateDraft = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const startNew = () => { setEditingId(""); setDraft(emptyDraft()); setMessage(""); setError(""); };
  const startEdit = (batch) => { setEditingId(batch.id); setDraft(normalizeBatch(batch)); setMessage(""); setError(""); };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!draft.batchNumber || !draft.startDate || !draft.endDate) return setError("Batch number and dates are required.");
    if (draft.startDate > draft.endDate) return setError("Batch start date must be before its end date.");
    setSaving(true); setError(""); setMessage("");
    const result = await saveBatch({ ...draft, id: editingId });
    if (!result.ok) setError(result.message);
    else { await refresh(); setMessage("Batch saved successfully."); }
    setSaving(false);
  };

  const handleStatus = async (batch, status) => {
    setError(""); setMessage("");
    const result = await updateBatchStatus(batch.id, status);
    if (!result.ok) setError(result.message);
    else { await refresh(); setMessage(`Batch ${status}.`); }
  };

  return <main className="admin-orders-page admin-batch-management-page">
    <section className="admin-orders-shell admin-batch-management-shell">
      <header className="admin-orders-header">
        <div><p>Admin operations</p><h1>Batch Management</h1><span>Create, open, close, and track Nexus import batches.</span></div>
        <button type="button" className="admin-orders-header__button" onClick={startNew}>New Batch</button>
      </header>

      {message ? <p className="admin-batch-management-message admin-batch-management-message--success">{message}</p> : null}
      {error ? <p className="admin-batch-management-message admin-batch-management-message--error">{error}</p> : null}

      <section className="admin-orders-summary admin-batch-management-cards">
        <article className="admin-orders-stat admin-orders-stat--blue"><span>Current Batch</span><strong>{currentBatch?.batchNumber || "None"}</strong><small>{currentBatch?.status === "open" ? "Accepting customer orders." : "No open batch."}</small></article>
        <article className="admin-orders-stat admin-orders-stat--indigo"><span>Total Batches</span><strong>{batches.length}</strong><small>Managed import cycles.</small></article>
        <article className="admin-orders-stat admin-orders-stat--green"><span>Open Batch</span><strong>{currentBatch ? "1" : "0"}</strong><small>Only one open batch is allowed.</small></article>
        <article className="admin-orders-stat admin-orders-stat--amber"><span>Completed</span><strong>{batches.filter((batch) => batch.status === "completed").length}</strong><small>Historical batches retained.</small></article>
      </section>

      <section className="admin-orders-panel admin-batch-management-current">
        <div><p className="admin-batch-management-eyebrow">Current batch</p><h2>{currentBatch?.batchNumber || "No open batch"}</h2></div>
        {currentBatch ? <div className="admin-batch-management-current__details"><span>{formatShortDate(currentBatch.startDate)} – {formatShortDate(currentBatch.endDate)}</span><span>Shipment: {currentBatch.shipmentType}</span><span>Status: Open</span><button type="button" className="admin-batch-management-action admin-batch-management-action--danger" onClick={() => handleStatus(currentBatch, "closed")}>Close Batch</button></div> : <small>Open a managed batch when the order window is ready.</small>}
      </section>

      <section className="admin-orders-panel admin-batch-management-editor">
        <div className="admin-batch-management-section-heading"><div><p>{editingId ? "Edit batch" : "New batch"}</p><h2>{editingId ? "Update batch details" : "Create an import batch"}</h2></div><small>Structured operational data lives here.</small></div>
        <form onSubmit={handleSubmit} className="admin-batch-management-form">
          <Field label="Batch Number"><input value={draft.batchNumber} onChange={(e) => updateDraft("batchNumber", e.target.value)} placeholder="Batch 09" /></Field>
          <Field label="Start Date"><input type="date" value={draft.startDate} onChange={(e) => updateDraft("startDate", e.target.value)} /></Field>
          <Field label="End Date"><input type="date" value={draft.endDate} onChange={(e) => updateDraft("endDate", e.target.value)} /></Field>
          <Field label="Shipment Type"><select value={draft.shipmentType} onChange={(e) => updateDraft("shipmentType", e.target.value)}><option value="air">Air</option><option value="sea">Sea</option><option value="both">Both</option></select></Field>
          {draft.shipmentType !== "sea" ? <Field label="Air Freight Days"><input type="number" min="0" value={draft.airFreightDays ?? ""} onChange={(e) => updateDraft("airFreightDays", e.target.value)} /></Field> : null}
          {draft.shipmentType !== "air" ? <Field label="Sea Freight Days"><input type="number" min="0" value={draft.seaFreightDays ?? ""} onChange={(e) => updateDraft("seaFreightDays", e.target.value)} /></Field> : null}
          <Field label="Status"><select value={draft.status} onChange={(e) => updateDraft("status", e.target.value)}>{BATCH_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></Field>
          <Field label="Notes"><textarea rows="3" value={draft.notes} onChange={(e) => updateDraft("notes", e.target.value)} /></Field>
          <div className="admin-batch-management-form__actions"><button type="button" className="admin-orders-header__button admin-orders-header__button--secondary" onClick={startNew}>Reset</button><button type="submit" className="admin-orders-header__button" disabled={saving}>{saving ? "Saving..." : "Save Batch"}</button></div>
        </form>
      </section>

      <section className="admin-orders-panel admin-batch-management-table-panel"><div className="admin-batch-management-section-heading"><div><p>Managed batches</p><h2>Import history</h2></div><small>{loading ? "Loading..." : `${batches.length} batches`}</small></div><div className="admin-batch-management-table-wrap"><table className="admin-batch-management-table"><thead><tr><th>Batch</th><th>Dates</th><th>Shipment</th><th>Status</th><th>Orders</th><th>Units</th><th>Actions</th></tr></thead><tbody>{batches.map((batch) => { const counts = orderCounts.get(batch.batchNumber) ?? { orders: 0, units: 0 }; return <tr key={batch.id}><td><strong>{batch.batchNumber}</strong><small>{batch.title || "Import batch"}</small></td><td>{formatShortDate(batch.startDate)} – {formatShortDate(batch.endDate)}</td><td>{batch.shipmentType}</td><td><span className="admin-orders-pill admin-orders-pill--blue">{batch.status}</span></td><td>{counts.orders}</td><td>{counts.units}</td><td><div className="admin-batch-management-actions"><button type="button" onClick={() => startEdit(batch)}>Edit</button>{batch.status === "open" ? <button type="button" onClick={() => handleStatus(batch, "closed")}>Close</button> : batch.status === "closed" ? <button type="button" onClick={() => handleStatus(batch, "completed")}>Complete</button> : null}</div></td></tr>; })}</tbody></table>{!loading && batches.length === 0 ? <div className="admin-batch-management-empty">No managed batches yet.</div> : null}</div></section>
    </section>
  </main>;
}

export default BatchManagementPage;
