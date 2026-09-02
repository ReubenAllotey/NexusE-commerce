import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import {
  getShippingFee,
  getProductPurchaseMeta,
  isProductOutOfStock,
  setProductDeletedAt,
  setProductStockStatus,
  restoreProductRecord,
  useProducts,
} from "../../Products/productData";
import {
  formatMoney,
  getBestSellingProducts,
} from "../adminHelpers";

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

  return (
    <img
      src={product.image}
      alt={product.name}
      className={product.imageClassName ?? ""}
    />
  );
}

function AdminProductsPage({ orders = [] }) {
  const session = loadAdminSession();
  const { products, loading: productsLoading, error: productsError, refresh } = useProducts({ includeDeleted: true });
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockConfirmProduct, setStockConfirmProduct] = useState(null);
  const [stockUpdatingId, setStockUpdatingId] = useState("");
  const [stockError, setStockError] = useState("");

  const categories = useMemo(
    () =>
      [...new Set(products.map((product) => product.category).filter(Boolean))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [products],
  );

  const bestSeller = useMemo(
    () => getBestSellingProducts(orders, products, 1)[0] ?? null,
    [orders, products],
  );

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return products.filter((product) => {
      const matchesSearch =
        term.length === 0 ||
        `${product.name} ${product.category} ${product.brand ?? ""}`.toLowerCase().includes(term);
      const matchesCategory =
        categoryFilter === "all" || product.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [categoryFilter, products, searchTerm]);

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }


  const handleDelete = async (product) => {
    const confirmDelete = window.confirm(
      `Delete ${product.name}? This will remove it from the storefront and admin table.`,
    );

    if (!confirmDelete) {
      return;
    }

    await setProductDeletedAt(product.id);
    await refresh();
  };

  const handleRestore = async (product) => {
    const confirmRestore = window.confirm(`Restore ${product.name} to the storefront?`);

    if (!confirmRestore) {
      return;
    }

    await restoreProductRecord(product.id);
    await refresh();
  };

  const handleStockUpdate = async (product) => {
    const nextStockStatus = isProductOutOfStock(product)
      ? "In Stock & Ready to Ship"
      : "Out of Stock";

    setStockUpdatingId(product.id);
    setStockError("");
    const result = await setProductStockStatus(product.id, nextStockStatus);
    setStockUpdatingId("");

    if (!result.ok) {
      setStockError(result.message || "Unable to update the product stock status.");
      return;
    }

    setStockConfirmProduct(null);
    await refresh();
  };

  return (
    <main className="admin-products-page">
      <section className="admin-products-shell">
        <header className="admin-products-header">
          <div>
            <p>Admin catalog</p>
            <h1>Products</h1>
            <span>Manage products, pricing, shipping, and storefront visibility from one place.</span>
          </div>

          <div className="admin-products-header__actions">
            <Link to="/admin/products/add" className="admin-products-header__button">
              Add Product
            </Link>
          </div>
        </header>

        {stockError && !stockConfirmProduct ? (
          <p className="admin-products-stock-error" role="alert">
            {stockError}
          </p>
        ) : null}

        <section className="admin-products-summary">
          <MetricCard
            title="Total Products"
            value={products.length}
            note="All catalog records, including soft-deleted items."
          />
          <MetricCard
            title="Best Selling Products"
            value={bestSeller ? bestSeller.name : "No sales yet"}
            note={
              bestSeller
                ? `${bestSeller.quantity} sold in recorded orders.`
                : "Once orders arrive, the top-selling item appears here."
            }
          />
        </section>

        <section className="admin-products-panel">
          <div className="admin-products-toolbar">
            <label className="admin-products-search" htmlFor="admin-products-search">
              <span>Search</span>
              <input
                id="admin-products-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search products, brands, or categories"
              />
            </label>

            <label className="admin-products-filter" htmlFor="admin-products-category">
              <span>Category</span>
              <select
                id="admin-products-category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="all">All Categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="admin-products-table-wrap">
            {productsLoading ? (
              <div className="admin-products-empty">
                <h2>Loading products...</h2>
                <p>We are pulling the live catalog from Supabase.</p>
              </div>
            ) : null}
            {productsError ? (
              <div className="admin-products-empty">
                <h2>Unable to load products.</h2>
                <p>{productsError.message || "Please try again in a moment."}</p>
              </div>
            ) : null}
            <table className="admin-products-table">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Product Name</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Availability</th>
                  <th>Shipping Fee</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length > 0 ? (
                  filteredProducts.map((product) => {
                    const shippingFee = getShippingFee(product);

                    return (
                      <tr key={product.slug} className="admin-products-row">
                        <td>
                          <div className="admin-products-table__image-wrap">
                            <ProductImage product={product} />
                          </div>
                        </td>
                        <td>
                          <strong>{product.name}</strong>
                          <small>{product.brand || "Unbranded"}</small>
                          {product.deletedAt ? (
                            <span className="admin-products-pill admin-products-pill--pending">Deleted</span>
                          ) : null}
                        </td>
                        <td>{product.category || "Uncategorized"}</td>
                        <td>{formatMoney(product.price)}</td>
                        <td>
                          <div className="admin-products-availability">
                            <span className={`admin-products-pill admin-products-pill--${getProductPurchaseMeta(product).tone}`}>
                              {getProductPurchaseMeta(product).label}
                            </span>
                            <span
                              className={`admin-products-pill admin-products-pill--stock${
                                isProductOutOfStock(product) ? " is-out" : ""
                              }`}
                            >
                              {isProductOutOfStock(product) ? "Out of Stock" : "In Stock"}
                            </span>
                          </div>
                        </td>
                        <td>
                          {shippingFee == null ? (
                            <span className="admin-products-pill admin-products-pill--pending">Pending</span>
                          ) : (
                            formatMoney(shippingFee)
                          )}
                        </td>
                        <td>
                          <div className="admin-products-actions">
                            {product.deletedAt ? (
                              <button
                                type="button"
                                className="admin-products-action admin-products-action--edit"
                                onClick={() => handleRestore(product)}
                              >
                                Restore
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={`admin-products-action admin-products-action--stock${
                                    isProductOutOfStock(product) ? " is-in-stock" : ""
                                  }`}
                                  disabled={stockUpdatingId === product.id}
                                  onClick={() => {
                                    setStockError("");
                                    if (isProductOutOfStock(product)) {
                                      void handleStockUpdate(product);
                                    } else {
                                      setStockConfirmProduct(product);
                                    }
                                  }}
                                >
                                  {stockUpdatingId === product.id
                                    ? "Updating..."
                                    : isProductOutOfStock(product)
                                      ? "In Stock"
                                      : "Out of Stock"}
                                </button>
                                <Link
                                  to={`/admin/products/${product.slug}/edit`}
                                  className="admin-products-action admin-products-action--edit"
                                >
                                  Edit
                                </Link>
                                <button
                                  type="button"
                                  className="admin-products-action admin-products-action--delete"
                                  onClick={() => handleDelete(product)}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr className="admin-products-empty-row">
                    <td colSpan="7">
                      <div className="admin-products-empty">
                        <h2>No products match your filters.</h2>
                        <p>Try a different search term or category, or add a new product to the catalog.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {stockConfirmProduct ? (
        <div className="admin-products-stock-modal" role="dialog" aria-modal="true" aria-labelledby="admin-products-stock-title">
          <button
            type="button"
            className="admin-products-stock-modal__scrim"
            aria-label="Close stock confirmation"
            onClick={() => setStockConfirmProduct(null)}
          />
          <section className="admin-products-stock-modal__panel">
            <p>Inventory update</p>
            <h2 id="admin-products-stock-title">Mark product out of stock?</h2>
            <span>
              {stockConfirmProduct.name} will remain visible but customers will not be able to add it to cart.
            </span>
            {stockError ? <strong className="admin-products-stock-modal__error">{stockError}</strong> : null}
            <div className="admin-products-stock-modal__actions">
              <button type="button" className="admin-products-action admin-products-action--edit" onClick={() => setStockConfirmProduct(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-products-action admin-products-action--stock"
                disabled={stockUpdatingId === stockConfirmProduct.id}
                onClick={() => void handleStockUpdate(stockConfirmProduct)}
              >
                {stockUpdatingId === stockConfirmProduct.id ? "Updating..." : "Mark Out of Stock"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default AdminProductsPage;

