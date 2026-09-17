import { useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read this image."));
    reader.readAsDataURL(file);
  });
}

function emptyDraft() {
  return {
    productName: "",
    shortDescription: "",
    description: "",
    categorySuggestion: { categoryId: null, categoryName: "" },
    tags: [],
    specifications: [],
    variationSuggestions: [],
    extractedFacts: [],
    missingInformation: [],
    warnings: [],
  };
}

function AiProductAssistant({ categories = [], onApply, onClose }) {
  const [supplierText, setSupplierText] = useState("");
  const [images, setImages] = useState([]);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleImages = async (event) => {
    const files = Array.from(event.target.files ?? []).slice(0, 4);
    if (files.length === 0) return;
    try {
      setImages(await Promise.all(files.map(readImage)));
      setError("");
    } catch (imageError) {
      setError(imageError.message || "Unable to read this image.");
    }
    event.target.value = "";
  };

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const analyze = async () => {
    if (!supplierText.trim() && images.length === 0) {
      setError("Add supplier information or at least one product image.");
      return;
    }

    setIsAnalyzing(true);
    setError("");
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data?.session?.access_token) {
        throw new Error("Please sign in again to use the AI assistant.");
      }
      const response = await fetch("/api/admin/ai/product-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({
          supplierText,
          images,
          categories: categories.map((category) => ({ id: category.id, name: category.name })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.draft) {
        throw new Error(payload?.message || "Unable to analyze this product. Please try again.");
      }
      setDraft(payload.draft);
    } catch (analysisError) {
      setError(analysisError.message || "Unable to analyze this product. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const applyDraft = () => {
    if (draft) onApply(draft);
  };

  return (
    <div className="ai-product-assistant__backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isAnalyzing) onClose();
    }}>
      <section className="ai-product-assistant" role="dialog" aria-modal="true" aria-labelledby="ai-product-title">
        <header className="ai-product-assistant__header">
          <div>
            <p>AI Product Assistant</p>
            <h2 id="ai-product-title">Turn supplier information into a draft</h2>
            <span>Review every suggestion before applying it to the normal product form.</span>
          </div>
          <button type="button" className="ai-product-assistant__close" onClick={onClose} disabled={isAnalyzing} aria-label="Close AI assistant">×</button>
        </header>

        {!draft ? (
          <div className="ai-product-assistant__input">
            <label>
              <span>Supplier information</span>
              <textarea value={supplierText} onChange={(event) => setSupplierText(event.target.value)} rows="7" placeholder="Paste information from WhatsApp, Alibaba, 1688, a catalog, or supplier notes..." />
            </label>
            <label>
              <span>Product images</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImages} />
              <small>{images.length ? `${images.length} image${images.length === 1 ? "" : "s"} ready for analysis.` : "Optional. Images are analyzed temporarily and are not saved until you use the normal form."}</small>
            </label>
            {error ? <p className="ai-product-assistant__error" role="alert">{error}</p> : null}
            <div className="ai-product-assistant__actions">
              <button type="button" className="admin-product-form__button admin-product-form__button--ghost" onClick={onClose} disabled={isAnalyzing}>Cancel</button>
              <button type="button" className="admin-product-form__button admin-product-form__button--primary" onClick={analyze} disabled={isAnalyzing}>{isAnalyzing ? "Analyzing..." : "Analyze Product"}</button>
            </div>
          </div>
        ) : (
          <div className="ai-product-assistant__review">
            <div className="ai-product-assistant__review-grid">
              <label><span>Product Name</span><input value={draft.productName} onChange={(event) => updateDraft("productName", event.target.value)} /></label>
              <label><span>Category Suggestion</span><select value={draft.categorySuggestion?.categoryId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, categorySuggestion: { ...current.categorySuggestion, categoryId: event.target.value || null } }))}><option value="">No category selected</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label><span>Short Description</span><textarea rows="3" value={draft.shortDescription} onChange={(event) => updateDraft("shortDescription", event.target.value)} /></label>
              <label><span>Full Description</span><textarea rows="5" value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} /></label>
            </div>
            <label><span>Tags</span><input value={draft.tags.join(", ")} onChange={(event) => updateDraft("tags", event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} /></label>
            <label><span>Suggested Specifications</span><textarea rows="4" value={draft.specifications.map((item) => `${item.name}: ${item.value}`).join("\n")} onChange={(event) => updateDraft("specifications", event.target.value.split(/\r?\n/).map((line) => { const [name, ...rest] = line.split(":"); return { name: name?.trim() ?? "", value: rest.join(":").trim() }; }).filter((item) => item.name && item.value))} /></label>
            <label><span>Suggested Variations</span><textarea rows="4" value={draft.variationSuggestions.map((group) => `${group.groupName}: ${group.options.join(", ")}`).join("\n")} readOnly /></label>
            <div className="ai-product-assistant__notice-grid">
              <div><strong>Missing Information</strong>{draft.missingInformation.length ? <ul>{draft.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No important gaps identified.</p>}</div>
              <div><strong>Extracted Facts</strong>{draft.extractedFacts.length ? <ul>{draft.extractedFacts.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No explicit facts returned.</p>}</div>
            </div>
            {error ? <p className="ai-product-assistant__error" role="alert">{error}</p> : null}
            <div className="ai-product-assistant__actions">
              <button type="button" className="admin-product-form__button admin-product-form__button--ghost" onClick={() => setDraft(null)}>Analyze Again</button>
              <button type="button" className="admin-product-form__button admin-product-form__button--primary" onClick={applyDraft}>Apply to Product Form</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default AiProductAssistant;
