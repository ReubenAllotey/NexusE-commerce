import { supabase } from "../lib/supabaseClient";

const GUEST_CART_KEY = "nexus-guest-cart";
const GUEST_WISHLIST_KEY = "nexus-guest-wishlist";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeQuantity(value) {
  return Math.max(Math.round(normalizeNumber(value, 0)), 1);
}

function readSessionJson(key, fallback) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const value = window.sessionStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeSessionJson(key, value) {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  }
}

function removeSessionItem(key) {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(key);
  }
}

function getProductLookup(products = []) {
  const byId = new Map();
  const bySlug = new Map();
  const byName = new Map();

  for (const product of Array.isArray(products) ? products : []) {
    if (product?.id) {
      byId.set(String(product.id), product);
    }

    if (product?.slug) {
      bySlug.set(clean(product.slug).toLowerCase(), product);
    }

    if (product?.name) {
      byName.set(clean(product.name).toLowerCase(), product);
    }
  }

  return { byId, bySlug, byName };
}

function getProductByRef(ref = {}, products = []) {
  const lookups = getProductLookup(products);
  const refId = clean(ref?.productId ?? ref?.product_id);
  const refSlug = clean(ref?.slug).toLowerCase();
  const refName = clean(ref?.name).toLowerCase();

  return (
    (refId ? lookups.byId.get(refId) : null) ??
    (refSlug ? lookups.bySlug.get(refSlug) : null) ??
    (refName ? lookups.byName.get(refName) : null) ??
    null
  );
}

function normalizeOptionalText(value) {
  const text = clean(value);
  return text || null;
}

function normalizeSelectedOptions(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((option) => {
      if (!option || typeof option !== "object") {
        return null;
      }

      const groupName = clean(option.groupName ?? option.group_name);
      const label = clean(option.label ?? option.value ?? option.optionLabel ?? option.option_label);
      const valueText = clean(option.value ?? option.optionValue ?? option.option_value) || label;

      if (!groupName || !label) {
        return null;
      }

      return {
        groupId: clean(option.groupId ?? option.group_id) || null,
        groupName,
        kind: clean(option.kind) || "text",
        optionId: clean(option.optionId ?? option.option_id) || null,
        label,
        value: valueText,
        priceDelta: normalizeNumber(option.priceDelta ?? option.price_delta, 0),
        compareAtDelta:
          option.compareAtDelta == null
            ? option.compare_at_delta == null
              ? null
              : normalizeNumber(option.compare_at_delta, 0)
            : normalizeNumber(option.compareAtDelta, 0),
        swatchColor: normalizeOptionalText(option.swatchColor ?? option.swatch_color),
        imageUrl: normalizeOptionalText(option.imageUrl ?? option.image_url),
        isDefault: Boolean(option.isDefault ?? option.is_default),
      };
    })
    .filter(Boolean);
}

function buildVariantKeyFromSelection({
  slug = "",
  selectedColor = "",
  selectedSize = "",
  selectedOptions = [],
  variantKey = "",
} = {}) {
  const customVariantKey = clean(variantKey);

  if (customVariantKey) {
    return customVariantKey;
  }

  const normalizedOptions = normalizeSelectedOptions(selectedOptions);

  if (normalizedOptions.length > 0) {
    return normalizedOptions
      .map((option) => `${clean(option.groupName || option.groupId || "option").toLowerCase()}=${clean(option.label || option.value || option.optionId).toLowerCase()}`)
      .join("::");
  }

  return [clean(slug), clean(selectedColor), clean(selectedSize)].filter(Boolean).join("::") || clean(slug);
}

function buildVariantLabelFromSelection({
  selectedOptions = [],
  selectedColor = "",
  selectedSize = "",
} = {}) {
  const normalizedOptions = normalizeSelectedOptions(selectedOptions);

  if (normalizedOptions.length > 0) {
    return normalizedOptions.map((option) => option.label).filter(Boolean).join(" / ");
  }

  return [clean(selectedColor), clean(selectedSize)].filter(Boolean).join(" / ");
}

