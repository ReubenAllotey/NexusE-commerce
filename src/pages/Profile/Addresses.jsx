import { useMemo, useState } from "react";
import ProfileSectionShell from "./ProfileSectionShell";

const GHANA_REGIONS = [
  "Ahafo",
  "Ashanti",
  "Bono",
  "Bono East",
  "Central",
  "Eastern",
  "Greater Accra",
  "North East",
  "Northern",
  "Oti",
  "Savannah",
  "Upper East",
  "Upper West",
  "Volta",
  "Western",
  "Western North",
];

function createEmptyForm(authUser = null) {
  return {
    id: "",
    addressLabel: "Delivery Location",
    fullName: authUser?.name ?? "",
    phoneNumber: authUser?.phoneNumber ?? "",
    emailAddress: authUser?.email ?? "",
    country: "Ghana",
    region: "",
    city: "",
    streetAddress: "",
    houseNumber: "",
    landmark: "",
    postalCode: "",
    isDefault: false,
  };
}

function clean(value) {
  return String(value ?? "").trim();
}

function formatLocation(address) {
  return [address?.city, address?.country].filter(Boolean).join(", ");
}

function AddressCard({
  address,
  onEdit,
  onDelete,
  onSetDefault,
  isSaving = false,
  isDeleting = false,
  isSettingDefault = false,
}) {
  const deleteLabel = isDeleting ? "Deleting..." : "Delete";
  const defaultLabel = isSettingDefault ? "Setting..." : "Set as Default";

  return (
    <article className={`address-card${address.isDefault ? " is-default" : ""}`}>
      <div className="address-card__header">
        <div className="address-card__heading">
          <h3>{address.city || "Delivery Location"}</h3>
          {address.isDefault ? <span className="address-card__badge">Default</span> : null}
        </div>

      </div>

      <div className="address-card__body">
        <p className="address-card__line">{address.city || "Delivery location not added"}</p>
        {address.region ? (
          <p className="address-card__line address-card__line--muted">{address.region}</p>
        ) : null}
        <p className="address-card__line">{address.country || "Ghana"}</p>

        {address.landmark ? (
          <p className="address-card__line address-card__line--muted">
            Landmark: {address.landmark}
          </p>
        ) : null}

        {address.isDefault ? (
          <p className="address-card__default-note">Default Delivery Location</p>
        ) : null}
      </div>

      <div className="address-card__actions">
        {!address.isDefault ? (
          <button
            type="button"
            className="address-card__button address-card__button--primary"
            onClick={() => onSetDefault(address.id)}
            disabled={isSaving || isDeleting || isSettingDefault}
          >
            {defaultLabel}
          </button>
        ) : null}

        <button
          type="button"
          className="address-card__button"
          onClick={() => onEdit(address)}
          disabled={isSaving || isDeleting || isSettingDefault}
        >
          Edit
        </button>

        <button
          type="button"
          className="address-card__button address-card__button--danger"
          onClick={() => onDelete(address.id, address.city || "this delivery location")}
          disabled={isSaving || isDeleting || isSettingDefault}
        >
          {deleteLabel}
        </button>
      </div>
    </article>
  );
}

