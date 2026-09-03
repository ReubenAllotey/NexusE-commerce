import { Link, useNavigate } from "react-router-dom";
import {
  getShippingFee,
  isProductOutOfStock,
  resolveProductPrice,
  useProducts,
} from "../Products/productData";

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
  loading = false,
  error = "",
  onUpdateCartQuantity = () => {},
  onRemoveCartItem = () => {},
  onClearCart = () => {},
}) {
  const navigate = useNavigate();
  const {
    products,
    loading: productsLoading,
    error: productsError,
  } = useProducts();
  const productBySlug = new Map(products.map((product) => [product.slug, product]));
  const resolveCartProduct = (item) => {
    if (item?.name && item?.price && item?.image) {
      return item;
    }

    return item?.slug ? productBySlug.get(item.slug) ?? null : null;
  };

  const rows = cartItems
    .map((item) => {
      const product = resolveCartProduct(item);
      if (!product) return null;

      const quantity = item.quantity ?? 1;
      const shippingFee =
        typeof item.shippingFee === "number"
          ? item.shippingFee
          : getShippingFee(product);
      const effectiveShippingFee = typeof shippingFee === "number" ? shippingFee : 0;
      const lineSubtotal = resolveProductPrice(
        product,
        item.selectedOptions ?? item.selected_options ?? item.variant?.options ?? [],
      ) * quantity;
      const lineShipping = effectiveShippingFee * quantity;
      const outOfStock = isProductOutOfStock(product);

      return {
        key: item.cartKey ?? item.slug ?? product.slug ?? product.name,
        product,
        quantity,
        shippingFee,
        effectiveShippingFee,
        lineSubtotal,
        lineShipping,
        variant: item.variant ?? null,
        outOfStock,
      };
    })
    .filter(Boolean);
  const needsProductLookup = cartItems.some((item) => !item?.name || !item?.price || !item?.image);

  const itemCount = rows.reduce((sum, row) => sum + row.quantity, 0);
  const subtotal = rows.reduce((sum, row) => sum + row.lineSubtotal, 0);
  const shippingTotal = rows.reduce((sum, row) => sum + row.lineShipping, 0);
  const taxEstimate = 0;
  const totalPrice = subtotal + shippingTotal + taxEstimate;
  const hasOutOfStock = rows.some((row) => row.outOfStock);

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
    navigate("/shipping-address", {
      state: {
        cartRows: rows,
        totals: {
          subtotal,
          shippingTotal,
          taxEstimate,
          totalPrice,
        },
      },
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
                        <td>{formatMoney(product.price)}</td>
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
                          <button
                            type="button"
                            className="cart-remove"
                            onClick={() => onRemoveCartItem(key)}
                            aria-label={`Remove ${product.name} from cart`}
                          >
                            <TrashIcon />
                          </button>
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
                <span>Estimated Shipping</span>
                <strong>{formatMoney(shippingTotal)}</strong>
              </div>

              <div className="cart-summary__line">
                <span>Tax Estimate</span>
                <strong>{formatMoney(taxEstimate)}</strong>
              </div>

              <div className="cart-summary__total">
                <span>Total Price</span>
                <strong>{formatMoney(totalPrice)}</strong>
              </div>

              <div className="cart-summary__promo">
                <label htmlFor="promo-code">Promo Code</label>
                <div>
                  <input id="promo-code" type="text" placeholder="Enter code" />
                  <button type="button">Apply</button>
                </div>
              </div>

              <button
                type="button"
                className="cart-checkout"
                onClick={handleCheckout}
                disabled={hasOutOfStock}
              >
                {hasOutOfStock ? "Remove out-of-stock items" : "Proceed to Payment"}
              </button>

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
      </div>
    </main>
  );
}

export default Cart;