function buildCartLineKey(slug = "", selectedColor = "", selectedSize = "", selectedOptions = [], variantKey = "") {
  if (slug && typeof slug === "object" && !Array.isArray(slug)) {
    return buildVariantKeyFromSelection(slug);
  }

  return buildVariantKeyFromSelection({
    slug,
    selectedColor,
    selectedSize,
    selectedOptions,
    variantKey,
  });
}

function normalizeGuestCartItem(item = {}) {
  const productId = clean(item.productId ?? item.product_id);
  const slug = clean(item.slug).toLowerCase();
  const quantity = normalizeQuantity(item.quantity);
  const selectedColor = normalizeOptionalText(item.selectedColor ?? item.selected_color);
  const selectedSize = normalizeOptionalText(item.selectedSize ?? item.selected_size);
  const selectedOptions = normalizeSelectedOptions(item.selectedOptions ?? item.selected_options);
  const variantKey = buildVariantKeyFromSelection({
    slug: slug || productId,
    selectedColor,
    selectedSize,
    selectedOptions,
    variantKey: item.variantKey ?? item.variant_key,
  });

  if (!productId && !slug) {
    return null;
  }

  return {
    productId: productId || null,
    slug: slug || null,
    quantity,
    selectedColor,
    selectedSize,
    selectedOptions,
    variantKey,
    cartKey: buildCartLineKey(slug || productId, selectedColor ?? "", selectedSize ?? "", selectedOptions, variantKey),
  };
}

function normalizeGuestWishlistItem(item = {}) {
  const productId = clean(item.productId ?? item.product_id);
  const slug = clean(item.slug).toLowerCase();
  const name = clean(item.name);

  if (!productId && !slug && !name) {
    return null;
  }

  return {
    productId: productId || null,
    slug: slug || null,
    name: name || null,
  };
}

function dedupeGuestCartItems(items = []) {
  const seen = new Map();

  for (const item of items) {
    const normalized = normalizeGuestCartItem(item);
    if (!normalized) {
      continue;
    }

    const key = normalized.cartKey;
    const existing = seen.get(key);
    if (existing) {
      existing.quantity += normalized.quantity;
      continue;
    }

    seen.set(key, { ...normalized });
  }

  return [...seen.values()].sort((left, right) => left.cartKey.localeCompare(right.cartKey));
}

function dedupeGuestWishlistItems(items = []) {
  const seen = new Map();

  for (const item of items) {
    const normalized = normalizeGuestWishlistItem(item);
    if (!normalized) {
      continue;
    }

    const key = normalized.productId || normalized.slug || normalized.name;
    if (!key || seen.has(key)) {
      continue;
    }

    seen.set(key, { ...normalized });
  }

  return [...seen.values()];
}

function loadGuestCartDraft() {
  const items = readSessionJson(GUEST_CART_KEY, []);
  return Array.isArray(items) ? dedupeGuestCartItems(items) : [];
}

function saveGuestCartDraft(items = []) {
  writeSessionJson(GUEST_CART_KEY, dedupeGuestCartItems(items));
}

function clearGuestCartDraft() {
  removeSessionItem(GUEST_CART_KEY);
}

function loadGuestWishlistDraft() {
  const items = readSessionJson(GUEST_WISHLIST_KEY, []);
  return Array.isArray(items) ? dedupeGuestWishlistItems(items) : [];
}

function saveGuestWishlistDraft(items = []) {
  writeSessionJson(GUEST_WISHLIST_KEY, dedupeGuestWishlistItems(items));
}

function clearGuestWishlistDraft() {
  removeSessionItem(GUEST_WISHLIST_KEY);
}

async function getSignedInUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return { ok: false, message: error.message || "Unable to resolve the signed-in user." };
  }

  if (!data?.user) {
    return { ok: false, message: "Please sign in to sync your cart and wishlist." };
  }

  return { ok: true, user: data.user };
}

