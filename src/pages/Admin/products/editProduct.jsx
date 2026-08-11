import { Navigate, useNavigate, useParams } from "react-router-dom";
import ProductEditorForm from "./ProductEditorForm";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import {
  buildProductBundlePayloadFromEditorValues,
  saveProductBundle,
  useProductBySlug,
} from "../../Products/productData";

function EditProduct() {
  const navigate = useNavigate();
  const { productSlug } = useParams();
  const session = loadAdminSession();
  const { product, loading, message } = useProductBySlug(productSlug);

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

  const handleSubmit = async (values) => {
    const payload = buildProductBundlePayloadFromEditorValues(values, product);
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
          title={`Edit ${product.name}`}
          description={message || "Update the product details shown on the storefront and in the admin table."}
          submitLabel="Update product"
          initialProduct={product}
          onSubmit={handleSubmit}
          onCancel={() => navigate("/admin/products")}
        />
      </section>
    </main>
  );
}

export default EditProduct;
