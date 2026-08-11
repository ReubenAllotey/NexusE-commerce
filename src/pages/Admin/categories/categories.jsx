import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import { useProducts } from "../../Products/productData";
import {
  createCategoryRecord,
  createSubcategoryRecord,
  deleteCategoryRecord,
  getCategoryMetrics,
  getCategoryProductCount,
  restoreCategoryRecord,
  setCategoryStatus,
  useCategoryRecords,
} from "../../../shared/categoryStorage";
import { getCategoryProductsPath } from "../../Home/catalogData";

function MetricCard({ title, value, note }) {
  return (
    <article className="admin-categories-metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function CategoryPill({ status }) {
  const tone = status === "deleted" ? "hidden" : status === "hidden" ? "hidden" : "active";

  return (
    <span className={`admin-categories-pill admin-categories-pill--${tone}`}>
      {status === "deleted" ? "Deleted" : tone === "hidden" ? "Hidden" : "Active"}
    </span>
  );
}

function getEmptyDraft() {
  return {
    name: "",
    description: "",
    parentId: "",
  };
}

function getRowState(record) {
  if (record.deletedAt) {
    return "deleted";
  }

  return String(record.status ?? "").toLowerCase() === "hidden" ? "hidden" : "active";
}

function CategoriesPage({ orders = [] }) {
  const session = loadAdminSession();
  const {
    records,
    loading,
    error,
    refresh,
  } = useCategoryRecords();
  const {
    products: liveProducts,
    loading: productsLoading,
    error: productsError,
  } = useProducts();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draft, setDraft] = useState(getEmptyDraft);
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const products = liveProducts;
  const categoryMetrics = useMemo(() => getCategoryMetrics(records), [records]);
  const recordIndex = useMemo(
    () => new Map(records.map((record) => [record.id, record])),
    [records],
  );
  const parentCategoryOptions = useMemo(
    () =>
      records
        .filter((record) => record.status === "active" && !record.deletedAt)
        .sort((left, right) =>
          (left.order ?? 0) - (right.order ?? 0) || left.name.localeCompare(right.name),
        ),
    [records],
  );
  const selectedParentId = draft.parentId || "";
  const selectedParent = selectedParentId ? recordIndex.get(selectedParentId) ?? null : null;
  const isSubcategory = Boolean(selectedParentId);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return records
      .filter((record) => {
        const rowState = getRowState(record);
        const parentName = record.parentId ? recordIndex.get(record.parentId)?.name ?? "" : "";
        const haystack =
          `${record.name} ${record.description ?? ""} ${record.slug ?? ""} ${parentName}`.toLowerCase();
        const matchesSearch = term.length === 0 || haystack.includes(term);
        const matchesStatus = statusFilter === "all" || rowState === statusFilter;

        return matchesSearch && matchesStatus;
      })
      .sort((left, right) => {
        const leftParent = left.parentId ? 1 : 0;
        const rightParent = right.parentId ? 1 : 0;

        return (
          leftParent - rightParent ||
          (left.order ?? 0) - (right.order ?? 0) ||
          left.name.localeCompare(right.name)
        );
      })
      .map((record) => ({
        ...record,
        rowState: getRowState(record),
        parentName: record.parentId
          ? recordIndex.get(record.parentId)?.name ?? "Parent removed"
          : "Main category",
        productCount: getCategoryProductCount(record, products),
      }));
  }, [products, recordIndex, records, searchTerm, statusFilter]);

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  const refreshRecords = async () => {
    await refresh({ forceRefresh: true });
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setDraft(getEmptyDraft());
    setFormError("");
  };

  const openCreateModal = () => {
    setDraft(getEmptyDraft());
    setFormError("");
    setStatusMessage("");
    setIsModalOpen(true);
  };

  const openSubcategoryModal = (record) => {
    setDraft({
      ...getEmptyDraft(),
      parentId: record.id,
    });
    setFormError("");
    setStatusMessage("");
    setIsModalOpen(true);
  };

  const handleDelete = async (record) => {
    if (record.deletedAt) {
      setStatusMessage("Category is already deleted.");
      return;
    }

    const confirmDelete = window.confirm(
      `Delete ${record.name}? This will hide the category from the storefront.`,
    );

    if (!confirmDelete) {
      return;
    }

    setIsSaving(true);
    setFormError("");
    setStatusMessage("");

    const result = await deleteCategoryRecord(record.id);

    setIsSaving(false);

    if (!result.ok) {
      setFormError(result.message ?? "Unable to delete the category.");
      return;
    }

    setStatusMessage("Category deleted successfully.");
    await refreshRecords();
  };

  const handleToggleVisibility = async (record) => {
    setIsSaving(true);
    setFormError("");
    setStatusMessage("");

    const result = record.deletedAt
      ? await restoreCategoryRecord(record.id)
      : await setCategoryStatus(
          record.id,
          record.status === "hidden" ? "active" : "hidden",
        );

    setIsSaving(false);

    if (!result.ok) {
      setFormError(result.message ?? "Unable to update the category.");
      return;
    }

    setStatusMessage(record.deletedAt ? "Category restored successfully." : "Category updated successfully.");
    await refreshRecords();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");
    setStatusMessage("");

    if (!draft.name.trim()) {
      setFormError("Please add a category name.");
      return;
    }

    setIsSaving(true);

    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      status: "active",
      showOnHomepage: false,
    };

    const result = selectedParentId
      ? await createSubcategoryRecord(selectedParentId, payload)
      : await createCategoryRecord(payload);

    setIsSaving(false);

    if (!result.ok) {
      setFormError(result.message ?? "Unable to save the category.");
      return;
    }

    setStatusMessage("Category saved successfully.");
    await refreshRecords();
    closeModal();
  };

  return (
    <main className="admin-categories-page">
      <section className="admin-categories-shell">
        <header className="admin-categories-header">
          <div>
            <p>Admin catalog</p>
            <h1>Categories</h1>
            <span>Manage storefront categories, add subcategories, and keep the product menu in sync.</span>
          </div>

          <div className="admin-categories-header__actions">
            <Link to="/admin/dashboard" className="admin-categories-header__button admin-categories-header__button--ghost">
              Back to dashboard
            </Link>
            <button
              type="button"
              className="admin-categories-header__button"
              onClick={openCreateModal}
              disabled={isSaving}
            >
              Add Category
            </button>
          </div>
        </header>

        <section className="admin-categories-summary">
          <MetricCard
            title="Total Categories"
            value={categoryMetrics.totalCategories}
            note="Top-level categories tracked on the storefront."
          />
          <MetricCard
            title="Active"
            value={categoryMetrics.activeCategories}
            note="Visible categories shown across the home page and menu."
          />
          <MetricCard
            title="Hidden"
            value={categoryMetrics.hiddenCategories}
            note="Disabled or deleted categories are kept for admin review."
          />
          <MetricCard
            title="Subcategories"
            value={categoryMetrics.subcategories}
            note="Child categories attached to a parent category."
          />
        </section>

        <section className="admin-categories-panel">
          <div className="admin-categories-toolbar">
            <label className="admin-categories-search" htmlFor="admin-categories-search">
              <span>Search by category name</span>
              <input
                id="admin-categories-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search categories..."
              />
            </label>

            <label className="admin-categories-filter" htmlFor="admin-categories-status">
              <span>Status</span>
              <select
                id="admin-categories-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="hidden">Hidden</option>
                <option value="deleted">Deleted</option>
              </select>
            </label>
          </div>

          {error ? <p className="admin-categories-modal__error">{error.message ?? error}</p> : null}
          {productsError ? <p className="admin-categories-modal__error">{productsError.message ?? productsError}</p> : null}
          {statusMessage ? <p className="admin-categories-modal__error">{statusMessage}</p> : null}
          {productsLoading && !loading ? <p className="admin-categories-modal__error">Loading product counts from Supabase...</p> : null}

          <div className="admin-categories-table-wrap">
            <table className="admin-categories-table">
              <thead>
                <tr>
                  <th>Categories</th>
                  <th>Parent</th>
                  <th>Products</th>
                  <th>Order</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && filteredRows.length === 0 ? (
                  <tr className="admin-categories-empty-row">
                    <td colSpan="5">
                      <div className="admin-categories-empty">
                        <h2>Loading categories...</h2>
                        <p>Please wait while the category list is loaded from Supabase.</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredRows.length > 0 ? (
                  filteredRows.map((record) => (
                    <tr key={record.id} className="admin-categories-row">
                      <td>
                        <div className="admin-categories-row__category">
                          <strong>{record.name}</strong>
                          <CategoryPill status={record.rowState} />
                          {record.description ? <small>{record.description}</small> : null}
                        </div>
                      </td>
                      <td>{record.parentName}</td>
                      <td>{record.productCount}</td>
                      <td>{record.order ?? 0}</td>
                      <td>
                        <div className="admin-categories-actions">
                          <Link
                            to={getCategoryProductsPath(record.slug)}
                            className="admin-categories-action admin-categories-action--view"
                          >
                            View
                          </Link>
                          <button
                            type="button"
                            className="admin-categories-action admin-categories-action--secondary"
                            onClick={() => openSubcategoryModal(record)}
                            disabled={isSaving}
                          >
                            Add Subcategory
                          </button>
                          <button
                            type="button"
                            className="admin-categories-action admin-categories-action--toggle"
                            onClick={() => handleToggleVisibility(record)}
                            disabled={isSaving}
                          >
                            {record.rowState === "deleted"
                              ? "Restore"
                              : record.rowState === "hidden"
                                ? "Display"
                                : "Disable"}
                          </button>
                          <button
                            type="button"
                            className="admin-categories-action admin-categories-action--danger"
                            onClick={() => handleDelete(record)}
                            disabled={isSaving || record.rowState === "deleted"}
                          >
                            {record.rowState === "deleted" ? "Deleted" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr className="admin-categories-empty-row">
                    <td colSpan="5">
                      <div className="admin-categories-empty">
                        <h2>No categories found.</h2>
                        <p>Try a different search term or status filter, or add a new category.</p>
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
        <div className="admin-categories-modal" role="dialog" aria-modal="true" aria-label="Category form">
          <button
            type="button"
            className="admin-categories-modal__scrim"
            onClick={closeModal}
            aria-label="Close category form"
          />

          <aside className="admin-categories-modal__panel">
            <header className="admin-categories-modal__header">
              <div>
                <p>{isSubcategory ? "Add subcategory" : "Add category"}</p>
                <h2>{isSubcategory ? `Under ${selectedParent?.name ?? "parent"}` : "New Category"}</h2>
                <span>Category changes are saved to the storefront category menu.</span>
              </div>
            </header>

            <form className="admin-categories-modal__form" onSubmit={handleSubmit}>
              <label className="admin-categories-modal__field">
                <span>Parent Category</span>
                <select
                  value={draft.parentId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      parentId: event.target.value,
                    }))
                  }
                >
                  <option value="">Main category</option>
                  {parentCategoryOptions.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.parentId
                        ? `${recordIndex.get(record.parentId)?.name ?? "Parent"} / ${record.name}`
                        : record.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-categories-modal__field">
                <span>Category Name</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Example: Accessories"
                />
              </label>

              <label className="admin-categories-modal__field">
                <span>Description</span>
                <textarea
                  rows="4"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Short category description"
                />
              </label>

              {formError ? <p className="admin-categories-modal__error">{formError}</p> : null}

              <div className="admin-categories-modal__actions">
                <button
                  type="button"
                  className="admin-categories-modal__button admin-categories-modal__button--ghost"
                  onClick={closeModal}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-categories-modal__button admin-categories-modal__button--primary"
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

export default CategoriesPage;

