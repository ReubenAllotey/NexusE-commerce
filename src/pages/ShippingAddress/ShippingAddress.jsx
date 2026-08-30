import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getShippingFee, normalizeAvailabilityType, useProducts } from "../Products/productData";
import {
  loadCheckoutDraft as loadPaymentCheckoutDraft,
  saveCheckoutDraft as savePaymentCheckoutDraft,
} from "../payment/paymentStorage";

function clean(value) {
  return String(value ?? "").trim();
}

function formatMoney(value) {
  const safeValue = Number(value) || 0;

  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    minimumFractionDigits: Number.isInteger(safeValue) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(safeValue) ? 0 : 2,
  }).format(safeValue);
}

function formatLocation(address) {
  return [address?.city, address?.country].filter(Boolean).join(", ");
}

function createEmptyForm(authUser = null, address = null) {
  return {
    id: address?.id ?? "",
    addressLabel: address?.addressLabel ?? "",
    fullName: address?.fullName ?? authUser?.name ?? "",
    phoneNumber: address?.phoneNumber ?? "",
    emailAddress: address?.emailAddress ?? authUser?.email ?? "",
    country: address?.country ?? "",
    region: address?.region ?? "",
    city: address?.city ?? "",
    streetAddress: address?.streetAddress ?? "",
    houseNumber: address?.houseNumber ?? "",
    landmark: address?.landmark ?? "",
    postalCode: address?.postalCode ?? "",
  };
}

function readScopedCheckoutDraft(ownerUserId) {
  const currentOwnerId = clean(ownerUserId);
  const draft = loadPaymentCheckoutDraft(currentOwnerId);

  if (!draft || typeof draft !== "object") {
    return null;
  }

  const shippingAddress = draft.shippingAddress ?? null;

  return shippingAddress && clean(shippingAddress.id) ? shippingAddress : null;
}

function resolveCartRows(cartItems = [], productLookup = new Map()) {
  return cartItems
    .map((item) => {
      const product = item?.name && item?.price && item?.image ? item : item?.slug ? productLookup.get(item.slug) ?? null : null;

      if (!product) {
        return null;
      }

      const quantity = item.quantity ?? 1;
      const availabilityType = normalizeAvailabilityType(
        item.availabilityType ??
          item.availability_type ??
          product?.availabilityType ??
          product?.availability_type,
      );
      const shippingFee =
        availabilityType === "preorder"
          ? 0
          : typeof item.shippingFee === "number"
            ? item.shippingFee
            : getShippingFee(product);
      const effectiveShippingFee = typeof shippingFee === "number" ? shippingFee : 0;

      return {
        key: item.cartKey ?? item.slug ?? product.slug ?? product.name,
        product,
        quantity,
        shippingFee,
        effectiveShippingFee,
        lineSubtotal: product.price * quantity,
        lineShipping: effectiveShippingFee * quantity,
        availabilityType,
        variant: item.variant ?? null,
      };
    })
    .filter(Boolean);
}

