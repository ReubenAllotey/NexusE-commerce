import { supabase } from "../../lib/supabaseClient";

function clean(value) {
  return String(value ?? "").trim();
}

function toNullableText(value) {
  const text = clean(value);
  return text || null;
}

function isDuplicateDefaultConstraintError(error) {
  if (!error) {
    return false;
  }

  const errorBlob = [error.code, error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ");

  return error.code === "23505" && errorBlob.includes("addresses_one_default_per_user_idx");
}

function normalizeAddressRecord(row = {}) {
  return {
    id: row.id ?? "",
    userId: row.user_id ?? "",
    addressLabel: row.address_label ?? "",
    fullName: row.full_name ?? "",
    phoneNumber: row.phone_number ?? "",
    emailAddress: row.email_address ?? "",
    country: row.country ?? "",
    region: row.region ?? "",
    city: row.city ?? "",
    streetAddress: row.street_address ?? "",
    houseNumber: row.house_number ?? "",
    landmark: row.landmark ?? "",
    postalCode: row.postal_code ?? "",
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

function sortAddresses(addresses = []) {
  return [...addresses].sort((left, right) => {
    const defaultRank = Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault));

    if (defaultRank !== 0) {
      return defaultRank;
    }

    const leftDate = new Date(left.createdAt || left.updatedAt || 0).getTime();
    const rightDate = new Date(right.createdAt || right.updatedAt || 0).getTime();

    return leftDate - rightDate;
  });
}

async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return { ok: false, message: error.message || "Unable to resolve the signed-in user." };
  }

  if (!data?.user) {
    return { ok: false, message: "Please sign in to manage addresses." };
  }

  return { ok: true, user: data.user };
}

function buildWritePayload(fields = {}, userId) {
  return {
    user_id: userId,
    address_label: toNullableText(fields.addressLabel),
    full_name: clean(fields.fullName),
    phone_number: clean(fields.phoneNumber),
    email_address: toNullableText(fields.emailAddress),
    country: clean(fields.country),
    region: clean(fields.region),
    city: clean(fields.city),
    street_address: clean(fields.streetAddress),
    house_number: toNullableText(fields.houseNumber),
    landmark: toNullableText(fields.landmark),
    postal_code: toNullableText(fields.postalCode),
    is_default: Boolean(fields.isDefault),
  };
}

async function loadCurrentUserAddresses(userId) {
  const { data, error } = await supabase
    .from("addresses")
    .select(
      "id, user_id, address_label, full_name, phone_number, email_address, country, region, city, street_address, house_number, landmark, postal_code, is_default, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    return { ok: false, message: error.message || "Unable to load addresses.", addresses: [] };
  }

  return {
    ok: true,
    addresses: sortAddresses((data ?? []).map(normalizeAddressRecord)),
  };
}

export async function loadAddresses() {
  const userResult = await getCurrentUser();

  if (!userResult.ok) {
    return { ok: false, message: userResult.message, addresses: [] };
  }

  return loadCurrentUserAddresses(userResult.user.id);
}

export async function createAddress(fields = {}) {
  const userResult = await getCurrentUser();

  if (!userResult.ok) {
    return { ok: false, message: userResult.message, addresses: [] };
  }

  const payload = buildWritePayload(fields, userResult.user.id);

  const attemptInsert = async (isDefault) =>
    supabase
      .from("addresses")
      .insert({
        ...payload,
        is_default: Boolean(isDefault),
      })
      .select(
        "id, user_id, address_label, full_name, phone_number, email_address, country, region, city, street_address, house_number, landmark, postal_code, is_default, created_at, updated_at",
      )
      .single();

  let insertResult = await attemptInsert(payload.is_default);

  if (insertResult.error && isDuplicateDefaultConstraintError(insertResult.error)) {
    const refreshedBeforeRetry = await loadCurrentUserAddresses(userResult.user.id);

    if (!refreshedBeforeRetry.ok) {
      return refreshedBeforeRetry;
    }

    insertResult = await attemptInsert(false);
  }

  if (insertResult.error) {
    return {
      ok: false,
      message: insertResult.error.message || "Unable to save address.",
      addresses: [],
    };
  }

  const refreshed = await loadCurrentUserAddresses(userResult.user.id);

  if (!refreshed.ok) {
    return refreshed;
  }

  return {
    ok: true,
    address: normalizeAddressRecord(insertResult.data ?? {}),
    addresses: refreshed.addresses,
  };
}