async function ensureCartRow(userId) {
  const { data, error } = await supabase
    .from("carts")
    .upsert({ user_id: userId }, { onConflict: "user_id" })
    .select("id, user_id, created_at, updated_at")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function ensureWishlistRow(userId) {
  const { data, error } = await supabase
    .from("wishlists")
    .upsert({ user_id: userId }, { onConflict: "user_id" })
    .select("id, user_id, created_at, updated_at")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function loadRemoteCartRows(userId) {
  const { data: cart, error: cartError } = await supabase
    .from("carts")
    .select("id, user_id, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (cartError) {
    throw cartError;
  }

  if (!cart) {
    return [];
  }

  const { data, error } = await supabase
    .from("cart_items")
    .select("id, cart_id, product_id, quantity, selected_color, selected_size, variant_key, selected_options, created_at, updated_at")
    .eq("cart_id", cart.id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

async function loadRemoteWishlistRows(userId) {
  const { data: wishlist, error: wishlistError } = await supabase
    .from("wishlists")
    .select("id, user_id, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (wishlistError) {
    throw wishlistError;
  }

  if (!wishlist) {
    return [];
  }

  const { data, error } = await supabase
    .from("wishlist_items")
    .select("id, wishlist_id, product_id, created_at")
    .eq("wishlist_id", wishlist.id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

function mapCartRowsToItems(rows = [], products = []) {
  return rows
    .map((row) => {
      const product = getProductByRef(row, products);

      if (!product) {
        return null;
      }

      const selectedColor = normalizeOptionalText(row.selectedColor ?? row.selected_color);
      const selectedSize = normalizeOptionalText(row.selectedSize ?? row.selected_size);
      const selectedOptions = normalizeSelectedOptions(row.selectedOptions ?? row.selected_options);
      const variantKey = buildVariantKeyFromSelection({
        slug: product.slug ?? product.id,
        selectedColor,
        selectedSize,
        selectedOptions,
        variantKey: row.variantKey ?? row.variant_key,
      });
      const quantity = normalizeQuantity(row.quantity);
      const productId = clean(row.productId ?? row.product_id ?? product.id);
      const cartKey = buildCartLineKey(
        product.slug ?? product.id,
        selectedColor ?? "",
        selectedSize ?? "",
        selectedOptions,
        variantKey,
      );
      const variantLabel = buildVariantLabelFromSelection({
        selectedOptions,
        selectedColor,
        selectedSize,
      });

      return {
        id: row.id,
        cartId: row.cartId ?? row.cart_id ?? "",
        productId,
        slug: product.slug ?? "",
        name: product.name ?? "Unnamed product",
        brand: product.brand ?? "",
        price: Number(product.price) || 0,
        image: product.image ?? "",
        imageClassName: product.imageClassName ?? "",
        shippingFee: product.shippingFee ?? null,
        quantity,
        selectedColor,
        selectedSize,
        selectedOptions,
        variantKey,
        cartKey,
        variant: {
          color: selectedColor ?? "",
          size: selectedSize ?? "",
          label: variantLabel,
          options: selectedOptions,
        },
      };
    })
    .filter(Boolean);
}

function mapWishlistRowsToItems(rows = [], products = []) {
  return rows
    .map((row) => {
      const product = getProductByRef(row, products);

      if (!product) {
        return null;
      }

      return {
        productId: row.product_id,
        slug: product.slug ?? "",
        name: product.name ?? "",
      };
    })
    .filter(Boolean);
}

async function syncGuestCartToRemote(products = []) {
  const userResult = await getSignedInUser();

  if (!userResult.ok) {
    return userResult;
  }

  const guestItems = loadGuestCartDraft();

  if (guestItems.length === 0) {
    return { ok: true, merged: false };
  }

  try {
    const remoteCart = await ensureCartRow(userResult.user.id);
    const validGuestItems = [];

    for (const item of guestItems) {
      const product = getProductByRef(item, products);
      const productId = clean(product?.id);

      if (!productId) {
        continue;
      }

      const selectedColor = normalizeOptionalText(item.selectedColor);
      const selectedSize = normalizeOptionalText(item.selectedSize);
      const selectedOptions = normalizeSelectedOptions(item.selectedOptions);
      const variantKey = buildVariantKeyFromSelection({
        slug: clean(product.slug),
        selectedColor,
        selectedSize,
        selectedOptions,
        variantKey: item.variantKey,
      });
      const quantity = normalizeQuantity(item.quantity);
      validGuestItems.push({
        productId,
        slug: clean(product.slug),
        quantity,
        selectedColor,
        selectedSize,
        selectedOptions,
        variantKey,
      });

      const lineQuery = supabase
        .from("cart_items")
        .select("id, quantity")
        .eq("cart_id", remoteCart.id)
        .eq("product_id", productId);
      lineQuery.eq("variant_key", variantKey);

      const { data: existing, error: existingError } = await lineQuery.maybeSingle();

      if (existingError) {
        throw existingError;
      }

      if (existing) {
        const { error: updateError } = await supabase
        .from("cart_items")
        .update({ quantity: normalizeQuantity(existing.quantity) + quantity })
        .eq("id", existing.id)
        .eq("cart_id", remoteCart.id);

        if (updateError) {
          throw updateError;
        }

        continue;
      }

      const { error: insertError } = await supabase.from("cart_items").insert({
        cart_id: remoteCart.id,
        product_id: productId,
        quantity,
        selected_color: selectedColor,
        selected_size: selectedSize,
        variant_key: variantKey,
        selected_options: selectedOptions,
      });

      if (insertError) {
        throw insertError;
      }
    }

    if (validGuestItems.length === 0) {
      clearGuestCartDraft();
      return { ok: true, merged: false };
    }

    clearGuestCartDraft();
    return { ok: true, merged: true };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Unable to merge the guest cart.",
      error,
    };
  }
}

async function syncGuestWishlistToRemote(products = []) {
  const userResult = await getSignedInUser();

  if (!userResult.ok) {
    return userResult;
  }

  const guestItems = loadGuestWishlistDraft();

  if (guestItems.length === 0) {
    return { ok: true, merged: false };
  }

  try {
    const remoteWishlist = await ensureWishlistRow(userResult.user.id);

    for (const item of guestItems) {
      const product = getProductByRef(item, products);
      const productId = clean(item.productId ?? product?.id);

      if (!productId) {
        continue;
      }

      const { data: existing, error: existingError } = await supabase
        .from("wishlist_items")
        .select("id")
        .eq("wishlist_id", remoteWishlist.id)
        .eq("product_id", productId)
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      if (existing) {
        continue;
      }

      const { error: insertError } = await supabase.from("wishlist_items").insert({
        wishlist_id: remoteWishlist.id,
        product_id: productId,
      });

      if (insertError) {
        throw insertError;
      }
    }

    clearGuestWishlistDraft();
    return { ok: true, merged: true };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Unable to merge the guest wishlist.",
      error,
    };
  }
}

export async function loadCartState(products = []) {
  const userResult = await getSignedInUser();

  if (!userResult.ok) {
    return {
      ok: true,
      source: "guest",
      items: mapCartRowsToItems(loadGuestCartDraft(), products),
      message: "",
    };
  }

  const mergeResult = await syncGuestCartToRemote(products);

  if (!mergeResult.ok) {
    return mergeResult;
  }

  try {
    const rows = await loadRemoteCartRows(userResult.user.id);
    return {
      ok: true,
      source: "remote",
      items: mapCartRowsToItems(rows, products),
      message: "",
    };
  } catch (error) {
    return {
      ok: false,
      source: "remote",
      items: [],
      message: error?.message || "Unable to load the cart.",
      error,
    };
  }
}

export async function loadWishlistState(products = []) {
  const userResult = await getSignedInUser();

  if (!userResult.ok) {
    return {
      ok: true,
      source: "guest",
      items: mapWishlistRowsToItems(loadGuestWishlistDraft(), products).map((item) => item.name),
      message: "",
    };
  }

  const mergeResult = await syncGuestWishlistToRemote(products);

  if (!mergeResult.ok) {
    return mergeResult;
  }

  try {
    const rows = await loadRemoteWishlistRows(userResult.user.id);
    return {
      ok: true,
      source: "remote",
      items: mapWishlistRowsToItems(rows, products).map((item) => item.name),
      message: "",
    };
  } catch (error) {
    return {
      ok: false,
      source: "remote",
      items: [],
      message: error?.message || "Unable to load the wishlist.",
      error,
    };
  }
}

export async function addCartLine({
  product,
  quantity = 1,
  selectedColor = "",
  selectedSize = "",
  selectedOptions = [],
  variantKey: incomingVariantKey = "",
  products = [],
} = {}) {
  const normalizedProduct = product && typeof product === "object" ? product : null;
  const normalizedProductId = clean(normalizedProduct?.id ?? normalizedProduct?.productId);
  const normalizedSelectedOptions = normalizeSelectedOptions(
    selectedOptions.length > 0
      ? selectedOptions
      : normalizedProduct?.selectedOptions ?? normalizedProduct?.selected_options ?? [],
  );

  if (!normalizedProductId) {
    return { ok: false, message: "A valid product is required.", items: [] };
  }

  const safeQuantity = normalizeQuantity(quantity);
  const safeColor = normalizeOptionalText(selectedColor);
  const safeSize = normalizeOptionalText(selectedSize);
  const resolvedVariantKey = buildVariantKeyFromSelection({
    slug: normalizedProduct.slug ?? normalizedProductId,
    selectedColor: safeColor,
    selectedSize: safeSize,
    selectedOptions: normalizedSelectedOptions,
    variantKey: incomingVariantKey || normalizedProduct?.variantKey || normalizedProduct?.variant_key,
  });
  const userResult = await getSignedInUser();

  if (!userResult.ok) {
    const nextItems = dedupeGuestCartItems([
      ...loadGuestCartDraft(),
      {
        productId: normalizedProductId,
        slug: normalizedProduct.slug ?? "",
        quantity: safeQuantity,
        selectedColor: safeColor,
        selectedSize: safeSize,
        selectedOptions: normalizedSelectedOptions,
        variantKey: resolvedVariantKey,
      },
    ]);

    saveGuestCartDraft(nextItems);
    return {
      ok: true,
      source: "guest",
      items: mapCartRowsToItems(nextItems, products),
    };
  }

  try {
    const remoteCart = await ensureCartRow(userResult.user.id);
    const lineQuery = supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("cart_id", remoteCart.id)
      .eq("product_id", normalizedProductId)
      .eq("variant_key", resolvedVariantKey);

    const { data: existing, error: existingError } = await lineQuery.maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from("cart_items")
        .update({ quantity: normalizeQuantity(existing.quantity) + safeQuantity })
        .eq("id", existing.id)
        .eq("cart_id", remoteCart.id);

      if (updateError) {
        throw updateError;
      }
    } else {
      const { error: insertError } = await supabase.from("cart_items").insert({
        cart_id: remoteCart.id,
        product_id: normalizedProductId,
        quantity: safeQuantity,
        selected_color: safeColor,
        selected_size: safeSize,
        variant_key: resolvedVariantKey,
        selected_options: normalizedSelectedOptions,
      });

      if (insertError) {
        throw insertError;
      }
    }

    const refreshed = await loadRemoteCartRows(userResult.user.id);
    return {
      ok: true,
      source: "remote",
      items: mapCartRowsToItems(refreshed, products),
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Unable to save the cart item.",
      error,
      items: [],
    };
  }
}

export async function setCartLineQuantity({
  product,
  quantity = 1,
  selectedColor = "",
  selectedSize = "",
  selectedOptions = [],
  variantKey: incomingVariantKey = "",
  products = [],
} = {}) {
  const normalizedProduct = product && typeof product === "object" ? product : null;
  const normalizedProductId = clean(normalizedProduct?.id ?? normalizedProduct?.productId);
  const productSelectedOptions = normalizeSelectedOptions(
    normalizedProduct?.selectedOptions ??
      normalizedProduct?.selected_options ??
      [],
  );

  if (!normalizedProductId) {
    return { ok: false, message: "A valid product is required.", items: [] };
  }

  const safeQuantity = normalizeQuantity(quantity);
  const safeColor = normalizeOptionalText(selectedColor);
  const safeSize = normalizeOptionalText(selectedSize);
  const normalizedSelectedOptions = normalizeSelectedOptions(
    selectedOptions.length > 0
      ? selectedOptions
      : normalizedProduct?.selectedOptions ?? normalizedProduct?.selected_options ?? [],
  );
  const resolvedVariantKey = buildVariantKeyFromSelection({
    slug: normalizedProduct.slug ?? normalizedProductId,
    selectedColor: safeColor,
    selectedSize: safeSize,
    selectedOptions: normalizedSelectedOptions,
    variantKey: incomingVariantKey || normalizedProduct?.variantKey || normalizedProduct?.variant_key,
  });
  const userResult = await getSignedInUser();

  if (!userResult.ok) {
    const nextItems = dedupeGuestCartItems(
      loadGuestCartDraft().map((item) =>
        item.productId === normalizedProductId &&
        buildVariantKeyFromSelection({
          slug: item.slug ?? normalizedProduct.slug ?? normalizedProductId,
          selectedColor: item.selectedColor,
          selectedSize: item.selectedSize,
          selectedOptions: item.selectedOptions,
          variantKey: item.variantKey,
        }) === resolvedVariantKey
          ? { ...item, quantity: safeQuantity, variantKey: resolvedVariantKey, selectedOptions: normalizedSelectedOptions }
          : item,
      ),
    );

    saveGuestCartDraft(nextItems);
    return {
      ok: true,
      source: "guest",
      items: mapCartRowsToItems(nextItems, products),
    };
  }

  try {
    const remoteCart = await ensureCartRow(userResult.user.id);
    const lineQuery = supabase
      .from("cart_items")
      .select("id")
      .eq("cart_id", remoteCart.id)
      .eq("product_id", normalizedProductId)
      .eq("variant_key", resolvedVariantKey);

    const { data: existing, error: existingError } = await lineQuery.maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (!existing) {
      const { error: insertError } = await supabase.from("cart_items").insert({
        cart_id: remoteCart.id,
        product_id: normalizedProductId,
        quantity: safeQuantity,
        selected_color: safeColor,
        selected_size: safeSize,
        variant_key: resolvedVariantKey,
        selected_options: normalizedSelectedOptions,
      });

      if (insertError) {
        throw insertError;
      }
    } else {
      const { error: updateError } = await supabase
        .from("cart_items")
        .update({ quantity: safeQuantity })
        .eq("id", existing.id)
        .eq("cart_id", remoteCart.id);

      if (updateError) {
        throw updateError;
      }
    }

    const refreshed = await loadRemoteCartRows(userResult.user.id);
    return {
      ok: true,
      source: "remote",
      items: mapCartRowsToItems(refreshed, products),
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Unable to update the cart item.",
      error,
      items: [],
    };
  }
}

export async function removeCartLine({
  product,
  selectedColor = "",
  selectedSize = "",
  selectedOptions = [],
  variantKey: incomingVariantKey = "",
  products = [],
} = {}) {
  const normalizedProduct = product && typeof product === "object" ? product : null;
  const normalizedProductId = clean(normalizedProduct?.id ?? normalizedProduct?.productId);
  const normalizedSelectedOptions = normalizeSelectedOptions(
    selectedOptions.length > 0
      ? selectedOptions
      : normalizedProduct?.selectedOptions ?? normalizedProduct?.selected_options ?? [],
  );

  if (!normalizedProductId) {
    return { ok: false, message: "A valid product is required.", items: [] };
  }

  const safeColor = normalizeOptionalText(selectedColor);
  const safeSize = normalizeOptionalText(selectedSize);
  const resolvedVariantKey = buildVariantKeyFromSelection({
    slug: normalizedProduct.slug ?? normalizedProductId,
    selectedColor: safeColor,
    selectedSize: safeSize,
    selectedOptions: normalizedSelectedOptions,
    variantKey: incomingVariantKey || normalizedProduct?.variantKey || normalizedProduct?.variant_key,
  });
  const userResult = await getSignedInUser();

  if (!userResult.ok) {
    const nextItems = loadGuestCartDraft().filter(
      (item) =>
        !(
          item.productId === normalizedProductId &&
          buildVariantKeyFromSelection({
            slug: item.slug ?? normalizedProduct.slug ?? normalizedProductId,
            selectedColor: item.selectedColor,
            selectedSize: item.selectedSize,
            selectedOptions: item.selectedOptions,
            variantKey: item.variantKey,
          }) === resolvedVariantKey
        ),
    );

    saveGuestCartDraft(nextItems);
    return {
      ok: true,
      source: "guest",
      items: mapCartRowsToItems(nextItems, products),
    };
  }

  try {
    const remoteCart = await ensureCartRow(userResult.user.id);
    let query = supabase
      .from("cart_items")
      .delete()
      .eq("cart_id", remoteCart.id)
      .eq("product_id", normalizedProductId)
      .eq("variant_key", resolvedVariantKey);

    const { error } = await query;

    if (error) {
      throw error;
    }

    const refreshed = await loadRemoteCartRows(userResult.user.id);
    return {
      ok: true,
      source: "remote",
      items: mapCartRowsToItems(refreshed, products),
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Unable to remove the cart item.",
      error,
      items: [],
    };
  }
}

export async function clearCartState({ products = [] } = {}) {
  const userResult = await getSignedInUser();

  if (!userResult.ok) {
    clearGuestCartDraft();
    return { ok: true, source: "guest", items: [] };
  }

  try {
    const remoteCart = await ensureCartRow(userResult.user.id);
    const { error } = await supabase.from("cart_items").delete().eq("cart_id", remoteCart.id);

    if (error) {
      throw error;
    }

    return { ok: true, source: "remote", items: [] };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Unable to clear the cart.",
      error,
      items: [],
    };
  }
}

export async function toggleWishlistItem({ product, products = [] } = {}) {
  const normalizedProduct = product && typeof product === "object" ? product : null;
  const normalizedProductId = clean(normalizedProduct?.id ?? normalizedProduct?.productId);

  if (!normalizedProductId) {
    return { ok: false, message: "A valid product is required.", items: [] };
  }

  const userResult = await getSignedInUser();

  if (!userResult.ok) {
    const draft = loadGuestWishlistDraft();
    const exists = draft.some(
      (item) =>
        item.productId === normalizedProductId ||
        clean(item.slug).toLowerCase() === clean(normalizedProduct.slug).toLowerCase() ||
        clean(item.name).toLowerCase() === clean(normalizedProduct.name).toLowerCase(),
    );

    const nextDraft = exists
      ? draft.filter(
        (item) =>
          !(
              item.productId === normalizedProductId ||
              clean(item.slug).toLowerCase() === clean(normalizedProduct.slug).toLowerCase() ||
              clean(item.name).toLowerCase() === clean(normalizedProduct.name).toLowerCase()
            ),
        )
      : dedupeGuestWishlistItems([
          ...draft,
          {
            productId: normalizedProductId,
            slug: normalizedProduct.slug ?? "",
            name: normalizedProduct.name ?? "",
          },
        ]);

    saveGuestWishlistDraft(nextDraft);
    return {
      ok: true,
      source: "guest",
      items: mapWishlistRowsToItems(nextDraft, products).map((item) => item.name),
    };
  }

  try {
    const remoteWishlist = await ensureWishlistRow(userResult.user.id);
    const { data: existing, error: existingError } = await supabase
      .from("wishlist_items")
      .select("id")
      .eq("wishlist_id", remoteWishlist.id)
      .eq("product_id", normalizedProductId)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      const { error } = await supabase.from("wishlist_items").delete().eq("id", existing.id);

      if (error) {
        throw error;
      }
      } else {
        const { error } = await supabase.from("wishlist_items").insert({
          wishlist_id: remoteWishlist.id,
          product_id: normalizedProductId,
        });

      if (error) {
        throw error;
      }
    }

    const rows = await loadRemoteWishlistRows(userResult.user.id);
    return {
      ok: true,
      source: "remote",
      items: mapWishlistRowsToItems(rows, products).map((item) => item.name),
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Unable to update the wishlist.",
      error,
      items: [],
    };
  }
}

export async function clearWishlistState({ products = [] } = {}) {
  const userResult = await getSignedInUser();

  if (!userResult.ok) {
    clearGuestWishlistDraft();
    return { ok: true, source: "guest", items: [] };
  }

  try {
    const remoteWishlist = await ensureWishlistRow(userResult.user.id);
    const { error } = await supabase.from("wishlist_items").delete().eq("wishlist_id", remoteWishlist.id);

    if (error) {
      throw error;
    }

    return { ok: true, source: "remote", items: [] };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Unable to clear the wishlist.",
      error,
      items: [],
    };
  }
}

export {
  buildCartLineKey,
  clearGuestCartDraft,
  clearGuestWishlistDraft,
  loadGuestCartDraft,
  loadGuestWishlistDraft,
  mapCartRowsToItems,
  mapWishlistRowsToItems,
  saveGuestCartDraft,
  saveGuestWishlistDraft,
  syncGuestCartToRemote,
  syncGuestWishlistToRemote,
};
