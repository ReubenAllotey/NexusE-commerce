function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function getItemOptions(item = {}) {
  const selected = Array.isArray(item.selectedOptions ?? item.selected_options)
    ? (item.selectedOptions ?? item.selected_options)
    : [];
  if (selected.length > 0) {
    return selected
      .map((option) => ({
        group: String(option?.groupName ?? option?.group_name ?? option?.group ?? "Option").trim(),
        value: String(option?.label ?? option?.value ?? option?.optionValue ?? "").trim(),
      }))
      .filter((option) => option.group && option.value);
  }

  return [
    { group: "Color", value: String(item?.variant?.color ?? item?.selectedColor ?? item?.selected_color ?? "").trim() },
    { group: "Size", value: String(item?.variant?.size ?? item?.selectedSize ?? item?.selected_size ?? "").trim() },
  ].filter((option) => option.value);
}

function optionKey(options) {
  return options
    .map((option) => `${normalize(option.group)}=${normalize(option.value)}`)
    .sort()
    .join("|");
}

export function formatVariantDetails(options = [], quantity = null) {
  const safeOptions = Array.isArray(options) ? options : [];
  const label = safeOptions.length > 0
    ? safeOptions.map((option) => option.value).filter(Boolean).join(" / ") || "Base product"
    : "Base product";
  return quantity == null ? label : `${label} (${Math.max(Number(quantity) || 0, 0)})`;
}

export function aggregateBatchRows(orders = [], activeBatch = "") {
  const grouped = new Map();
  (Array.isArray(orders) ? orders : [])
    .filter((order) => String(order.batchNumber ?? order.batch_number ?? "").trim() === activeBatch)
    .forEach((order) => {
      (Array.isArray(order.items) ? order.items : []).forEach((item) => {
        const availabilityType = normalize(item.availabilityType ?? item.availability_type);
        if (availabilityType === "coming_soon") return;

        const options = getItemOptions(item);
        const productId = item.productId ?? item.product_id ?? item.slug ?? item.productSlug ?? item.product_slug ?? item.name;
        const key = [productId, optionKey(options), availabilityType].map(normalize).join("::");
        const quantity = Math.max(Math.round(Number(item.quantity) || 1), 1);
        const unitPrice = Number(item.price ?? item.unitPrice ?? item.unit_price) || 0;
        const lineSubtotal = Number(item.lineSubtotal ?? item.line_subtotal);
        const totalValue = Number.isFinite(lineSubtotal) && lineSubtotal >= 0 ? lineSubtotal : unitPrice * quantity;
        const current = grouped.get(key) ?? {
          key,
          name: item.name ?? item.productName ?? item.product_name ?? "Unnamed product",
          sku: item.sku || item.SKU || item.productSku || item.product_sku || item.slug || item.productSlug || item.product_slug || "",
          slug: item.slug || item.productSlug || item.product_slug || "",
          image: item.image || item.imageUrl || item.image_url || "",
          options,
          availabilityType: availabilityType || "ready_stock",
          quantity: 0,
          totalValue: 0,
          unitPrices: [],
          orders: [],
          contributions: [],
        };

        current.quantity += quantity;
        current.totalValue += totalValue;
        if (!current.unitPrices.some((value) => value === unitPrice)) current.unitPrices.push(unitPrice);
        if (!current.image && (item.image || item.imageUrl || item.image_url)) current.image = item.image || item.imageUrl || item.image_url;
        if (!current.sku && (item.sku || item.SKU || item.productSku || item.product_sku || item.slug || item.productSlug || item.product_slug)) {
          current.sku = item.sku || item.SKU || item.productSku || item.product_sku || item.slug || item.productSlug || item.product_slug;
        }
        if (!current.orders.some((entry) => entry.id === order.id)) current.orders.push(order);
        const contribution = current.contributions.find((entry) => entry.order.id === order.id);
        if (contribution) contribution.quantity += quantity;
        else current.contributions.push({ order, quantity });
        grouped.set(key, current);
      });
    });

  return [...grouped.values()]
    .map((row) => ({ ...row, unitPrice: row.unitPrices.length === 1 ? row.unitPrices[0] : null }))
    .sort((left, right) => left.name.localeCompare(right.name) || formatVariantDetails(left.options).localeCompare(formatVariantDetails(right.options)));
}
