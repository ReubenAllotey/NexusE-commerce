import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  normalizeAvailabilityType,
  useProducts,
} from "../Products/productData";
import {
  calculateShippingCheckoutSummary,
  getDefaultShippingPaymentMode,
  loadShippingPaymentPreference,
  resolveShippingLine,
  saveShippingPaymentPreference,
  SHIPPING_PAYMENT_MODES,
} from "../../shared/shippingCheckout";
import {
  loadCheckoutDraft as loadPaymentCheckoutDraft,
  saveCheckoutDraft as savePaymentCheckoutDraft,
} from "../payment/paymentStorage";

function clean(value) {
  return String(value ?? "").trim();
}

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
    phoneNumber: address?.phoneNumber ?? authUser?.phoneNumber ?? "",
    emailAddress: address?.emailAddress ?? authUser?.email ?? "",
    country: "Ghana",
    region: address?.region ?? "",
    city: address?.deliveryLocation ?? address?.city ?? "",
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
      const shippingLine = resolveShippingLine(product, item);

      return {
        key: item.cartKey ?? item.slug ?? product.slug ?? product.name,
        product,
        quantity,
        shippingFee: shippingLine.shippingFee,
        shippingFeeStatus: shippingLine.shippingFeeStatus,
        effectiveShippingFee: shippingLine.lineShipping / shippingLine.quantity,
        lineSubtotal: shippingLine.lineSubtotal,
        lineShipping: shippingLine.lineShipping,
        hasPendingShipping: shippingLine.hasPendingShipping,
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
  const [shippingPaymentPreference, setShippingPaymentPreference] = useState(
    location.state?.shippingPaymentPreference ?? SHIPPING_PAYMENT_MODES.PAY_LATER,
  );
  const summary = calculateShippingCheckoutSummary(cartRows, shippingPaymentPreference);
  const subtotal = summary.productSubtotal;
  const shippingTotal = summary.knownShippingTotal;
  const totalPrice = summary.amountPayableNow;

  const isAddressesLoading = addresses == null;
  const visibleAddresses = Array.isArray(addresses) ? addresses : [];
  const profileAddress = visibleAddresses.find((address) => address.isDefault) ?? visibleAddresses[0] ?? null;
  const currentUserId = clean(authUser?.id);

  const [selectedAddress, setSelectedAddress] = useState(null);
  const [savedCheckoutAddress, setSavedCheckoutAddress] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState(() => createEmptyForm(authUser, null));
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    const savedPreference = location.state?.shippingPaymentPreference ?? loadShippingPaymentPreference(currentUserId || "guest");
    setShippingPaymentPreference(savedPreference ?? getDefaultShippingPaymentMode(summary));
  }, [currentUserId, location.state?.shippingPaymentPreference]);

  useEffect(() => {
    const nextSavedCheckoutAddress = readScopedCheckoutDraft(currentUserId);
    const nextInitialAddress = nextSavedCheckoutAddress ?? profileAddress ?? null;

    setSavedCheckoutAddress(nextSavedCheckoutAddress);
    setSelectedAddress(nextInitialAddress ? { ...nextInitialAddress } : null);
    setIsFormOpen(!nextInitialAddress);
    setFormData(createEmptyForm(authUser, nextInitialAddress));
    setFormError("");
    setFieldErrors({});
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
    setFieldErrors((current) => ({ ...current, [name]: "" }));
    setFormError("");
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
        knownCommercialTotal: summary.knownCommercialTotal,
        amountPayableNow: summary.amountPayableNow,
        shippingDueLater: summary.shippingDueLater,
        totalPrice,
      },
      shippingPaymentPreference,
      guestCredentials,
      guestCheckoutEmail: clean(address?.emailAddress) || clean(formData.emailAddress),
      guestCheckoutName: clean(address?.fullName) || clean(formData.fullName),
      customerName: clean(location.state?.customerName),
      customerPhone: clean(location.state?.customerPhone),
      customerEmail: clean(location.state?.customerEmail),
      updatedAt: new Date().toISOString(),
    };

    saveShippingPaymentPreference(shippingPaymentPreference, ownerKey);
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
        customerName: checkoutDraft.customerName,
        customerPhone: checkoutDraft.customerPhone,
        customerEmail: checkoutDraft.customerEmail,
        shippingPaymentPreference,
      },
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const payload = {
      id: clean(formData.id),
      ...formData,
      fullName: clean(formData.fullName),
      phoneNumber: clean(formData.phoneNumber),
      emailAddress: clean(formData.emailAddress),
      country: "Ghana",
      region: clean(formData.region),
      city: clean(formData.city),
      streetAddress: formData.id ? clean(formData.streetAddress) : "",
      houseNumber: formData.id ? clean(formData.houseNumber) : "",
      landmark: clean(formData.landmark),
      postalCode: clean(formData.postalCode),
    };

    const nextFieldErrors = {};
    if (!payload.region || !GHANA_REGIONS.includes(payload.region)) nextFieldErrors.region = "Please select a region.";
    if (!payload.city) nextFieldErrors.city = "Please enter your delivery location.";

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setFormError("Please review the highlighted fields before continuing.");
      return;
    }

    setIsSubmitting(true);

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
          streetAddress: "",
          houseNumber: "",
          landmark: clean(payload.landmark),
          postalCode: clean(payload.postalCode),
          isDefault: false,
        };

        setSelectedAddress(guestAddress);
        setFormError("");
        setFieldErrors({});
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
        setFieldErrors({});
        setIsFormOpen(false);
        persistAndContinue(savedAddress);
        return;
      }

      setFormError(saveResult?.message || "Please review the address details.");
    } catch (error) {
      setFormError(error?.message || "Please review the address details.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleProceed() {
    if (isSubmitting) {
      return;
    }

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
          <span aria-current="page">Delivery Location</span>
        </nav>

        <header className="shipping-header">
          <div>
            <p>Checkout</p>
            <h1>Delivery Location</h1>
          </div>

          <span>{itemCount} item{itemCount === 1 ? "" : "s"} ready for delivery</span>
        </header>

        <section className="cart-layout shipping-layout">
          <div className="shipping-main">
            <section className="shipping-panel">
              <div className="shipping-panel__header">
                <div>
                  <p className="shipping-panel__eyebrow">
                    {selectedAddress ? "Saved delivery location" : "Delivery details"}
                  </p>
                  <h2>{selectedAddress ? "Use this location for delivery" : "Where should we deliver?"}</h2>
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
                    {selectedAddress.region ? (
                      <p className="address-card__line address-card__line--muted">{selectedAddress.region}</p>
                    ) : null}
                    <p className="address-card__line">{selectedAddress.deliveryLocation || selectedAddress.city}</p>
                    {selectedAddress.country ? (
                      <p className="address-card__line">{selectedAddress.country}</p>
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
                    <label className="address-modal__field">
                      <span>Country <span className="shipping-required" aria-hidden="true">*</span></span>
                      <input
                        id="shipping-country"
                        type="text"
                        name="country"
                        value="Ghana"
                        readOnly
                        required
                        autoComplete="country-name"
                        aria-describedby="shipping-country-help"
                      />
                      <small id="shipping-country-help" className="shipping-form__helper">Nexus Import Hub currently delivers to addresses in Ghana.</small>
                    </label>

                    <label className="address-modal__field">
                      <span>Region <span className="shipping-required" aria-hidden="true">*</span></span>
                      <select
                        id="shipping-region"
                        name="region"
                        value={formData.region}
                        onChange={handleFieldChange}
                        required
                        autoComplete="address-level1"
                        aria-invalid={Boolean(fieldErrors.region)}
                        aria-describedby="shipping-region-help shipping-region-error"
                      >
                        <option value="">Select your region</option>
                        {GHANA_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
                      </select>
                      <small id="shipping-region-help" className="shipping-form__helper">Select the region where your order should be delivered.</small>
                      {fieldErrors.region ? <small id="shipping-region-error" className="shipping-form__field-error">{fieldErrors.region}</small> : null}
                    </label>

                    <label className="address-modal__field">
                      <span>Delivery Location <span className="shipping-required" aria-hidden="true">*</span></span>
                      <input
                        id="shipping-city"
                        type="text"
                        name="city"
                        value={formData.city}
                        onChange={handleFieldChange}
                        required
                        placeholder="Tema Community 25 or Amasaman-Pokuase"
                        aria-invalid={Boolean(fieldErrors.city)}
                        aria-describedby="shipping-city-help shipping-city-error"
                      />
                      <small id="shipping-city-help" className="shipping-form__helper">Enter the area or community where you want your order delivered.</small>
                      {fieldErrors.city ? <small id="shipping-city-error" className="shipping-form__field-error">{fieldErrors.city}</small> : null}
                    </label>

                    <label className="address-modal__field">
                      <span>Landmark <span className="shipping-form__optional">(Optional)</span></span>
                        <input
                          id="shipping-landmark"
                          type="text"
                          name="landmark"
                          value={formData.landmark}
                          onChange={handleFieldChange}
                          placeholder="Opposite Community School or near a filling station"
                          aria-describedby="shipping-landmark-help"
                        />
                      <small id="shipping-landmark-help" className="shipping-form__helper">Add a nearby landmark to help us locate your delivery point.</small>
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
              <span>Known Shipping</span>
              <strong>{shippingTotal > 0 ? formatMoney(shippingTotal) : summary.hasPendingShipping ? "Calculated later" : "Free"}</strong>
            </div>

            {summary.hasPendingShipping ? (
              <div className="cart-summary__line">
                <span>Pending Shipping</span>
                <strong>Calculated later</strong>
              </div>
            ) : null}

            <div className="cart-summary__total">
              <span>Total Order Value</span>
              <strong>{formatMoney(summary.knownCommercialTotal)}</strong>
            </div>

            <div className="cart-summary__line">
              <span>Pay Now</span>
              <strong>{formatMoney(summary.amountPayableNow)}</strong>
            </div>
            {summary.shippingDueLater > 0 ? (
              <div className="cart-summary__line">
                <span>Shipping Due Later</span>
                <strong>{formatMoney(summary.shippingDueLater)}</strong>
              </div>
            ) : null}

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
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving..." : isFormOpen ? "Save Delivery Location" : "Continue to Checkout"}
          </button>
        </footer>
      </div>
    </main>
  );
}

export default ShippingAddress;
