import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import CartEditModal from "../../components/CartEditModal";
import ProductCard from "../Products/ProductCard";
import { isProductOutOfStock, useProducts } from "../Products/productData";
import {
  calculateShippingCheckoutSummary,
  canPayShippingNow,
  getDefaultShippingPaymentMode,
  resolveShippingLine,
  saveShippingPaymentPreference,
  SHIPPING_PAYMENT_MODES,
} from "../../shared/shippingCheckout";

function formatMoney(value) {
  const safeValue = Number(value) || 0;

  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    minimumFractionDigits: Number.isInteger(safeValue) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(safeValue) ? 0 : 2,
  }).format(safeValue);
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6v12M6 12h12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20.2a8.2 8.2 0 1 0 0-16.4 8.2 8.2 0 0 0 0 16.4Z" />
      <path d="M12 8.2v4.5" />
      <path d="M12 15.8h.01" />
    </svg>
  );
}

function Cart({
  cartItems = [],
  addresses = [],
  loading = false,
  error = "",
  onUpdateCartQuantity = () => {},
  onRemoveCartItem = () => {},
  onEditCartItem = async () => ({ ok: false }),
  onClearCart = () => {},
  onAddToCart = () => {},
}) {
  const [editingItem, setEditingItem] = useState(null);
  const [shippingPaymentPreference, setShippingPaymentPreference] = useState(SHIPPING_PAYMENT_MODES.PAY_LATER);
  const navigate = useNavigate();
  const {
    products,
    loading: productsLoading,
    error: productsError,
  } = useProducts();
  const productBySlug = new Map(products.map((product) => [product.slug, product]));
  const productById = new Map(products.map((product) => [String(product.id), product]));
  const resolveCartProduct = (item) => {
    const product =
      productById.get(String(item?.productId ?? item?.product_id ?? "")) ??
      productBySlug.get(String(item?.slug ?? "").trim().toLowerCase());

    if (product) {
      // Keep cart-only selection/quantity data, but let current product fields
      // such as shipping status and fee remain authoritative.
      return {
        ...item,
        ...product,
        cartKey: item.cartKey,
        quantity: item.quantity,
        selectedOptions: item.selectedOptions ?? item.selected_options,
        variationGroups: product.variationGroups ?? [],
      };
    }

    return item?.name && item?.price != null && item?.image ? item : null;
  };

  const rows = cartItems
    .map((item) => {
      const product = resolveCartProduct(item);
      if (!product) return null;

      const shippingLine = resolveShippingLine(product, item);
      const quantity = shippingLine.quantity;
      const shippingFee = shippingLine.shippingFee;
      const effectiveShippingFee = shippingLine.lineShipping / quantity;
      const lineSubtotal = shippingLine.lineSubtotal;
      const lineShipping = shippingLine.lineShipping;
      const outOfStock = isProductOutOfStock(product);

      return {
        key: item.cartKey ?? item.slug ?? product.slug ?? product.name,
        product,
        quantity,
        shippingFee,
        effectiveShippingFee,
        lineSubtotal,
        lineShipping,
        shippingFeeStatus: shippingLine.shippingFeeStatus,
        hasPendingShipping: shippingLine.hasPendingShipping,
        variant: item.variant ?? null,
        item,
        outOfStock,
      };
    })
    .filter(Boolean);
  const needsProductLookup = cartItems.some((item) => !item?.name || !item?.price || !item?.image);

  const itemCount = rows.reduce((sum, row) => sum + row.quantity, 0);
  const baseSummary = calculateShippingCheckoutSummary(rows, SHIPPING_PAYMENT_MODES.PAY_LATER);
  const summary = calculateShippingCheckoutSummary(rows, shippingPaymentPreference);
  const subtotal = summary.productSubtotal;
  const shippingTotal = summary.knownShippingTotal;
  const taxEstimate = 0;
  const totalPrice = summary.amountPayableNow + taxEstimate;
  const hasOutOfStock = rows.some((row) => row.outOfStock);
  const savedLocation = (Array.isArray(addresses) ? addresses : []).find((address) => address.isDefault)
    ?? (Array.isArray(addresses) ? addresses[0] : null);
  const cartProductIds = rows.map((row) => String(row.product.id ?? row.product.slug));
  const recommendationProducts = useMemo(() => {
    const eligibleProducts = products.filter(
      (product) => !cartProductIds.includes(String(product.id ?? product.slug)),
    );

    return [...eligibleProducts]
      .sort(() => Math.random() - 0.5)
      .slice(0, 6);
  }, [products, cartItems.map((item) => item.productId ?? item.product_id ?? item.slug).join("|")]);

  useEffect(() => {
    const defaultMode = getDefaultShippingPaymentMode(baseSummary);
    setShippingPaymentPreference((current) => {
      if (current === SHIPPING_PAYMENT_MODES.PAY_NOW && !canPayShippingNow(baseSummary)) {
        return defaultMode;
      }
      return current === SHIPPING_PAYMENT_MODES.PAY_NOW || current === SHIPPING_PAYMENT_MODES.PAY_LATER
        ? current
        : defaultMode;
    });
  }, [baseSummary.knownShippingTotal, baseSummary.hasPendingShipping]);

  if (loading) {
    return (
      <main className="cart-page">
        <div className="cart-shell">
          <div className="shop-empty">
            <h2>Loading cart...</h2>
            <p>We are syncing your saved cart from Supabase.</p>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="cart-page">
        <div className="cart-shell">
          <div className="shop-empty">
            <h2>Unable to load cart right now.</h2>
            <p>{error || "Please try again in a moment."}</p>
          </div>
        </div>
      </main>
    );
  }

  if (productsError) {
    return (
      <main className="cart-page">
        <div className="cart-shell">
          <div className="shop-empty">
            <h2>Unable to load products right now.</h2>
            <p>{productsError.message || "Please try again in a moment."}</p>
          </div>
        </div>
      </main>
    );
  }

  if (productsLoading && needsProductLookup) {
    return (
      <main className="cart-page">
        <div className="cart-shell">
          <div className="shop-empty">
            <h2>Loading cart products...</h2>
            <p>We are resolving the saved cart items from Supabase.</p>
          </div>
        </div>
      </main>
    );
  }

  const updateQuantity = (slug, nextQuantity) => {
    if (nextQuantity <= 0) {
      onRemoveCartItem(slug);
      return;
    }

    onUpdateCartQuantity(slug, nextQuantity);
  };

  const handleCheckout = () => {
    const checkoutState = {
      cartRows: rows,
      totals: {
        subtotal,
        shippingTotal,
        knownCommercialTotal: summary.knownCommercialTotal,
        amountPayableNow: summary.amountPayableNow,
        shippingDueLater: summary.shippingDueLater,
        taxEstimate,
        totalPrice,
      },
      shippingPaymentPreference,
    };

    if (savedLocation) {
      navigate("/payment", { state: { ...checkoutState, shippingAddress: savedLocation } });
      return;
    }

    navigate("/shipping-address", {
      state: checkoutState,
    });
  };

  return (
    <main className="cart-page">
      <div className="cart-shell">
        <nav className="cart-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">&rsaquo;</span>
          <span aria-current="page">Shopping Cart</span>
        </nav>

        <div className="cart-header">
          <h1>Shopping Cart</h1>
          <span>({itemCount} Items)</span>
        </div>

        {rows.length > 0 ? (
          <section className="cart-layout">
            <div className="cart-table-wrap">
              <table className="cart-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Price</th>
                    <th>Quantity</th>
                    <th>Shipping Fee</th>
                    <th>Subtotal</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(
                    ({
                      key,
                      product,
                      quantity,
                      shippingFee,
                      effectiveShippingFee,
                      lineSubtotal,
                      variant,
                      item,
                      outOfStock,
                    }) => (
                      <tr key={key}>
                        <td className="cart-table__product">
                          <img src={product.image} alt={product.name} />
                          <div>
                            <strong>{product.name}</strong>
                            <span>{product.brand}</span>
                            {variant?.label || variant?.color || variant?.size ? (
                              <span>
                                {variant.label || [variant.color, variant.size].filter(Boolean).join(" / ")}
                              </span>
                            ) : null}
                            {outOfStock ? (
                              <span className="cart-table__out-of-stock">
                                OUT OF STOCK. Remove it before checkout.
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>{formatMoney(lineSubtotal / Math.max(quantity, 1))}</td>
                        <td>
                          <div className="cart-qty">
                            <button
                              type="button"
                              onClick={() => updateQuantity(key, quantity - 1)}
                              aria-label={`Decrease quantity for ${product.name}`}
                              disabled={quantity === 1}
                            >
                              <MinusIcon />
                            </button>
                            <strong>{quantity}</strong>
                            <button
                              type="button"
                              onClick={() => updateQuantity(key, quantity + 1)}
                              aria-label={`Increase quantity for ${product.name}`}
                            >
                              <PlusIcon />
                            </button>
                          </div>
                        </td>
                        <td>{shippingFee == null ? "Pending" : formatMoney(effectiveShippingFee)}</td>
                        <td>{formatMoney(lineSubtotal)}</td>
                        <td>
                          <div className="cart-table__actions">
                            <button type="button" className="cart-edit" onClick={() => setEditingItem({ item, product })}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="cart-remove"
                              onClick={() => onRemoveCartItem(key)}
                              aria-label={`Remove ${product.name} from cart`}
                            >
                              <TrashIcon />
                              <span>Remove</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>

              <div className="cart-actions">
                <Link to="/products" className="cart-link">
                  Continue Shopping
                </Link>
                <button
                  type="button"
                  className="cart-clear"
                  onClick={onClearCart}
                >
                  Clear Cart
                </button>
              </div>
            </div>

            <aside className="cart-summary">
              <h2>Order Summary</h2>

              <div className="cart-summary__line">
                <span>Subtotal</span>
                <strong>{formatMoney(subtotal)}</strong>
              </div>

              <div className="cart-summary__line">
                <span>Known Shipping</span>
                <strong>{shippingTotal > 0 ? formatMoney(shippingTotal) : summary.hasPendingShipping ? "Calculated later" : "Free"}</strong>
              </div>

              {summary.hasPendingShipping ? (
                <div className="cart-summary__line">
                  <span>Pending Shipping</span>
                  <strong>Calculated later</strong>
                </div>
              ) : null}

              <div className="cart-summary__line">
                <span>Tax Estimate</span>
                <strong>{formatMoney(taxEstimate)}</strong>
              </div>

              <div className="cart-summary__total">
                <span>Total Order Value</span>
                <strong>{formatMoney(summary.knownCommercialTotal)}</strong>
              </div>

              {!summary.hasOnlyFreeShipping ? (
                <fieldset className="cart-shipping-choice">
                  <legend>Shipping payment</legend>
                  <label className={`cart-shipping-choice__option${shippingPaymentPreference === SHIPPING_PAYMENT_MODES.PAY_NOW ? " is-selected" : ""}${!canPayShippingNow(baseSummary) ? " is-disabled" : ""}`}>
                    <input
                      type="radio"
                      name="shipping-payment-preference"
                      value={SHIPPING_PAYMENT_MODES.PAY_NOW}
                      checked={shippingPaymentPreference === SHIPPING_PAYMENT_MODES.PAY_NOW}
                      disabled={!canPayShippingNow(baseSummary)}
                      onChange={() => {
                        setShippingPaymentPreference(SHIPPING_PAYMENT_MODES.PAY_NOW);
                        saveShippingPaymentPreference(SHIPPING_PAYMENT_MODES.PAY_NOW);
                      }}
                    />
                    <span>
                      <strong>Pay with Shipping Fee</strong>
                      <small>Pay all currently available shipping fees together with your items.</small>
                    </span>
                  </label>
                  <label className={`cart-shipping-choice__option${shippingPaymentPreference === SHIPPING_PAYMENT_MODES.PAY_LATER ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name="shipping-payment-preference"
                      value={SHIPPING_PAYMENT_MODES.PAY_LATER}
                      checked={shippingPaymentPreference === SHIPPING_PAYMENT_MODES.PAY_LATER}
                      onChange={() => {
                        setShippingPaymentPreference(SHIPPING_PAYMENT_MODES.PAY_LATER);
                        saveShippingPaymentPreference(SHIPPING_PAYMENT_MODES.PAY_LATER);
                      }}
                    />
                    <span>
                      <strong>Pay Shipping Fee Later</strong>
                      <small>Pay for your items now and settle shipping fees later.</small>
                    </span>
                  </label>
                  {baseSummary.hasPendingShipping && !canPayShippingNow(baseSummary) ? (
                    <p className="cart-shipping-choice__note">Shipping fee is not available yet and will be paid later.</p>
                  ) : null}
                </fieldset>
              ) : null}

              <div className="cart-summary__line cart-summary__line--payable">
                <span>Pay Now</span>
                <strong>{formatMoney(summary.amountPayableNow)}</strong>
              </div>
              {summary.shippingDueLater > 0 ? (
                <div className="cart-summary__line">
                  <span>Shipping Due Later</span>
                  <strong>{formatMoney(summary.shippingDueLater)}</strong>
                </div>
              ) : null}

              <button
                type="button"
                className="cart-checkout"
                onClick={handleCheckout}
                disabled={hasOutOfStock}
              >
                {hasOutOfStock ? "Remove out-of-stock items" : "Proceed to Checkout"}
              </button>

              <section className={`cart-location-card${savedLocation ? " is-saved" : ""}`}>
                <div>
                  <p className="cart-location-card__eyebrow">Delivery location</p>
                  <h3>{savedLocation ? "Ready for delivery" : "Add a delivery location"}</h3>
                  <p>
                    {savedLocation
                      ? [savedLocation.region, savedLocation.deliveryLocation || savedLocation.city, savedLocation.landmark].filter(Boolean).join(" · ")
                      : "Choose where your order should be delivered before checkout."}
                  </p>
                </div>
                <button
                  type="button"
                  className="cart-location-card__action"
                  onClick={() => navigate("/shipping-address", { state: { cartRows: rows, shippingPaymentPreference } })}
                >
                  {savedLocation ? "Change" : "Add location"}
                </button>
              </section>

              {hasOutOfStock ? (
                <p className="cart-summary__stock-warning">
                  This item is currently out of stock. Remove it from your cart before continuing.
                </p>
              ) : null}

              <ul className="cart-summary__notes" aria-label="Checkout notes">
                <li className="cart-summary__note">
                  <span className="cart-summary__note-icon" aria-hidden="true">
                    <NoteIcon />
                  </span>
                  <span>
                    Shipping is calculated per item so you can see the cost before checkout.
                  </span>
                </li>
                <li className="cart-summary__note">
                  <span className="cart-summary__note-icon" aria-hidden="true">
                    <NoteIcon />
                  </span>
                  <span>
                    Items with shipping fees marked as pending will be updated and the customer
                    will be notified after purchase.
                  </span>
                </li>
              </ul>
            </aside>
          </section>
        ) : (
          <section className="cart-empty">
            <h2>Your cart is empty.</h2>
            <p>Browse products and add something you like.</p>
            <Link to="/products" className="cart-empty__button">
              Start Shopping
            </Link>
          </section>
        )}

        {rows.length > 0 && recommendationProducts.length > 0 ? (
          <section className="cart-recommendations" aria-labelledby="cart-recommendations-title">
            <div className="cart-recommendations__header">
              <div>
                <p>Keep browsing</p>
                <h2 id="cart-recommendations-title">You may also like</h2>
              </div>
              <Link to="/products">View all products</Link>
            </div>
            <div className="cart-recommendations__grid">
              {recommendationProducts.map((product) => (
                <ProductCard key={product.id ?? product.slug} item={product} onAddToCart={onAddToCart} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
      {editingItem ? (
        <CartEditModal
          item={editingItem.item}
          product={editingItem.product}
          onClose={() => setEditingItem(null)}
          onUpdate={onEditCartItem}
        />
      ) : null}
    </main>
  );
}

export default Cart;
