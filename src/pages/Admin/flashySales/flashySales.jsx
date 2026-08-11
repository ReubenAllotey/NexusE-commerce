import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import { formatMoney } from "../adminHelpers";
import { useProducts } from "../../Products/productData";
import {
  deleteFlashySalesRecord,
  getFlashySalesMetrics,
  saveFlashySalesRecord,
  useFlashySalesCatalog,
} from "../../../shared/flashySalesStorage";

function MetricCard({ title, value, note }) {
  return (
    <article className="admin-products-metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function ProductImage({ product }) {
  if (!product?.image) {
    return <div className="admin-products-table__image admin-products-table__image--empty" />;
  }

  return <img src={product.image} alt={product.name} className="admin-flashy-table__image" />;
}

function getEmptyDraft() {
  return {
    productId: "",
    placement: "flashy",
    displayOrder: "0",
    startsAt: "",
    endsAt: "",
  };
}

function normalizePlacementLabel(value) {
  return String(value ?? "").toLowerCase() === "best-selling" ? "Best Selling" : "Flashy";
}

function FlashySalesPage() {
  const session = loadAdminSession();
  const {
    records,
    loading,
    error,
    refresh,
  } = useFlashySalesCatalog();
  const {
    products: availableProducts,
    loading: productsLoading,
  } = useProducts();
  const [searchTerm, setSearchTerm] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState("");
  const [draft, setDraft] = useState(getEmptyDraft);
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const metrics = useMemo(() => getFlashySalesMetrics(records), [records]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return records
      .filter((record) => {
        const matchesSearch =
          term.length === 0 ||
          `${record.name} ${record.group} ${record.price} ${record.rating}`
            .toLowerCase()
            .includes(term);
        const matchesGroup =
          groupFilter === "all" || String(record.group ?? "").toLowerCase() === groupFilter;

        return matchesSearch && matchesGroup;
      })
      .sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) ||
          String(left.name ?? "").localeCompare(String(right.name ?? "")),
      );
  }, [groupFilter, records, searchTerm]);

  const editingRecord = useMemo(
    () => records.find((record) => record.id === editingRecordId) ?? null,
    [editingRecordId, records],
  );

  const selectedProduct = useMemo(
    () => availableProducts.find((product) => product.id === draft.productId) ?? null,
    [availableProducts, draft.productId],
  );

  useEffect(() => {
    if (!editingRecord) {
      return;
    }

    setDraft({
      productId: editingRecord.productId ?? "",
      placement: editingRecord.group ?? "flashy",
      displayOrder: String(editingRecord.order ?? 0),
      startsAt: editingRecord.startsAt ? String(editingRecord.startsAt).slice(0, 10) : "",
      endsAt: editingRecord.endsAt ? String(editingRecord.endsAt).slice(0, 10) : "",
    });
  }, [editingRecord]);

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingRecordId("");
    setDraft(getEmptyDraft());
    setFormError("");
    setFormMessage("");
  };

  const openAddModal = () => {
    setEditingRecordId("");
    setDraft(getEmptyDraft());
    setFormError("");
    setFormMessage("");
    setIsModalOpen(true);
  };

  const openEditModal = (record) => {
    setEditingRecordId(record.id);
    setDraft({
      productId: record.productId ?? "",
      placement: record.group ?? "flashy",
      displayOrder: String(record.order ?? 0),
      startsAt: record.startsAt ? String(record.startsAt).slice(0, 10) : "",
      endsAt: record.endsAt ? String(record.endsAt).slice(0, 10) : "",
    });
    setFormError("");
    setFormMessage("");
    setIsModalOpen(true);
  };

  const handleDelete = async (record) => {
    const confirmDelete = window.confirm(`Remove ${record.name} from ${normalizePlacementLabel(record.group)}?`);

    if (!confirmDelete) {
      return;
    }

    const result = await deleteFlashySalesRecord({
      productId: record.productId,
      placement: record.group,
    });

    if (!result.ok) {
      setFormError(result.message || "Unable to remove the merchandising record.");
      setFormMessage("");
      return;
    }

    await refresh();
    setFormMessage("Merchandising record removed.");
    setFormError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");
    setFormMessage("");

    if (!draft.productId) {
      setFormError("Please choose a product.");
      return;
    }

    if (!draft.placement) {
      setFormError("Please choose a merchandising placement.");
      return;
    }

    const displayOrder = Number(draft.displayOrder);
    if (!Number.isFinite(displayOrder) || displayOrder < 0) {
      setFormError("Display order should be zero or more.");
      return;
    }

    setIsSaving(true);

    try {
      const result = await saveFlashySalesRecord({
        productId: draft.productId,
        placement: draft.placement,
        displayOrder,
        startsAt: draft.startsAt || null,
        endsAt: draft.endsAt || null,
      });

      if (!result.ok) {
        setFormError(result.message || "Unable to save the merchandising record.");
        return;
      }

      await refresh();
      setFormMessage("Merchandising record saved successfully.");
      closeModal();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="admin-products-page admin-flashy-page">
      <section className="admin-products-shell admin-flashy-shell">
        <header className="admin-products-header admin-flashy-header">
          <div>
            <p>Admin catalog</p>
            <h1>Flashy Sales and Best Selling Product</h1>
            <span>
              Manage the products that appear in the Flash Sales and Best Selling sections on the home page.
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
              onClick={openAddModal}
            >
              Add Flashy Product
            </button>
          </div>
        </header>

        <section className="admin-products-summary">
          <MetricCard
            title="Total Items"
            value={metrics.totalItems}
            note="All flashy sales and best selling items saved in the catalog."
          />
          <MetricCard
            title="Flashy Sales"
            value={metrics.flashyItems}
            note="Products shown in the Flash Sales section."
          />
          <MetricCard
            title="Best Selling"
            value={metrics.bestSellingItems}
            note="Products shown in the Best Selling section."
          />
          <MetricCard
            title="Average Rating"
            value={`${metrics.averageRating.toFixed(1)}/5`}
            note="Average rating across all saved items."
          />
        </section>

        <section className="admin-products-panel">
          <div className="admin-products-toolbar">
            <label className="admin-products-search" htmlFor="admin-flashy-search">
              <span>Search</span>
              <input
                id="admin-flashy-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search product name or group"
              />
            </label>

            <label className="admin-products-filter" htmlFor="admin-flashy-group">
              <span>Group</span>
              <select
                id="admin-flashy-group"
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
              >
                <option value="all">All</option>
                <option value="flashy">Flashy</option>
                <option value="best-selling">Best Selling</option>
              </select>
            </label>
          </div>

          {error ? <p className="admin-flashy-modal__error">{error}</p> : null}
          {formError ? <p className="admin-flashy-modal__error">{formError}</p> : null}
          {formMessage ? <p className="admin-flashy-modal__message">{formMessage}</p> : null}

          <div className="admin-products-table-wrap">
            <table className="admin-products-table admin-flashy-table">
              <thead>
                <tr>
                  <th>Product Image</th>
                  <th>Product Name</th>
                  <th>Group</th>
                  <th>Price</th>
                  <th>Rating</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && records.length === 0 ? (
                  <tr className="admin-products-empty-row">
                    <td colSpan="6">
                      <div className="admin-products-empty">
                        <h2>Loading merchandising records...</h2>
                        <p>We are syncing the home page rails from Supabase.</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredRows.length > 0 ? (
                  filteredRows.map((product) => (
                    <tr key={product.id} className="admin-products-row">
                      <td>
                        <div className="admin-products-table__image-wrap admin-flashy-table__image-wrap">
                          <ProductImage product={product} />
                        </div>
                      </td>
                      <td>
                        <strong>{product.name}</strong>
                        <small>{product.slug}</small>
                      </td>
                      <td>
                        <span className={`admin-flashy-group admin-flashy-group--${product.group}`}>
                          {normalizePlacementLabel(product.group)}
                        </span>
                      </td>
                      <td>{formatMoney(product.price)}</td>
                      <td>
                        <strong>{Number(product.rating || 0).toFixed(1)}</strong>
                      </td>
                      <td>
                        <div className="admin-products-actions">
                          <button
                            type="button"
                            className="admin-products-action admin-products-action--edit"
                            onClick={() => openEditModal(product)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="admin-products-action admin-products-action--delete"
                            onClick={() => handleDelete(product)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr className="admin-products-empty-row">
                    <td colSpan="6">
                      <div className="admin-products-empty">
                        <h2>No flashy sales found.</h2>
                        <p>
                          Add a product to the Flashy Sales or Best Selling group to have it appear on the home page.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {isModalOpen ? (
        <div className="admin-flashy-modal" role="dialog" aria-modal="true" aria-label="Flashy sales form">
          <button
            type="button"
            className="admin-flashy-modal__scrim"
            onClick={closeModal}
            aria-label="Close flashy sales form"
          />

          <aside className="admin-flashy-modal__panel">
            <header className="admin-flashy-modal__header">
              <div>
                <p>{editingRecord ? "Edit product" : "Add product"}</p>
                <h2>{selectedProduct?.name ?? editingRecord?.name ?? "New Flashy Sales Product"}</h2>
                <span>Saved changes update the home page Flash Sales and Best Selling sections.</span>
              </div>
            </header>

            <form className="admin-flashy-modal__form" onSubmit={handleSubmit}>
              <label className="admin-flashy-modal__field">
                <span>Product</span>
                <select
                  value={draft.productId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      productId: event.target.value,
                    }))
                  }
                  disabled={productsLoading && availableProducts.length === 0}
                >
                  <option value="">Choose a product</option>
                  {availableProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} - {product.slug}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-flashy-modal__field">
                <span>Placement</span>
                <select
                  value={draft.placement}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      placement: event.target.value,
                    }))
                  }
                >
                  <option value="flashy">Flashy Sales</option>
                  <option value="best-selling">Best Selling Product</option>
                </select>
              </label>

              <div className="admin-flashy-modal__grid">
                <label className="admin-flashy-modal__field">
                  <span>Display Order</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.displayOrder}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        displayOrder: event.target.value,
                      }))
                    }
                    placeholder="0"
                  />
                </label>

                <label className="admin-flashy-modal__field">
                  <span>Start Date</span>
                  <input
                    type="date"
                    value={draft.startsAt}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        startsAt: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <label className="admin-flashy-modal__field">
                <span>End Date</span>
                <input
                  type="date"
                  value={draft.endsAt}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      endsAt: event.target.value,
                    }))
                  }
                />
              </label>

              {selectedProduct ? (
                <div className="admin-flashy-modal__preview">
                  <img src={selectedProduct.image} alt={selectedProduct.name} />
                  <small>
                    {selectedProduct.name} - {formatMoney(selectedProduct.price)}
                  </small>
                </div>
              ) : null}

              {formError ? <p className="admin-flashy-modal__error">{formError}</p> : null}

              <div className="admin-flashy-modal__actions">
                <button
                  type="button"
                  className="admin-flashy-modal__button admin-flashy-modal__button--ghost"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-flashy-modal__button admin-flashy-modal__button--primary"
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

export default FlashySalesPage;
