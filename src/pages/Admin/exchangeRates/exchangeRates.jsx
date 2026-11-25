import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

async function adminRequest(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "The request could not be completed.");
  return payload;
}

function formatRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate.toFixed(6) : "Not configured";
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

export default function ExchangeRatesPage() {
  const [settings, setSettings] = useState(null);
  const [history, setHistory] = useState([]);
  const [manualRate, setManualRate] = useState("");
  const [mode, setMode] = useState("manual");
  const [calculatorAmount, setCalculatorAmount] = useState("100");
  const [calculatorDirection, setCalculatorDirection] = useState("cny-ghs");
  const [rateSource, setRateSource] = useState("active");
  const [customRate, setCustomRate] = useState("");
  const [preview, setPreview] = useState(null);
  const [approvalToken, setApprovalToken] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [settingsResult, historyResult] = await Promise.all([
        adminRequest("/api/admin/exchange-rates"),
        adminRequest("/api/admin/exchange-rates/history"),
      ]);
      const nextSettings = settingsResult.settings;
      setSettings(nextSettings);
      setHistory(historyResult.history ?? []);
      setManualRate(nextSettings?.manualRate ? String(nextSettings.manualRate) : "");
      setMode(nextSettings?.activePricingMode ?? "manual");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const activeRate = Number(settings?.activePricingMode === "live" ? settings?.liveRate : settings?.manualRate);
  const calculatedValue = useMemo(() => {
    const amount = Number(calculatorAmount);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(activeRate) || activeRate <= 0) return "";
    const result = calculatorDirection === "cny-ghs" ? amount * activeRate : amount / activeRate;
    return result.toFixed(2);
  }, [activeRate, calculatorAmount, calculatorDirection]);

  const run = async (label, request) => {
    setBusy(label); setError(""); setMessage("");
    try { const result = await request(); setMessage(result.message || "Updated successfully."); await load(); return result; }
    catch (requestError) { setError(requestError.message); return null; }
    finally { setBusy(""); }
  };

  const refreshLive = () => run("refresh", async () => {
    const result = await adminRequest("/api/admin/exchange-rates/refresh", { method: "POST" });
    return result;
  });
  const saveManual = () => run("manual", () => adminRequest("/api/admin/exchange-rates/manual", { method: "PATCH", body: JSON.stringify({ rate: manualRate }) }));
  const saveMode = () => run("mode", () => adminRequest("/api/admin/exchange-rates/mode", { method: "PATCH", body: JSON.stringify({ mode }) }));

  const loadPreview = async () => {
    setBusy("preview"); setError(""); setMessage("");
    try {
      const result = await adminRequest("/api/admin/exchange-rates/reprice/preview", { method: "POST", body: JSON.stringify({ rateSource, rate: customRate }) });
      setPreview(result); setApprovalToken(result.approvalToken || ""); setSelectedIds(new Set((result.rows ?? []).map((row) => row.productId)));
    } catch (previewError) { setError(previewError.message); }
    finally { setBusy(""); }
  };

  const applyPreview = async () => {
    if (!preview || selectedIds.size === 0 || !window.confirm("Apply the reviewed GHS prices to the selected products?")) return;
    const result = await run("apply", () => adminRequest("/api/admin/exchange-rates/reprice/apply", {
      method: "POST",
      body: JSON.stringify({ approvalToken, productIds: [...selectedIds] }),
    }));
    if (result) { setPreview(null); setApprovalToken(""); }
  };

  if (loading) return <main className="admin-exchange-rates"><div className="admin-section-card"><p>Loading exchange-rate settings...</p></div></main>;

  return (
    <main className="admin-exchange-rates">
      <header className="admin-exchange-rates__header">
        <div><p className="admin-kicker">Pricing controls</p><h1>Exchange Rates</h1><p>Manage the CNY to GHS conversion used when products are priced in CNY.</p></div>
        <button type="button" className="admin-button admin-button--primary" onClick={refreshLive} disabled={Boolean(busy)}>Refresh live rate</button>
      </header>
      {error ? <div className="admin-alert admin-alert--error">{error}</div> : null}
      {message ? <div className="admin-alert admin-alert--success">{message}</div> : null}
      <section className="admin-exchange-rates__grid">
        <article className="admin-section-card"><span>Active mode</span><strong>{settings?.activePricingMode ?? "Not configured"}</strong><small>Active rate: {formatRate(activeRate)}</small></article>
        <article className="admin-section-card"><span>Live rate</span><strong>{formatRate(settings?.liveRate)}</strong><small>{settings?.liveRateProvider || "No provider response"} · {formatDate(settings?.lastSuccessfulFetchAt)}</small></article>
        <article className="admin-section-card"><span>Manual rate</span><strong>{formatRate(settings?.manualRate)}</strong><small>{settings?.cnyProductCount ?? 0} CNY products</small></article>
      </section>
      <p className="admin-exchange-rates__attribution">Rates are provided by ExchangeRate-API. Please retain provider attribution when using the open endpoint.</p>
      <section className="admin-section-card admin-exchange-rates__controls">
        <h2>Active pricing source</h2>
        <div className="admin-exchange-rates__form-row"><label>Mode<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="manual">Manual</option><option value="live">Live</option></select></label><button type="button" className="admin-button" onClick={saveMode} disabled={Boolean(busy)}>Save mode</button></div>
        <div className="admin-exchange-rates__form-row"><label>Manual CNY to GHS rate<input type="number" min="0.000001" step="0.000001" value={manualRate} onChange={(event) => setManualRate(event.target.value)} /></label><button type="button" className="admin-button" onClick={saveManual} disabled={Boolean(busy)}>Save manual rate</button></div>
        <p className="admin-exchange-rates__note">Live rates fail closed when stale. Refreshing records the provider response and does not reprice products automatically.</p>
      </section>
      <section className="admin-section-card"><h2>Calculator</h2><div className="admin-exchange-rates__form-row"><label>Amount<input type="number" min="0" value={calculatorAmount} onChange={(event) => setCalculatorAmount(event.target.value)} /></label><label>Direction<select value={calculatorDirection} onChange={(event) => setCalculatorDirection(event.target.value)}><option value="cny-ghs">CNY to GHS</option><option value="ghs-cny">GHS to CNY</option></select></label><output className="admin-exchange-rates__output">{calculatedValue || "-"}</output></div></section>
      <section className="admin-section-card"><div className="admin-exchange-rates__section-heading"><div><h2>Bulk repricing</h2><p>Preview changes before updating selected active CNY products.</p></div><button type="button" className="admin-button" onClick={loadPreview} disabled={Boolean(busy)}>Preview repricing</button></div><div className="admin-exchange-rates__form-row"><label>Rate source<select value={rateSource} onChange={(event) => setRateSource(event.target.value)}><option value="active">Active rate</option><option value="live">Live rate</option><option value="manual">Manual rate</option><option value="custom">Custom rate</option></select></label>{rateSource === "custom" ? <label>Custom rate<input type="number" min="0.000001" step="0.000001" value={customRate} onChange={(event) => setCustomRate(event.target.value)} /></label> : null}</div>{preview ? <><p>{preview.total} products in preview at rate {formatRate(preview.rate)}.</p><div className="admin-exchange-rates__table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Current GHS</th><th>Proposed GHS</th><th>Select</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.productId}><td>{row.name}</td><td>{Number(row.currentGhsPrice).toFixed(2)}</td><td>{Number(row.proposedGhsPrice).toFixed(2)}</td><td><input type="checkbox" checked={selectedIds.has(row.productId)} onChange={() => setSelectedIds((current) => { const next = new Set(current); next.has(row.productId) ? next.delete(row.productId) : next.add(row.productId); return next; })} /></td></tr>)}</tbody></table></div><button type="button" className="admin-button admin-button--primary" onClick={applyPreview} disabled={Boolean(busy) || selectedIds.size === 0}>Apply selected repricing</button></> : null}</section>
      <section className="admin-section-card"><h2>Rate history</h2><div className="admin-exchange-rates__table-wrap"><table className="admin-table"><thead><tr><th>Date</th><th>Source</th><th>Previous</th><th>New</th><th>Reason</th></tr></thead><tbody>{history.map((entry) => <tr key={entry.id}><td>{formatDate(entry.created_at)}</td><td>{entry.rate_source}</td><td>{formatRate(entry.previous_rate)}</td><td>{formatRate(entry.new_rate)}</td><td>{entry.change_reason || "-"}</td></tr>)}</tbody></table></div></section>
    </main>
  );
}