function Addresses({
  addresses = [],
  authUser = null,
  onSaveAddress = async () => ({}),
  onDeleteAddress = async () => ({}),
  onSetDefaultAddress = async () => ({}),
}) {
  const isLoading = addresses == null;
  const visibleAddresses = useMemo(
    () => (Array.isArray(addresses) ? addresses.filter(Boolean) : []),
    [addresses],
  );
  const defaultAddress = visibleAddresses.find((address) => address.isDefault) ?? visibleAddresses[0] ?? null;
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState(null);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState("info");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingAddressId, setDeletingAddressId] = useState("");
  const [defaultingAddressId, setDefaultingAddressId] = useState("");
  const [formData, setFormData] = useState(() =>
    createEmptyForm(authUser),
  );

  function openCreateForm() {
    if (isLoading) {
      return;
    }

    setEditingAddress(null);
    setFormError("");
    setFieldErrors({});
    setStatusMessage("");
    setStatusTone("info");
    setFormData(createEmptyForm(authUser));
    setIsFormOpen(true);
  }

  function openEditForm(address) {
    setEditingAddress(address);
    setFormError("");
    setFieldErrors({});
    setStatusMessage("");
    setStatusTone("info");
    setFormData({
      id: address.id ?? "",
      addressLabel: address.addressLabel ?? "Delivery Location",
      fullName: address.fullName ?? authUser?.name ?? "",
      phoneNumber: address.phoneNumber ?? "",
      emailAddress: address.emailAddress ?? authUser?.email ?? "",
      country: address.country || "Ghana",
      region: address.region ?? "",
      city: address.city ?? "",
      streetAddress: address.streetAddress ?? "",
      houseNumber: address.houseNumber ?? "",
      landmark: address.landmark ?? "",
      postalCode: address.postalCode ?? "",
      isDefault: Boolean(address.isDefault),
    });
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingAddress(null);
    setFormError("");
    setFieldErrors({});
  }

  function handleFieldChange(event) {
    const { name, type, checked, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
    setFieldErrors((current) => ({ ...current, [name]: "" }));
    setFormError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    setFormError("");
    setStatusMessage("");

    const payload = {
      ...formData,
      addressLabel: clean(formData.addressLabel),
      fullName: clean(formData.fullName),
      phoneNumber: clean(formData.phoneNumber),
      emailAddress: clean(formData.emailAddress),
      country: clean(formData.country),
      region: clean(formData.region),
      city: clean(formData.city),
      streetAddress: clean(formData.streetAddress),
      houseNumber: clean(formData.houseNumber),
      landmark: clean(formData.landmark),
      postalCode: clean(formData.postalCode),
    };

    const nextFieldErrors = {};
    if (payload.country !== "Ghana") nextFieldErrors.country = "Country must be Ghana.";
    if (!GHANA_REGIONS.includes(payload.region)) nextFieldErrors.region = "Please select a Ghana region.";
    if (!payload.city) nextFieldErrors.city = "Please enter your delivery location.";

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setFormError("Please review the highlighted fields before saving.");
      window.requestAnimationFrame(() => {
        document.getElementById(`profile-address-${Object.keys(nextFieldErrors)[0]}`)?.focus();
      });
      return;
    }

    setIsSaving(true);

    try {
      const result = await onSaveAddress(payload);

      if (result?.ok) {
        closeForm();
        setStatusTone("success");
        setStatusMessage(
          editingAddress ? "Delivery location updated successfully." : "Delivery location added successfully.",
        );
        return;
      }

      setStatusTone("error");
      setFormError(result?.message || "Please review the address details.");
    } catch (error) {
      setStatusTone("error");
      setFormError(error?.message || "Please review the address details.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(addressId, label) {
    if (typeof window !== "undefined" && !window.confirm(`Delete ${label || "this address"}?`)) {
      return;
    }

    setDeletingAddressId(addressId);
    setFormError("");
    setStatusMessage("");

    try {
      const result = await onDeleteAddress(addressId);

      if (result?.ok) {
        if (editingAddress?.id === addressId) {
          closeForm();
        }

        setStatusTone("success");
        setStatusMessage("Address deleted successfully.");
        return;
      }

      setStatusTone("error");
      setFormError(result?.message || "Unable to delete this address.");
    } catch (error) {
      setStatusTone("error");
      setFormError(error?.message || "Unable to delete this address.");
    } finally {
      setDeletingAddressId("");
    }
  }

  async function handleSetDefault(addressId) {
    setDefaultingAddressId(addressId);
    setFormError("");
    setStatusMessage("");

    try {
      const result = await onSetDefaultAddress(addressId);

      if (result?.ok) {
        setStatusTone("success");
        setStatusMessage("Default address updated successfully.");
        return;
      }

      setStatusTone("error");
      setFormError(result?.message || "Unable to update the default address.");
    } catch (error) {
      setStatusTone("error");
      setFormError(error?.message || "Unable to update the default address.");
    } finally {
      setDefaultingAddressId("");
    }
  }

  return (
    <ProfileSectionShell
      eyebrow="Delivery"
      title="My Addresses"
      description="Manage your delivery addresses for orders and shipments."
    >
      <div className="addresses-stack">
        <div className="addresses-summary" aria-label="Address summary">
          <article className="addresses-summary__card">
            <span className="addresses-summary__label">Saved Addresses</span>
            <strong className="addresses-summary__value">
              {isLoading ? "..." : visibleAddresses.length}
            </strong>
            <p className="addresses-summary__note">All addresses saved to this account.</p>
          </article>

          <article className="addresses-summary__card">
            <span className="addresses-summary__label">Default Delivery Location</span>
            <strong className="addresses-summary__value">
              {isLoading ? "Loading..." : defaultAddress?.city || "None set"}
            </strong>
            <p className="addresses-summary__note">
              {isLoading
                ? "Fetching saved addresses from Supabase."
                : defaultAddress
                  ? formatLocation(defaultAddress) || defaultAddress.streetAddress
                  : "Add or choose a default delivery location."}
            </p>
          </article>
        </div>

        {statusMessage ? (
          <p className={`addresses-feedback addresses-feedback--${statusTone}`}>{statusMessage}</p>
        ) : null}

        <div className="addresses-toolbar">
          <button
            type="button"
            className="addresses-toolbar__button"
            onClick={openCreateForm}
            disabled={isLoading || isSaving || Boolean(deletingAddressId) || Boolean(defaultingAddressId)}
          >
            <><span aria-hidden="true">+</span> Add New Delivery Location</>
          </button>
        </div>

        {isLoading ? (
          <section className="addresses-empty">
            <h2>Loading Delivery Locations</h2>
            <p>We are fetching your saved delivery addresses from Supabase.</p>
          </section>
        ) : visibleAddresses.length > 0 ? (
          <section className="addresses-panel">
            <div className="addresses-panel__header">
              <div>
                <p className="addresses-panel__eyebrow">Saved locations</p>
                <h2>Saved Delivery Locations</h2>
              </div>
              <span>
                {visibleAddresses.length} saved address
                {visibleAddresses.length === 1 ? "" : "es"}
              </span>
            </div>

            <div className="address-grid">
              {visibleAddresses.map((address) => (
                <AddressCard
                  key={address.id}
                  address={address}
                  onEdit={openEditForm}
                  onDelete={handleDelete}
                  onSetDefault={handleSetDefault}
                  isSaving={isSaving}
                  isDeleting={deletingAddressId === address.id}
                  isSettingDefault={defaultingAddressId === address.id}
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="addresses-empty">
            <h2>No Delivery Locations Found</h2>
            <p>Add a delivery location to receive your orders quickly and easily.</p>
            <button type="button" className="addresses-empty__button" onClick={openCreateForm}>
              + Add New Delivery Location
            </button>
          </section>
        )}

        {visibleAddresses.length > 0 ? (
          <div className="addresses-footer">
            <button
              type="button"
              className="addresses-footer__button"
              onClick={openCreateForm}
              disabled={isLoading || isSaving || Boolean(deletingAddressId) || Boolean(defaultingAddressId)}
            >
              <><span aria-hidden="true">+</span> Add New Delivery Location</>
            </button>
          </div>
        ) : null}
      </div>

      {isFormOpen ? (
        <div className="address-modal" role="dialog" aria-modal="true" aria-labelledby="address-form-title">
          <button
            type="button"
            className="address-modal__scrim"
            aria-label="Close address form"
            onClick={closeForm}
          />

          <div className="address-modal__panel">
            <header className="address-modal__header">
              <div>
                <p>{editingAddress ? "Delivery" : "Delivery"}</p>
                <h2 id="address-form-title">
                  {editingAddress ? "Edit Delivery Location" : "Add Delivery Location"}
                </h2>
              </div>

              <button
                type="button"
                className="address-modal__close"
                onClick={closeForm}
                aria-label="Close address form"
                disabled={isSaving}
              >
                x
              </button>
            </header>

            <form className="address-modal__form" onSubmit={handleSubmit}>
              <div className="address-modal__grid">
                <label className="address-modal__field">
                  <span>Country <em aria-hidden="true">*</em></span>
                  <input
                    id="profile-address-country"
                    type="text"
                    name="country"
                    value="Ghana"
                    required
                    readOnly
                    autoComplete="country-name"
                    disabled={isSaving}
                    aria-invalid={Boolean(fieldErrors.country)}
                  />
                  {fieldErrors.country ? <small className="address-modal__field-error">{fieldErrors.country}</small> : null}
                </label>

                <label className="address-modal__field">
                  <span>Region <em aria-hidden="true">*</em></span>
                  <select
                    id="profile-address-region"
                    name="region"
                    value={formData.region}
                    onChange={handleFieldChange}
                    required
                    autoComplete="address-level1"
                    disabled={isSaving}
                    aria-invalid={Boolean(fieldErrors.region)}
                  >
                    <option value="">Select your region</option>
                    {GHANA_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
                  </select>
                  {fieldErrors.region ? <small className="address-modal__field-error">{fieldErrors.region}</small> : null}
                </label>

                <label className="address-modal__field address-modal__field--full">
                  <span>Delivery Location / Town / Community <em aria-hidden="true">*</em></span>
                  <input
                    id="profile-address-city"
                    type="text"
                    name="city"
                    value={formData.city}
                    onChange={handleFieldChange}
                    required
                    autoComplete="address-level2"
                    disabled={isSaving}
                    aria-invalid={Boolean(fieldErrors.city)}
                  />
                  {fieldErrors.city ? <small className="address-modal__field-error">{fieldErrors.city}</small> : null}
                </label>

                <label className="address-modal__field">
                  <span>Landmark (Optional)</span>
                  <input
                    type="text"
                    name="landmark"
                    value={formData.landmark}
                    onChange={handleFieldChange}
                    disabled={isSaving}
                  />
                </label>

              </div>

              <label className="address-modal__check">
                <input
                  type="checkbox"
                  name="isDefault"
                  checked={formData.isDefault}
                  onChange={handleFieldChange}
                  disabled={isSaving}
                />
                <span>Set as Default Delivery Location</span>
              </label>

              {formError ? <p className="address-modal__error">{formError}</p> : null}

              <div className="address-modal__actions">
                <button
                  type="button"
                  className="address-modal__button address-modal__button--ghost"
                  onClick={closeForm}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="address-modal__button address-modal__button--primary"
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save Delivery Location"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </ProfileSectionShell>
  );
}

export default Addresses;
