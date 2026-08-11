import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import { formatMoney, formatShortDate } from "../adminHelpers";
import {
  buildProductBundlePayloadFromLegacyProduct,
  saveProductBundle,
  useProducts,
} from "../../Products/productData";
import ShipmentTrack from "../../../shared/ShipmentTrack";
import {
  SHIPMENT_STEPS,
  createOrUpdateShipment,
  getShipmentProgressPercent,
  getShipmentStatusForStep,
  getShipmentStepLabel,
  getShipmentStepState,
  getShipmentShippingMethodLabel,
  useShipmentBatches,
} from "../../../shared/shipmentStorage";
import {
  defaultSiteBanner,
  normalizeSiteBanner,
} from "../../../shared/siteBannerStorage";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return clean(value).toLowerCase();
}

function getEmptyTrackingDraft() {
  return {
    batchNumber: "",
    headline: "",
    body: "",
    shippingMethod: "air",
    stepIndex: 0,
    currentStatus: "preparing",
  };
}

function getTrackingDraftDefaults({ shipmentSummaries = [], siteBanner = defaultSiteBanner } = {}) {
  const safeSiteBanner = normalizeSiteBanner(siteBanner ?? defaultSiteBanner);
  const latestSummary = Array.isArray(shipmentSummaries) ? shipmentSummaries[0] ?? null : null;

  return {
    batchNumber:
      clean(latestSummary?.batchNumber) ||
      clean(safeSiteBanner?.announcement?.batchNumber) ||
      "",
    headline: clean(latestSummary?.headline),
    body: clean(latestSummary?.body),
    shippingMethod:
      clean(latestSummary?.shippingMethod) ||
      clean(safeSiteBanner?.announcement?.shippingMode) ||
      "air",
    stepIndex: latestSummary?.currentStep ?? 0,
    currentStatus: latestSummary?.currentStatus ?? "preparing",
  };
}

function getEmptyFeeDraft() {
  return {
    productName: "",
    shippingFee: "",
  };
}

