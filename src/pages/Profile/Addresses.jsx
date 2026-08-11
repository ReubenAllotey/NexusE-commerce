import { useMemo, useState } from "react";
import ProfileSectionShell from "./ProfileSectionShell";

function createEmptyForm(authUser = null, fallbackLabel = "") {
  return {
    id: "",
    addressLabel: fallbackLabel,
    fullName: authUser?.name ?? "",
    phoneNumber: "",
    emailAddress: authUser?.email ?? "",
    country: "",
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
          <h3>{address.addressLabel || "Address"}</h3>
          {address.isDefault ? <span className="address-card__badge">Default</span> : null}
        </div>

        <strong className="address-card__owner">{address.fullName}</strong>
      </div>

      <div className="address-card__body">
        <p className="address-card__line">{address.streetAddress}</p>
        {address.houseNumber ? (
          <p className="address-card__line">{address.houseNumber}</p>
        ) : null}
        <p className="address-card__line">{formatLocation(address)}</p>
        {address.region ? (
          <p className="address-card__line address-card__line--muted">{address.region}</p>
        ) : null}

        <div className="address-card__contact">
          <span>Phone:</span>
          <strong>{address.phoneNumber}</strong>
        </div>

        {address.emailAddress ? (
          <div className="address-card__contact">
            <span>Email:</span>
            <strong>{address.emailAddress}</strong>
          </div>
        ) : null}

        {address.landmark ? (
          <p className="address-card__line address-card__line--muted">
            Landmark: {address.landmark}
          </p>
        ) : null}

        {address.postalCode ? (
          <p className="address-card__line address-card__line--muted">
            Postal Code: {address.postalCode}
          </p>
        ) : null}

        {address.isDefault ? (
          <p className="address-card__default-note">Default Delivery Address</p>
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
          onClick={() => onDelete(address.id, address.addressLabel)}
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
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState("info");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingAddressId, setDeletingAddressId] = useState("");
  const [defaultingAddressId, setDefaultingAddressId] = useState("");
  const [formData, setFormData] = useState(() =>
    createEmptyForm(authUser, visibleAddresses.length === 0 ? "Home" : ""),
  );

  function openCreateForm() {
    if (isLoading) {
      return;
    }

    setEditingAddress(null);
    setFormError("");
    setStatusMessage("");
    setStatusTone("info");
    setFormData(createEmptyForm(authUser, visibleAddresses.length === 0 ? "Home" : ""));
    setIsFormOpen(true);
  }

  function openEditForm(address) {
    setEditingAddress(address);
    setFormError("");
    setStatusMessage("");
    setStatusTone("info");
    setFormData({
      id: address.id ?? "",
      addressLabel: address.addressLabel ?? "",
      fullName: address.fullName ?? authUser?.name ?? "",
      phoneNumber: address.phoneNumber ?? "",
      emailAddress: address.emailAddress ?? authUser?.email ?? "",
      country: address.country ?? "",
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
  }

  function handleFieldChange(event) {
    const { name, type, checked, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    setIsSaving(true);
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

    try {
      const result = await onSaveAddress(payload);

      if (result?.ok) {
        closeForm();
        setStatusTone("success");
        setStatusMessage(
          editingAddress ? "Address updated successfully." : "Address added successfully.",
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
            <span className="addresses-summary__label">Default Address</span>
            <strong className="addresses-summary__value">
              {isLoading ? "Loading..." : defaultAddress?.addressLabel || "None set"}
            </strong>
            <p className="addresses-summary__note">
              {isLoading
                ? "Fetching saved addresses from Supabase."
                : defaultAddress
                  ? formatLocation(defaultAddress) || defaultAddress.streetAddress
                  : "Add or choose a default delivery address."}
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
            Add New Address
          </button>
        </div>

        {isLoading ? (
          <section className="addresses-empty">
            <h2>Loading Addresses</h2>
            <p>We are fetching your saved delivery addresses from Supabase.</p>
          </section>
        ) : visibleAddresses.length > 0 ? (
          <section className="addresses-panel">
            <div className="addresses-panel__header">
              <div>
                <p className="addresses-panel__eyebrow">Saved locations</p>
                <h2>Delivery address book</h2>
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
            <h2>No Addresses Found</h2>
            <p>Add a delivery address to receive your orders quickly and easily.</p>
            <button type="button" className="addresses-empty__button" onClick={openCreateForm}>
              Add Address
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
              Add New Address
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
                <p>{editingAddress ? "Edit Address" : "Add Address"}</p>
                <h2 id="address-form-title">
                  {editingAddress ? "Update delivery address" : "Add a delivery address"}
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
                <label className="address-modal__field address-modal__field--full">
                  <span>Address Label</span>
                  <input
                    type="text"
                    name="addressLabel"
                    value={formData.addressLabel}
                    onChange={handleFieldChange}
                    placeholder="Home, Office, etc."
                    disabled={isSaving}
                  />
                </label>

                <label className="address-modal__field address-modal__field--full">
                  <span>Full Name</span>
                  <input
                    type="text"
                    name="fullName"
                    value={formData.fullName}
                    onChange={handleFieldChange}
                    required
                    autoComplete="name"
                    disabled={isSaving}
                  />
                </label>

                <label className="address-modal__field">
                  <span>Phone Number</span>
                  <input
                    type="tel"
                    name="phoneNumber"
                    value={formData.phoneNumber}
                    onChange={handleFieldChange}
                    required
                    autoComplete="tel"
                    disabled={isSaving}
                  />
                </label>

                <label className="address-modal__field">
                  <span>Email Address (Optional)</span>
                  <input
                    type="email"
                    name="emailAddress"
                    value={formData.emailAddress}
                    onChange={handleFieldChange}
                    autoComplete="email"
                    disabled={isSaving}
                  />
                </label>

                <label className="address-modal__field">
                  <span>Country</span>
                  <input
                    type="text"
                    name="country"
                    value={formData.country}
                    onChange={handleFieldChange}
                    required
                    autoComplete="country-name"
                    disabled={isSaving}
                  />
                </label>

                <label className="address-modal__field">
                  <span>Region</span>
                  <input
                    type="text"
                    name="region"
                    value={formData.region}
                    onChange={handleFieldChange}
                    required
                    autoComplete="address-level1"
                    disabled={isSaving}
                  />
                </label>

                <label className="address-modal__field">
                  <span>City</span>
                  <input
                    type="text"
                    name="city"
                    value={formData.city}
                    onChange={handleFieldChange}
                    required
                    autoComplete="address-level2"
                    disabled={isSaving}
                  />
                </label>

                <label className="address-modal__field address-modal__field--full">
                  <span>Street Address</span>
                  <input
                    type="text"
                    name="streetAddress"
                    value={formData.streetAddress}
                    onChange={handleFieldChange}
                    required
                    autoComplete="street-address"
                    disabled={isSaving}
                  />
                </label>

                <label className="address-modal__field">
                  <span>House Number (Optional)</span>
                  <input
                    type="text"
                    name="houseNumber"
                    value={formData.houseNumber}
                    onChange={handleFieldChange}
                    autoComplete="address-line2"
                    disabled={isSaving}
                  />
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

                <label className="address-modal__field">
                  <span>Postal Code (Optional)</span>
                  <input
                    type="text"
                    name="postalCode"
                    value={formData.postalCode}
                    onChange={handleFieldChange}
                    autoComplete="postal-code"
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
                <span>Set as Default</span>
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
                  {isSaving ? "Saving..." : "Save Address"}
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