function ShippingAddress({ addresses = [], cartItems = [], authUser = null, onSaveAddress = async () => ({ ok: false }) }) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    products,
    loading: productsLoading,
    error: productsError,
  } = useProducts();
  const productLookup = new Map(products.map((product) => [product.slug, product]));
  const routeRows = Array.isArray(location.state?.cartRows) ? location.state.cartRows : [];
  const cartRows = routeRows.length > 0
    ? routeRows
    : resolveCartRows(cartItems, productLookup);
  const itemCount = cartRows.reduce((sum, row) => sum + (row.quantity ?? 1), 0);
  const subtotal = cartRows.reduce((sum, row) => sum + (row.lineSubtotal ?? 0), 0);
  const shippingTotal = cartRows.reduce((sum, row) => sum + (row.lineShipping ?? 0), 0);
  const totalPrice = subtotal + shippingTotal;

  const isAddressesLoading = addresses == null;
  const visibleAddresses = Array.isArray(addresses) ? addresses : [];
  const profileAddress = visibleAddresses.find((address) => address.isDefault) ?? visibleAddresses[0] ?? null;
  const currentUserId = clean(authUser?.id);

  const [selectedAddress, setSelectedAddress] = useState(null);
  const [savedCheckoutAddress, setSavedCheckoutAddress] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(true);
  const [formData, setFormData] = useState(() => createEmptyForm(authUser, null));
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const nextSavedCheckoutAddress = readScopedCheckoutDraft(currentUserId);
    const nextInitialAddress = nextSavedCheckoutAddress ?? profileAddress ?? null;

    setSavedCheckoutAddress(nextSavedCheckoutAddress);
    setSelectedAddress(nextInitialAddress ? { ...nextInitialAddress } : null);
    setIsFormOpen(!nextInitialAddress);
    setFormData(createEmptyForm(authUser, nextInitialAddress));
    setFormError("");
  }, [addresses, authUser, currentUserId, profileAddress]);

  if (isAddressesLoading) {
    return (
      <main className="shipping-page">
        <div className="shipping-shell">
          <nav className="shipping-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span aria-hidden="true">&rsaquo;</span>
            <Link to="/cart">Cart</Link>
            <span aria-hidden="true">&rsaquo;</span>
            <span aria-current="page">Shipping Address</span>
          </nav>

          <section className="shipping-empty">
            <h1>Loading your saved addresses...</h1>
            <p>We are fetching the authenticated account addresses from Supabase.</p>
          </section>
        </div>
      </main>
    );
  }

  if (productsError) {
    return (
      <main className="shipping-page">
        <div className="shipping-shell">
          <section className="shipping-empty">
            <h1>Unable to load products right now.</h1>
            <p>{productsError.message || "Please try again in a moment."}</p>
          </section>
        </div>
      </main>
    );
  }

  if (productsLoading && cartRows.length === 0) {
    return (
      <main className="shipping-page">
        <div className="shipping-shell">
          <section className="shipping-empty">
            <h1>Loading checkout details...</h1>
            <p>We are resolving the cart items from Supabase.</p>
          </section>
        </div>
      </main>
    );
  }

  function openForm(address = selectedAddress ?? profileAddress) {
    setFormError("");
    setFormData(createEmptyForm(authUser, address ?? null));
    setIsFormOpen(true);
  }

  function closeForm() {
    setFormError("");
    setIsFormOpen(false);
  }

  function handleFieldChange(event) {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function persistAndContinue(address, guestCredentials = null, ownerKeyOverride = "") {
    const ownerKey =
      currentUserId ||
      clean(ownerKeyOverride) ||
      clean(formData.emailAddress).toLowerCase() ||
      clean(address?.emailAddress).toLowerCase();
    const checkoutDraft = {
      userId: ownerKey,
      shippingAddress: address,
      shippingAddressId: address?.id ?? "",
      cartRows,
      totals: {
        subtotal,
        shippingTotal,
        totalPrice,
      },
      guestCredentials,
      guestCheckoutEmail: clean(address?.emailAddress) || clean(formData.emailAddress),
      guestCheckoutName: clean(address?.fullName) || clean(formData.fullName),
      updatedAt: new Date().toISOString(),
    };

    savePaymentCheckoutDraft(ownerKey, checkoutDraft);

    navigate("/payment", {
      state: {
        shippingAddress: address,
        cartRows,
        totals: checkoutDraft.totals,
        guestCredentials,
        guestCheckoutEmail: checkoutDraft.guestCheckoutEmail,
        guestCheckoutName: checkoutDraft.guestCheckoutName,
        guestCheckoutOwnerKey: ownerKey,
      },
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const payload = {
      id: clean(formData.id),
      ...formData,
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

    if (!payload.fullName || !payload.phoneNumber || !payload.country || !payload.region || !payload.city || !payload.streetAddress) {
      setFormError("Please fill in the required address fields.");
      return;
    }

    try {
      if (!currentUserId) {
        const guestAddress = {
          id: "",
          addressLabel: clean(payload.addressLabel) || "Checkout Address",
          fullName: clean(payload.fullName),
          phoneNumber: clean(payload.phoneNumber),
          emailAddress: clean(payload.emailAddress),
          country: clean(payload.country),
          region: clean(payload.region),
          city: clean(payload.city),
          streetAddress: clean(payload.streetAddress),
          houseNumber: clean(payload.houseNumber),
          landmark: clean(payload.landmark),
          postalCode: clean(payload.postalCode),
          isDefault: false,
        };

        setSelectedAddress(guestAddress);
        setFormError("");
        setIsFormOpen(false);
        persistAndContinue(
          guestAddress,
          null,
          clean(payload.emailAddress).toLowerCase(),
        );
        return;
      }

      const saveResult = await onSaveAddress(payload);

      if (saveResult?.ok && saveResult?.address) {
        const savedAddress = saveResult.address;
        setSelectedAddress(savedAddress);
        setFormError("");
        setIsFormOpen(false);
        persistAndContinue(savedAddress);
        return;
      }

      setFormError(saveResult?.message || "Please review the address details.");
    } catch (error) {
      setFormError(error?.message || "Please review the address details.");
    }
  }

  function handleProceed() {
    if (selectedAddress) {
      persistAndContinue(selectedAddress);
      return;
    }

    openForm();
  }

  if (cartRows.length === 0) {
    return (
      <main className="shipping-page">
        <div className="shipping-shell">
          <nav className="shipping-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span aria-hidden="true">&rsaquo;</span>
            <Link to="/cart">Cart</Link>
            <span aria-hidden="true">&rsaquo;</span>
            <span aria-current="page">Shipping Address</span>
          </nav>

          <section className="shipping-empty">
            <h1>Your cart is empty.</h1>
            <p>Add items to your cart before you can continue to shipping.</p>
            <div className="shipping-empty__actions">
              <Link to="/products" className="shipping-empty__button">
                Browse Products
              </Link>
              <Link to="/cart" className="shipping-empty__button shipping-empty__button--ghost">
                Back to Cart
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="shipping-page">
      <div className="shipping-shell">
        <nav className="shipping-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">&rsaquo;</span>
          <Link to="/cart">Cart</Link>
          <span aria-hidden="true">&rsaquo;</span>
          <span aria-current="page">Shipping Address</span>
        </nav>

        <header className="shipping-header">
          <div>
            <p>Checkout</p>
            <h1>Shipping Address</h1>
          </div>

          <span>{itemCount} item{itemCount === 1 ? "" : "s"} ready for delivery</span>
        </header>

        <section className="cart-layout shipping-layout">
          <div className="shipping-main">
            <section className="shipping-panel">
              <div className="shipping-panel__header">
                <div>
                  <p className="shipping-panel__eyebrow">
                    {selectedAddress ? "Saved delivery address" : "Shipping details"}
                  </p>
                  <h2>{selectedAddress ? "Use a saved address for this order" : "Enter a shipping address"}</h2>
                </div>

                {selectedAddress ? (
                  <button type="button" className="shipping-panel__link" onClick={() => openForm(selectedAddress)}>
                    Change address
                  </button>
                ) : null}
              </div>

              {selectedAddress && !isFormOpen ? (
                <article className={`address-card shipping-address-card${selectedAddress.isDefault ? " is-default" : ""}`}>
                  <div className="address-card__header">
                    <div className="address-card__heading">
                      <h3>{selectedAddress.addressLabel || "Shipping Address"}</h3>
                      {selectedAddress.isDefault ? <span className="address-card__badge">Default</span> : null}
                    </div>

                    <strong className="address-card__owner">{selectedAddress.fullName}</strong>
                  </div>

                  <div className="address-card__body">
                    <p className="address-card__line">{selectedAddress.streetAddress}</p>
                    {selectedAddress.houseNumber ? (
                      <p className="address-card__line">{selectedAddress.houseNumber}</p>
                    ) : null}
                    <p className="address-card__line">{formatLocation(selectedAddress)}</p>
                    {selectedAddress.region ? (
                      <p className="address-card__line address-card__line--muted">{selectedAddress.region}</p>
                    ) : null}

                    <div className="address-card__contact">
                      <span>WhatsApp Number:</span>
                      <strong>{selectedAddress.phoneNumber}</strong>
                    </div>

                    {selectedAddress.emailAddress ? (
                      <div className="address-card__contact">
                        <span>Email:</span>
                        <strong>{selectedAddress.emailAddress}</strong>
                      </div>
                    ) : null}

                    {selectedAddress.landmark ? (
                      <p className="address-card__line address-card__line--muted">
                        Landmark: {selectedAddress.landmark}
                      </p>
                    ) : null}

                    {selectedAddress.postalCode ? (
                      <p className="address-card__line address-card__line--muted">
                        GPS Code: {selectedAddress.postalCode}
                      </p>
                    ) : null}

                    <p className="address-card__default-note">
                      {savedCheckoutAddress ? "Previously entered shipping address" : "Pulled from your profile"}
                    </p>
                  </div>
                </article>
              ) : (
                <form id="shipping-address-form" className="shipping-form" onSubmit={handleSubmit}>
                  {selectedAddress ? (
                    <div className="shipping-panel__header shipping-panel__header--compact">
                      <p className="shipping-panel__eyebrow">Editing for this order</p>
                      <button type="button" className="shipping-panel__link" onClick={closeForm}>
                        Use saved address
                      </button>
                    </div>
                  ) : null}

                  <div className="address-modal__grid shipping-form__grid">
                    <label className="address-modal__field address-modal__field--full">
                      <span>Full Name <span className="shipping-required" aria-hidden="true">*</span></span>
                      <input
                        type="text"
                        name="fullName"
                        value={formData.fullName}
                        onChange={handleFieldChange}
                        required
                        autoComplete="name"
                      />
                    </label>

                    <label className="address-modal__field">
                      <span>WhatsApp Number <span className="shipping-required" aria-hidden="true">*</span></span>
                      <input
                        type="tel"
                        name="phoneNumber"
                        value={formData.phoneNumber}
                        onChange={handleFieldChange}
                        required
                        autoComplete="tel"
                      />
                    </label>

                    <label className="address-modal__field">
                      <span>Email Address <span className="shipping-required" aria-hidden="true">*</span></span>
                      <input
                        type="email"
                        name="emailAddress"
                        value={formData.emailAddress}
                        onChange={handleFieldChange}
                        required
                        autoComplete="email"
                      />
                    </label>

                    <label className="address-modal__field">
                      <span>Country <span className="shipping-required" aria-hidden="true">*</span></span>
                      <input
                        type="text"
                        name="country"
                        value={formData.country}
                        onChange={handleFieldChange}
                        required
                        autoComplete="country-name"
                      />
                    </label>

                    <label className="address-modal__field">
                      <span>Region <span className="shipping-required" aria-hidden="true">*</span></span>
                      <input
                        type="text"
                        name="region"
                        value={formData.region}
                        onChange={handleFieldChange}
                        required
                        autoComplete="address-level1"
                      />
                    </label>

                    <label className="address-modal__field">
                      <span>City <span className="shipping-required" aria-hidden="true">*</span></span>
                      <input
                        type="text"
                        name="city"
                        value={formData.city}
                        onChange={handleFieldChange}
                        required
                        autoComplete="address-level2"
                      />
                    </label>

                    <label className="address-modal__field address-modal__field--full">
                      <span>Street Address <span className="shipping-required" aria-hidden="true">*</span></span>
                      <input
                        type="text"
                        name="streetAddress"
                        value={formData.streetAddress}
                        onChange={handleFieldChange}
                        required
                        autoComplete="street-address"
                      />
                    </label>

                    <label className="address-modal__field">
                      <span>House Number</span>
                      <input
                        type="text"
                        name="houseNumber"
                        value={formData.houseNumber}
                        onChange={handleFieldChange}
                        autoComplete="address-line2"
                      />
                    </label>

                    <label className="address-modal__field">
                      <span>Landmark</span>
                      <input
                        type="text"
                        name="landmark"
                        value={formData.landmark}
                        onChange={handleFieldChange}
                      />
                    </label>

                    <label className="address-modal__field">
                      <span>GPS Code</span>
                      <input
                        type="text"
                        name="postalCode"
                        value={formData.postalCode}
                        onChange={handleFieldChange}
                        autoComplete="postal-code"
                      />
                    </label>
                  </div>

                  <p className="shipping-form__note">
                    We will use this address for the current checkout and keep it ready for payment.
                  </p>

                  {formError ? <p className="shipping-form__error">{formError}</p> : null}
                </form>
              )}
            </section>
          </div>

          <aside className="cart-summary shipping-summary">
            <h2>Order Summary</h2>

            <div className="cart-summary__line">
              <span>Items</span>
              <strong>{itemCount}</strong>
            </div>

            <div className="cart-summary__line">
              <span>Subtotal</span>
              <strong>{formatMoney(subtotal)}</strong>
            </div>

            <div className="cart-summary__line">
              <span>Estimated Shipping</span>
              <strong>{formatMoney(shippingTotal)}</strong>
            </div>

            <div className="cart-summary__total">
              <span>Total Price</span>
              <strong>{formatMoney(totalPrice)}</strong>
            </div>

            <div className="shipping-summary__items">
                {cartRows.slice(0, 3).map((row) => (
                  <div key={row.key} className="shipping-summary__item">
                    <div>
                      <strong>{row.product.name}</strong>
                      <span>{row.quantity} item{row.quantity === 1 ? "" : "s"}</span>
                    </div>
                  <strong>{formatMoney(row.lineSubtotal + row.lineShipping)}</strong>
                  </div>
                ))}
            </div>

            <p className="cart-summary__note">
              The shipping address you choose here will be attached to the next payment step.
            </p>
          </aside>
        </section>

        <footer className="shipping-footer">
          <div className="shipping-footer__copy">
            <p>Ready to continue?</p>
            <strong>
              {selectedAddress
                ? selectedAddress.addressLabel || selectedAddress.fullName || "Saved shipping address"
                : "Complete the form to continue to payment"}
            </strong>
          </div>

          <button
            type={isFormOpen ? "submit" : "button"}
            form={isFormOpen ? "shipping-address-form" : undefined}
            className="shipping-footer__button"
            onClick={!isFormOpen ? handleProceed : undefined}
          >
            {isFormOpen ? "Save & Proceed" : "Proceed to Payment"}
          </button>
        </footer>
      </div>
    </main>
  );
}

export default ShippingAddress;
