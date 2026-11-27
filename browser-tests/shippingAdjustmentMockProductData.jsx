import React from "react";

export function useProducts() {
  return { products: [
    { id: "synthetic-product-1", name: "Synthetic Shipping Product", slug: "synthetic-shipping-product", shippingFee: 100 },
    { id: "synthetic-product-2", name: "Second Product", slug: "second-product", shippingFee: 50 },
  ], loading: false, refresh: async () => ({ ok: true }) };
}
