import ProfileSectionShell from "./ProfileSectionShell";
import WishlistGrid from "../wishlist/WishlistGrid";

function Wishlist({
  wishlistItems = [],
  onAddToCart = () => {},
  onToggleWishlist = () => {},
}) {
  return (
    <ProfileSectionShell
      title="Wishlist"
      description={null}
    >
      <WishlistGrid
        wishlistItems={wishlistItems}
        onAddToCart={onAddToCart}
        onToggleWishlist={onToggleWishlist}
      />
    </ProfileSectionShell>
  );
}

export default Wishlist;