export async function updateAddress(addressId, fields = {}) {
  const userResult = await getCurrentUser();

  if (!userResult.ok) {
    return { ok: false, message: userResult.message, addresses: [] };
  }

  if (!clean(addressId)) {
    return { ok: false, message: "Address id is required.", addresses: [] };
  }

  const payload = buildWritePayload(fields, userResult.user.id);
  const { data, error } = await supabase
    .from("addresses")
    .update({
      address_label: payload.address_label,
      full_name: payload.full_name,
      phone_number: payload.phone_number,
      email_address: payload.email_address,
      country: payload.country,
      region: payload.region,
      city: payload.city,
      street_address: payload.street_address,
      house_number: payload.house_number,
      landmark: payload.landmark,
      postal_code: payload.postal_code,
      is_default: payload.is_default,
    })
    .eq("id", addressId)
    .eq("user_id", userResult.user.id)
    .select(
      "id, user_id, address_label, full_name, phone_number, email_address, country, region, city, street_address, house_number, landmark, postal_code, is_default, created_at, updated_at",
    )
    .single();

  if (error) {
    return {
      ok: false,
      message: error.message || "Unable to update address.",
      addresses: [],
    };
  }

  const refreshed = await loadCurrentUserAddresses(userResult.user.id);

  if (!refreshed.ok) {
    return refreshed;
  }

  return {
    ok: true,
    address: normalizeAddressRecord(data ?? {}),
    addresses: refreshed.addresses,
  };
}

export async function deleteAddress(addressId) {
  const userResult = await getCurrentUser();

  if (!userResult.ok) {
    return { ok: false, message: userResult.message, addresses: [] };
  }

  if (!clean(addressId)) {
    return { ok: false, message: "Address id is required.", addresses: [] };
  }

  const { data, error } = await supabase
    .from("addresses")
    .delete()
    .eq("id", addressId)
    .eq("user_id", userResult.user.id)
    .select("id");

  if (error) {
    return {
      ok: false,
      message: error.message || "Unable to delete address.",
      addresses: [],
    };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      message: "Address not found.",
      addresses: [],
    };
  }

  const refreshed = await loadCurrentUserAddresses(userResult.user.id);

  if (!refreshed.ok) {
    return refreshed;
  }

  return {
    ok: true,
    addresses: refreshed.addresses,
  };
}

export async function setDefaultAddress(addressId) {
  const userResult = await getCurrentUser();

  if (!userResult.ok) {
    return { ok: false, message: userResult.message, addresses: [] };
  }

  if (!clean(addressId)) {
    return { ok: false, message: "Address id is required.", addresses: [] };
  }

  const { data, error } = await supabase
    .from("addresses")
    .update({ is_default: true })
    .eq("id", addressId)
    .eq("user_id", userResult.user.id)
    .select(
      "id, user_id, address_label, full_name, phone_number, email_address, country, region, city, street_address, house_number, landmark, postal_code, is_default, created_at, updated_at",
    )
    .single();

  if (error) {
    return {
      ok: false,
      message: error.message || "Unable to update the default address.",
      addresses: [],
    };
  }

  const refreshed = await loadCurrentUserAddresses(userResult.user.id);

  if (!refreshed.ok) {
    return refreshed;
  }

  return {
    ok: true,
    address: normalizeAddressRecord(data ?? {}),
    addresses: refreshed.addresses,
  };
}
