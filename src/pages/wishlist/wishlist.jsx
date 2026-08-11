import WishlistGrid from "./WishlistGrid";

function Wishlist({
  wishlistItems = [],
  loading = false,
  error = "",
  onAddToCart = () => {},
  onToggleWishlist = () => {},
}) {
  return (
    <main className="wishlist-page">
      <div className="wishlist-page__shell">
        <section className="wishlist-page__intro">
          <div>
            <p className="wishlist-page__eyebrow">Saved for later</p>
            <h1>Wishlist</h1>
            <p className="wishlist-page__description">
              Keep track of the products you love, compare them later, and move
              them into your cart whenever you are ready.
            </p>
          </div>
        </section>

        <WishlistGrid
          wishlistItems={wishlistItems}
          loading={loading}
          error={error}
          onAddToCart={onAddToCart}
          onToggleWishlist={onToggleWishlist}
        />
      </div>
    </main>
  );
}

export default Wishlist;
