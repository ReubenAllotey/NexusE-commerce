import { Navigate, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ProductEditorForm from "./ProductEditorForm";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import {
  buildProductBundlePayloadFromEditorValues,
  saveProductBundle,
  useProductBySlug,
} from "../../Products/productData";
import { supabase } from "../../../lib/supabaseClient";

function EditProduct() {
  const navigate = useNavigate();
  const { productSlug } = useParams();
  const session = loadAdminSession();
  const { product, loading, message } = useProductBySlug(productSlug);
  const [editorProduct, setEditorProduct] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!product) {
      setEditorProduct(null);
      return undefined;
    }
    const loadPricing = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}/pricing`, {
          headers: data?.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {},
        });
        const payload = await response.json().catch(() => ({}));
        const pricing = payload?.pricing;
        if (!cancelled && pricing?.pricing_currency === "CNY") {
          setEditorProduct({
            ...product,
            pricingCurrency: "CNY",
            originalCnyPrice: pricing.original_cny_price,
            originalCnyCompareAt: pricing.original_cny_compare_at,
            appliedExchangeRate: pricing.applied_exchange_rate,
          });
          return;
        }
        if (!cancelled) setEditorProduct(product);
      } catch {
        if (!cancelled) setEditorProduct(product);
      }
    };
    loadPricing();
    return () => { cancelled = true; };
  }, [product]);

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  if (loading) {
    return (
      <main className="admin-product-page">
        <section className="admin-product-shell">
          <div className="admin-product-form__header">
            <div>
              <p>Product editor</p>
              <h2>Loading product...</h2>
              <span>Please wait while we load the latest product data from Supabase.</span>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!product) {
    return <Navigate to="/admin/products" replace />;
  }

  if (!editorProduct) {
    return (
      <main className="admin-product-page">
        <section className="admin-product-shell"><p>Loading private pricing metadata...</p></section>
      </main>
    );
  }

  const handleSubmit = async (values) => {
    const payload = buildProductBundlePayloadFromEditorValues(values, editorProduct);
    const result = await saveProductBundle(payload);

    if (result?.ok === false) {
      return result;
    }

    navigate("/admin/products", { replace: true });
    return result;
  };

  return (
    <main className="admin-product-page">
      <section className="admin-product-shell">
        <ProductEditorForm
          title={`Edit ${editorProduct.name}`}
          description={message || "Update the product details shown on the storefront and in the admin table."}
          submitLabel="Update product"
          initialProduct={editorProduct}
          onSubmit={handleSubmit}
          onCancel={() => navigate("/admin/products")}
        />
      </section>
    </main>
  );
}

export default EditProduct;
