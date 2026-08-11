export function getCategoryProductsPath(categorySlug = "") {
  return categorySlug ? `/products?category=${categorySlug}` : "/products";
}