function buildShippingBalancePaymentUrl({ order, amount, productName, shippingFee }) {
  const params = new URLSearchParams({
    purpose: "shipping-balance",
    orderId: order.id,
    orderNumber: order.orderNumber,
    amount: String(amount),
    email: order.customerEmail ?? "",
    name: order.customerName ?? "",
    productName: productName ?? "",
    shippingFee: String(shippingFee ?? ""),
  });

  return `/payment?${params.toString()}`;
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

function StepperButton({ step, state, index, onClick }) {
  return (
    <button
      type="button"
      className={`admin-shipment-stepper__step admin-shipment-stepper__step--${state}`}
      onClick={() => onClick(index)}
    >
      <span>{index + 1}</span>
      <strong>{step.label}</strong>
    </button>
  );
}

function ShipmentBatchCard({ summary, onView, onEdit, onRefresh }) {
  return (
    <article className="admin-shipment-card">
      <div className="admin-shipment-card__header">
        <div>
          <p>{summary.batchNumber}</p>
          <h3>{summary.headline || summary.stepLabel}</h3>
          <span>
            {summary.body ||
              summary.latestEvent?.message ||
              "Tracking updates are synced to customer profiles."}
          </span>
        </div>
        <span className="admin-shipment-pill">{summary.shippingMethodLabel}</span>
      </div>

      <ShipmentTrack stepStates={summary.stepStates} />

      <div className="admin-shipment-card__meta">
        <div>
          <span>Orders</span>
          <strong>{summary.orderCount}</strong>
        </div>
        <div>
          <span>Customers</span>
          <strong>{summary.customerCount}</strong>
        </div>
        <div>
          <span>Progress</span>
          <strong>{summary.progressPercent}%</strong>
        </div>
        <div>
          <span>Updated</span>
          <strong>{formatShortDate(summary.updatedAt)}</strong>
        </div>
      </div>

      {summary.latestEvent ? (
        <div className="admin-shipment-card__meta">
          <div style={{ gridColumn: "1 / -1" }}>
            <span>Latest event</span>
            <strong>{summary.latestEvent.title}</strong>
            <small>{summary.latestEvent.message || summary.latestEvent.location}</small>
          </div>
        </div>
      ) : null}

      <div className="admin-shipment-card__actions">
        <button
          type="button"
          className="admin-products-action admin-products-action--edit"
          onClick={onView}
        >
          View
        </button>
        <button
          type="button"
          className="admin-products-action admin-products-action--edit"
          onClick={onEdit}
        >
          Edit
        </button>
        <button
          type="button"
          className="admin-products-action admin-products-action--delete"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>
    </article>
  );
}

function ShipmentPage({
  orders = [],
  authUser = null,
  siteBanner = defaultSiteBanner,
}) {
  const session = authUser ?? loadAdminSession();
  const liveOrders = Array.isArray(orders) ? orders : [];
  const safeSiteBanner = normalizeSiteBanner(siteBanner ?? defaultSiteBanner);
  const {
    shipments: shipmentSummaries,
    shipmentsByOrderId,
    loading: shipmentsLoading,
    error: shipmentsError,
    refresh: refreshShipments,
  } = useShipmentBatches({ orders: liveOrders });
  const [trackingModalOpen, setTrackingModalOpen] = useState(false);
  const [feeModalOpen, setFeeModalOpen] = useState(false);
  const [trackingDraft, setTrackingDraft] = useState(getEmptyTrackingDraft);
  const [feeDraft, setFeeDraft] = useState(getEmptyFeeDraft);
  const [selectedBatchNumber, setSelectedBatchNumber] = useState("");
  const [formError, setFormError] = useState("");
  const [isSavingTracking, setIsSavingTracking] = useState(false);
  const [isSavingFee, setIsSavingFee] = useState(false);
  const {
    products: liveProducts,
    loading: productsLoading,
    error: productsError,
    refresh: refreshProducts,
  } = useProducts();

  const pendingFeeProducts = useMemo(
    () =>
      liveProducts.filter(
        (product) =>
          product.shippingFeeStatus === "pending" || product.shippingFee == null,
      ),
    [liveProducts],
  );

  const selectedSummary = useMemo(
    () =>
      shipmentSummaries.find(
        (summary) => normalizeKey(summary.batchNumber) === normalizeKey(selectedBatchNumber),
      ) ?? null,
    [selectedBatchNumber, shipmentSummaries],
  );

  const activeTrackingSummary =
    selectedSummary ??
    (trackingDraft.batchNumber
      ? shipmentSummaries.find(
          (summary) => normalizeKey(summary.batchNumber) === normalizeKey(trackingDraft.batchNumber),
        ) ?? null
      : null);

  const summaryMetrics = useMemo(() => {
    const totalBatches = shipmentSummaries.length;
    const activeBatches = shipmentSummaries.filter((batch) => batch.currentStatus !== "delivered").length;
    const completedBatches = shipmentSummaries.filter((batch) => batch.currentStatus === "delivered").length;
    const trackedOrders = shipmentSummaries.reduce((sum, batch) => sum + batch.orderCount, 0);

    return {
      totalBatches,
      activeBatches,
      completedBatches,
      trackedOrders,
    };
  }, [shipmentSummaries]);

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  const closeModals = () => {
    setTrackingModalOpen(false);
    setFeeModalOpen(false);
    setTrackingDraft(getEmptyTrackingDraft());
    setFeeDraft(getEmptyFeeDraft());
    setFormError("");
    setSelectedBatchNumber("");
  };

  const openNewTrackingModal = () => {
    const defaultDraft = getTrackingDraftDefaults({
      shipmentSummaries,
      siteBanner: safeSiteBanner,
    });

    setTrackingDraft(defaultDraft);
    setTrackingModalOpen(true);
    setFeeModalOpen(false);
    setSelectedBatchNumber(defaultDraft.batchNumber);
    setFormError("");
  };

  const openTrackingModal = (summary) => {
    setTrackingDraft({
      batchNumber: summary.batchNumber ?? "",
      headline: summary.headline ?? "",
      body: summary.body ?? "",
      shippingMethod: summary.shippingMethod ?? "air",
      stepIndex: summary.currentStep ?? 0,
      currentStatus: summary.currentStatus ?? getShipmentStatusForStep(summary.currentStep ?? 0),
    });
    setSelectedBatchNumber(summary.batchNumber ?? "");
    setTrackingModalOpen(true);
    setFeeModalOpen(false);
    setFormError("");
  };

  const openFeeModal = () => {
    setFeeDraft(getEmptyFeeDraft());
    setFeeModalOpen(true);
    setTrackingModalOpen(false);
    setFormError("");
  };

  const persistTrackingBatch = async (nextStepIndex = trackingDraft.stepIndex, nextStatus = trackingDraft.currentStatus) => {
    const batchNumber = trackingDraft.batchNumber.trim();

    if (!batchNumber) {
      setFormError("Please add a batch number.");
      return { ok: false };
    }

    const result = await createOrUpdateShipment({
      batch_number: batchNumber,
      headline: trackingDraft.headline.trim(),
      body: trackingDraft.body.trim(),
      shipping_method: trackingDraft.shippingMethod,
      current_step: nextStepIndex,
      current_status: nextStatus || getShipmentStatusForStep(nextStepIndex),
    });

    if (!result.ok) {
      setFormError(result.message || "Could not save the shipment batch.");
      return result;
    }

    await refreshShipments();
    return result;
  };

  const handleSaveTracking = async (event) => {
    event.preventDefault();
    setIsSavingTracking(true);
    setFormError("");

    try {
      const result = await persistTrackingBatch(
        trackingDraft.stepIndex,
        trackingDraft.currentStatus,
      );

      if (!result.ok) {
        return;
      }

      setTrackingModalOpen(false);
      setTrackingDraft(getEmptyTrackingDraft());
      setSelectedBatchNumber("");
    } finally {
      setIsSavingTracking(false);
    }
  };

  const handleStepChange = async (index) => {
    const batchNumber = trackingDraft.batchNumber.trim();

    if (!batchNumber) {
      setFormError("Please add a batch number before updating the step.");
      return;
    }

    const currentStep = activeTrackingSummary?.currentStep ?? 0;
    const currentStatus = activeTrackingSummary?.currentStatus ?? getShipmentStatusForStep(currentStep);
    const targetLabel = getShipmentStepLabel(index);
    const confirmed = window.confirm(`Do you want to update this batch to "${targetLabel}"?`);

    if (!confirmed) {
      return;
    }

    const nextStatus =
      currentStatus === "delivered" && index === 4
        ? "delivered"
        : getShipmentStatusForStep(index);

    const saved = await persistTrackingBatch(index, nextStatus);

    if (!saved.ok) {
      return;
    }

    setTrackingDraft((current) => ({
      ...current,
      stepIndex: index,
      currentStatus: nextStatus,
    }));
    setSelectedBatchNumber(batchNumber);
  };

  const handleOpenBatch = (summary) => {
    openTrackingModal(summary);
  };

  const batchOptions = useMemo(() => {
    const values = new Set();
    const bannerBatchNumber = clean(safeSiteBanner?.announcement?.batchNumber);

    for (const order of liveOrders) {
      const batchNumber = clean(order?.batchNumber);

      if (batchNumber) {
        values.add(batchNumber);
      }
    }

    for (const summary of shipmentSummaries) {
      const batchNumber = clean(summary?.batchNumber);

      if (batchNumber) {
        values.add(batchNumber);
      }
    }

    if (bannerBatchNumber) {
      values.add(bannerBatchNumber);
    }

    return [...values].sort((left, right) => left.localeCompare(right));
  }, [liveOrders, shipmentSummaries, safeSiteBanner]);

  const handleSubmitShippingFee = async (event) => {
    event.preventDefault();
    setIsSavingFee(true);
    setFormError("");

    try {
      const productName = feeDraft.productName.trim();
      const amount = Number(feeDraft.shippingFee);

      if (!productName) {
        setFormError("Please add a product name.");
        return;
      }

      if (!Number.isFinite(amount) || amount < 0) {
        setFormError("Please add a valid shipping fee amount.");
        return;
      }

      const normalizedName = normalizeKey(productName);
      const matchedProduct =
        liveProducts.find((product) => normalizeKey(product.slug) === normalizedName) ??
        liveProducts.find((product) => normalizeKey(product.name) === normalizedName) ??
        liveProducts.find((product) => normalizeKey(product.name).includes(normalizedName)) ??
        liveProducts.find((product) => normalizedName.includes(normalizeKey(product.name)));

      if (!matchedProduct) {
        setFormError("We could not find that product in the catalog.");
        return;
      }

      const updatedProduct = {
        ...matchedProduct,
        shippingFee: amount,
        shippingFeeStatus: "ready",
      };

      const saveResult = await saveProductBundle(
        buildProductBundlePayloadFromLegacyProduct(updatedProduct),
      );

      if (!saveResult.ok) {
        setFormError(saveResult.message ?? "Unable to update the shipping fee.");
        return;
      }

      await refreshProducts();
      setFeeDraft(getEmptyFeeDraft());
      setFeeModalOpen(false);
    } finally {
      setIsSavingFee(false);
    }
  };

  const handleSelectBatchNumber = (event) => {
    const batchNumber = event.target.value;
    setTrackingDraft((current) => ({
      ...current,
      batchNumber,
      currentStatus: current.currentStatus || getShipmentStatusForStep(current.stepIndex),
    }));
    setSelectedBatchNumber(batchNumber);
  };

  return (
    <main className="admin-products-page admin-shipment-page">
      <section className="admin-products-shell admin-shipment-shell">
        <header className="admin-products-header admin-shipment-header">
          <div>
            <p>Admin catalog</p>
            <h1>Shipment Tracking</h1>
            <span>
              Manage batch progress, update shipping stages, and keep shipment updates in Supabase.
            </span>
          </div>

          <div className="admin-products-header__actions">
            <Link
              to="/admin/dashboard"
              className="admin-products-header__button admin-products-header__button--ghost"
            >
              Back to dashboard
            </Link>
            <button
              type="button"
              className="admin-products-header__button"
              onClick={openNewTrackingModal}
            >
              New Shipment Tracking
            </button>
            <button
              type="button"
              className="admin-products-header__button admin-products-header__button--ghost"
              onClick={openFeeModal}
              disabled={pendingFeeProducts.length === 0 || productsLoading}
            >
              Update Shipment Fee
            </button>
          </div>
        </header>

        {shipmentsError ? (
          <p className="admin-shipment-modal__error">{shipmentsError}</p>
        ) : null}

        {productsError ? (
          <p className="admin-shipment-modal__error">
            {productsError.message ?? productsError}
          </p>
        ) : null}

        {shipmentsLoading ? (
          <p className="admin-shipment-modal__hint">Loading shipment progress from Supabase...</p>
        ) : null}

        <section className="admin-products-summary">
          <SummaryCard
            title="Total Batches"
            value={summaryMetrics.totalBatches}
            note="All tracked order batches in the shipment system."
          />
          <SummaryCard
            title="Active Batches"
            value={summaryMetrics.activeBatches}
            note="Batches still moving through the tracker."
          />
          <SummaryCard
            title="Completed"
            value={summaryMetrics.completedBatches}
            note="Batches already packed for delivery."
          />
          <SummaryCard
            title="Tracked Orders"
            value={summaryMetrics.trackedOrders}
            note="Orders currently tied to a tracked shipment."
          />
        </section>

        <section className="admin-products-panel admin-shipment-panel">
          {shipmentSummaries.length > 0 ? (
            <div className="admin-shipment-cards">
              {shipmentSummaries.map((summary) => (
                <ShipmentBatchCard
                  key={summary.batchNumber}
                  summary={summary}
                  onView={() => handleOpenBatch(summary)}
                  onEdit={() => handleOpenBatch(summary)}
                  onRefresh={refreshShipments}
                />
              ))}
            </div>
          ) : (
            <div className="admin-products-empty">
              <h2>No shipment batches found.</h2>
              <p>Start a new shipment tracking batch to begin tracking progress.</p>
            </div>
          )}
        </section>
      </section>

      {trackingModalOpen ? (
        <div className="admin-shipment-modal" role="dialog" aria-modal="true" aria-label="Shipment tracking form">
          <button
            type="button"
            className="admin-shipment-modal__scrim"
            onClick={closeModals}
            aria-label="Close shipment tracking form"
          />

          <aside className="admin-shipment-modal__panel">
            <header className="admin-shipment-modal__header">
              <div>
                <p>Shipment tracking</p>
                <h2>{trackingDraft.batchNumber ? `Batch ${trackingDraft.batchNumber}` : "New Shipment Tracking"}</h2>
                <span>
                  Set the batch number, choose the stage, and push tracking updates to the matching customers.
                </span>
              </div>
              <button type="button" className="admin-shipment-modal__close" onClick={closeModals}>
                Close
              </button>
            </header>

            <form className="admin-shipment-modal__form" onSubmit={handleSaveTracking}>
              <div className="admin-shipment-modal__grid">
                <label className="admin-shipment-modal__field">
                  <span>Batch Number</span>
                  <input
                    list="shipment-batch-options"
                    type="text"
                    value={trackingDraft.batchNumber}
                    onChange={handleSelectBatchNumber}
                    placeholder="Example: BATCH-000123"
                  />
                  <datalist id="shipment-batch-options">
                    {batchOptions.map((batchNumber) => (
                      <option key={batchNumber} value={batchNumber} />
                    ))}
                  </datalist>
                </label>

                <label className="admin-shipment-modal__field">
                  <span>Shipping Method</span>
                  <select
                    value={trackingDraft.shippingMethod}
                    onChange={(event) =>
                      setTrackingDraft((current) => ({
                        ...current,
                        shippingMethod: event.target.value,
                      }))
                    }
                  >
                    <option value="air">Air Freight</option>
                    <option value="sea">Sea Freight</option>
                    <option value="both">Both</option>
                  </select>
                </label>
              </div>

              <div className="admin-shipment-modal__grid">
                <label className="admin-shipment-modal__field">
                  <span>Headline</span>
                  <input
                    type="text"
                    value={trackingDraft.headline}
                    onChange={(event) =>
                      setTrackingDraft((current) => ({
                        ...current,
                        headline: event.target.value,
                      }))
                    }
                    placeholder="Batch headline"
                  />
                </label>

                <label className="admin-shipment-modal__field">
                  <span>Current Step</span>
                  <select
                    value={trackingDraft.stepIndex}
                    onChange={(event) => {
                      const stepIndex = Number(event.target.value);
                      const nextStatus =
                        trackingDraft.currentStatus === "delivered" && stepIndex === 4
                          ? "delivered"
                          : getShipmentStatusForStep(stepIndex);

                      setTrackingDraft((current) => ({
                        ...current,
                        stepIndex,
                        currentStatus: nextStatus,
                      }));
                    }}
                  >
                    {SHIPMENT_STEPS.map((step, index) => (
                      <option key={step.key} value={index}>
                        {step.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="admin-shipment-modal__field">
                <span>Announcement / Note</span>
                <textarea
                  value={trackingDraft.body}
                  onChange={(event) =>
                    setTrackingDraft((current) => ({
                      ...current,
                      body: event.target.value,
                    }))
                  }
                  placeholder="Add a short note for customers on this batch."
                />
              </label>

              {formError ? <p className="admin-shipment-modal__error">{formError}</p> : null}

              {trackingDraft.batchNumber ? (
                <div className="admin-shipment-stepper" aria-label="Shipment steps">
                  {SHIPMENT_STEPS.map((step, index) => (
                    <StepperButton
                      key={step.key}
                      step={step}
                      index={index}
                      state={getShipmentStepState(trackingDraft.stepIndex, index, trackingDraft.currentStatus)}
                      onClick={handleStepChange}
                    />
                  ))}
                </div>
              ) : (
                <p className="admin-shipment-modal__hint">
                  Add a batch number to generate the shipment stepper.
                </p>
              )}

              {activeTrackingSummary ? (
                <div className="admin-shipment-modal__details">
                  <div>
                    <span>Orders in batch</span>
                    <strong>{activeTrackingSummary.orderCount}</strong>
                  </div>
                  <div>
                    <span>Customers</span>
                    <strong>{activeTrackingSummary.customerCount}</strong>
                  </div>
                  <div>
                    <span>Progress</span>
                    <strong>
                      {getShipmentProgressPercent(
                        trackingDraft.stepIndex,
                        trackingDraft.currentStatus,
                      )}
                      %
                    </strong>
                  </div>
                  <div>
                    <span>Updated</span>
                    <strong>{formatShortDate(activeTrackingSummary.updatedAt)}</strong>
                  </div>
                </div>
              ) : null}

              {activeTrackingSummary?.events?.length > 0 ? (
                <div className="admin-shipment-modal__details">
                  <div style={{ gridColumn: "1 / -1" }}>
                    <span>Latest events</span>
                    <ul className="admin-shipment-modal__event-list">
                      {activeTrackingSummary.events.slice(0, 3).map((event) => (
                        <li key={event.id}>
                          <strong>{event.title}</strong>
                          <span>
                            {event.message || event.location || "Shipment progress updated"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}

              <div className="admin-shipment-modal__actions">
                <button
                  type="button"
                  className="admin-shipment-modal__button admin-shipment-modal__button--ghost"
                  onClick={closeModals}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-shipment-modal__button admin-shipment-modal__button--primary"
                  disabled={isSavingTracking}
                >
                  {isSavingTracking ? "Saving..." : "Save Tracking"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {feeModalOpen ? (
        <div className="admin-shipment-modal" role="dialog" aria-modal="true" aria-label="Update shipping fee form">
          <button
            type="button"
            className="admin-shipment-modal__scrim"
            onClick={closeModals}
            aria-label="Close shipping fee form"
          />

          <aside className="admin-shipment-modal__panel">
            <header className="admin-shipment-modal__header">
              <div>
                <p>Shipping fee</p>
                <h2>Update Shipment Fee</h2>
                <span>Set the shipping fee for a product and update the catalog record.</span>
              </div>
              <button type="button" className="admin-shipment-modal__close" onClick={closeModals}>
                Close
              </button>
            </header>

            <form className="admin-shipment-modal__form" onSubmit={handleSubmitShippingFee}>
              <label className="admin-shipment-modal__field">
                <span>Product Name</span>
                <input
                  list="shipment-product-options"
                  type="text"
                  value={feeDraft.productName}
                  onChange={(event) =>
                    setFeeDraft((current) => ({
                      ...current,
                      productName: event.target.value,
                    }))
                  }
                  placeholder="Search product name"
                />
                <datalist id="shipment-product-options">
                  {liveProducts.map((product) => (
                    <option key={product.slug} value={product.name} />
                  ))}
                </datalist>
              </label>

              <label className="admin-shipment-modal__field">
                <span>Shipping Fee Amount</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={feeDraft.shippingFee}
                  onChange={(event) =>
                    setFeeDraft((current) => ({
                      ...current,
                      shippingFee: event.target.value,
                    }))
                  }
                  placeholder="0.00"
                />
              </label>

              {formError ? <p className="admin-shipment-modal__error">{formError}</p> : null}

              <div className="admin-shipment-modal__details">
                <div>
                  <span>Pending fee products</span>
                  <strong>{pendingFeeProducts.length}</strong>
                </div>
                <div>
                  <span>Matching orders</span>
                  <strong>
                    {feeDraft.productName
                      ? liveOrders.filter(
                          (order) =>
                            Array.isArray(order.items) &&
                            order.items.some((item) => {
                              const itemSlug = normalizeKey(item.slug || item.name);
                              const target = normalizeKey(feeDraft.productName);
                              return itemSlug === target || normalizeKey(item.name).includes(target);
                            }),
                        ).length
                      : 0}
                  </strong>
                </div>
              </div>

              <div className="admin-shipment-modal__actions">
                <button
                  type="button"
                  className="admin-shipment-modal__button admin-shipment-modal__button--ghost"
                  onClick={closeModals}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-shipment-modal__button admin-shipment-modal__button--primary"
                  disabled={isSavingFee || productsLoading}
                >
                  {isSavingFee ? "Saving..." : "Update Fee"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

export default ShipmentPage;
