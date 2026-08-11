import { Navigate, useNavigate } from "react-router-dom";
import ProductEditorForm from "./ProductEditorForm";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import {
  buildProductBundlePayloadFromEditorValues,
  saveProductBundle,
} from "../../Products/productData";

function AddProduct() {
  const navigate = useNavigate();
  const session = loadAdminSession();

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  const handleSubmit = async (values) => {
    const payload = buildProductBundlePayloadFromEditorValues(values);
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
          title="Add product"
          description="Create a new product record for the storefront and admin catalog."
          submitLabel="Save product"
          initialProduct={{}}
          onSubmit={handleSubmit}
          onCancel={() => navigate("/admin/products")}
        />
      </section>
    </main>
  );
}

export default AddProduct;
