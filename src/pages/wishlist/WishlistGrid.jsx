import { Link } from "react-router-dom";
import { getProductPath, useProducts } from "../Products/productData";

function formatMoney(value) {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(Number(value) || 0);
}

function WishlistGrid({
  wishlistItems = [],
  loading = false,
  error = "",
  onAddToCart = () => {},
  onToggleWishlist = () => {},
}) {
  const {
    products,
    loading: productsLoading,
    error: productsError,
  } = useProducts();
  const productByName = new Map(products.map((product) => [product.name, product]));

  const savedProducts = wishlistItems
    .map((itemName) => productByName.get(itemName))
    .filter(Boolean);

  if (loading) {
    return (
      <div className="wishlist-empty">
        <h3>Loading wishlist products...</h3>
        <p>We are syncing your saved wishlist from Supabase.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wishlist-empty">
        <h3>Unable to load wishlist products right now</h3>
        <p>{error || "Please try again in a moment."}</p>
      </div>
    );
  }

  if (productsError) {
    return (
      <div className="wishlist-empty">
        <h3>Unable to load wishlist products right now</h3>
        <p>{productsError.message || "Please try again in a moment."}</p>
      </div>
    );
  }

  if (productsLoading && wishlistItems.length > 0 && savedProducts.length === 0) {
    return (
      <div className="wishlist-empty">
        <h3>Loading wishlist products...</h3>
        <p>We are pulling the current catalog from Supabase.</p>
      </div>
    );
  }

  if (savedProducts.length === 0) {
    return (
      <div className="wishlist-empty">
        <h3>Your wishlist is empty</h3>
        <p>
          Save products you love, compare them later, and move them to your cart
          when you are ready.
        </p>
        <Link to="/products" className="wishlist-empty__button">
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <div className="wishlist-table-wrap">
      <table className="wishlist-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Price</th>
            <th>Quick Actions</th>
          </tr>
        </thead>
        <tbody>
          {savedProducts.map((product) => (
            <tr key={product.slug}>
              <td className="wishlist-table__product">
                <img
                  src={product.image}
                  alt={product.name}
                  className={product.imageClassName ?? ""}
                />
                <div>
                  <strong>{product.name}</strong>
                  <span>{product.brand}</span>
                </div>
              </td>
              <td className="wishlist-table__price">
                {formatMoney(product.price)}
              </td>
              <td>
                <div className="wishlist-table__actions">
                  <Link
                    to={getProductPath(product.slug)}
                    className="wishlist-action wishlist-action--details"
                  >
                    View details
                  </Link>
                  <button
                    type="button"
                    className="wishlist-action wishlist-action--cart"
                    onClick={() => onAddToCart(product.slug, 1)}
                  >
                    Add to cart
                  </button>
                  <button
                    type="button"
                    className="wishlist-action wishlist-action--remove"
                    onClick={() => onToggleWishlist(product.name)}
                  >
                    Remove
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default WishlistGrid;
