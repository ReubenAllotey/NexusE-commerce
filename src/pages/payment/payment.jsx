import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { createOrderFromCart } from "../Profile/ordersStorage";
import {
  defaultSiteBanner,
  normalizeSiteBanner,
} from "../../shared/siteBannerStorage";
import { normalizeAvailabilityType } from "../Products/productData";
import {
  calculateShippingCheckoutSummary,
  normalizeShippingPaymentMode,
  resolveShippingLine,
  SHIPPING_PAYMENT_MODES,
} from "../../shared/shippingCheckout";
import { getShippingAccounting } from "../../shared/shippingPayment";
import {
  clearCheckoutDraft,
  clearPaymentSession,
  formatGhanaCedis,
  getMobileNetworkLabel,
  getPaymentMethodLabel,
  loadCheckoutDraft,
  loadPaymentReceipt,
  loadPaymentSession,
  normalizePaymentMethod,
  savePaymentSession,
} from "./paymentStorage";
import { initializePaystackCheckout, verifyPaystackTransaction } from "./paystackApi";

const MOBILE_NETWORKS = [
  { value: "mtn", label: "MTN Mobile Money" },
  { value: "telecel", label: "Telecel Cash" },
  { value: "airteltigo", label: "AirtelTigo Money" },
];

const PAYSTACK_PENDING_STATUSES = new Set(["pending", "processing", "ongoing", "pay_offline"]);

function clean(value) {
  return String(value ?? "").trim();
}

function isReasonableEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function resolveAppUrl() {
  const configuredUrl = clean(import.meta.env.VITE_APP_URL);

  if (configuredUrl) {
    return configuredUrl;
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return "";
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    return { ok: false, message: error.message || "Unable to restore your session.", accessToken: "" };
  }

  const accessToken = data?.session?.access_token ?? "";

  if (!accessToken) {
    return { ok: false, message: "Please sign in again to continue checkout.", accessToken: "" };
  }

  return { ok: true, accessToken };
}

function resolveCartRows(cartItems = []) {
  return cartItems
    .map((item) => {
      const product =
        item?.name && item?.price && item?.image
          ? item
          : item?.slug
            ? { ...item }
            : null;

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
          lineSubtotal: shippingLine.lineSubtotal,
          lineShipping: shippingLine.lineShipping,
          hasPendingShipping: shippingLine.hasPendingShipping,
          availabilityType,
          variant: item.variant ?? null,
        };
      })
    .filter(Boolean);
}

function getInitialCheckout(locationState, cartItems, ownerUserId = "") {
  const draft = loadCheckoutDraft(ownerUserId);
  const state = locationState && typeof locationState === "object" ? locationState : {};
  const routeRows = Array.isArray(state.cartRows) && state.cartRows.length > 0 ? state.cartRows : [];
  const draftRows = Array.isArray(draft?.cartRows) && draft.cartRows.length > 0 ? draft.cartRows : [];
  const cartRows = routeRows.length > 0 ? routeRows : draftRows.length > 0 ? draftRows : resolveCartRows(cartItems);
  const shippingAddress = state.shippingAddress ?? draft?.shippingAddress ?? null;
  const shippingPaymentPreference = normalizeShippingPaymentMode(
    state.shippingPaymentPreference ?? draft?.shippingPaymentPreference ?? SHIPPING_PAYMENT_MODES.PAY_LATER,
  );
  const totals = calculateShippingCheckoutSummary(cartRows, shippingPaymentPreference);

  return {
    shippingAddress,
    cartRows,
    totals,
    shippingPaymentPreference,
    draft,
  };
}

function getCallbackUrl() {
  if (typeof window === "undefined") {
    return "/payment/success";
  }

  return `${window.location.origin}/payment/success`;
}

function getPaymentIntent(search = "") {
  const params = new URLSearchParams(search);
  const purpose = clean(params.get("purpose") ?? params.get("paymentPurpose")).toLowerCase();

  if (purpose !== "shipping-balance") {
    return null;
  }

  const amount = Number(params.get("amount") ?? params.get("balanceDue") ?? 0);

  return {
    purpose,
    orderId: clean(params.get("orderId")),
    orderNumber: clean(params.get("orderNumber")),
    productName: clean(params.get("productName")),
    shippingFee: clean(params.get("shippingFee")),
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    email: clean(params.get("email")),
    name: clean(params.get("name")),
  };
}

function getCheckoutBatchNumber(paymentIntent = null, siteBanner = null) {
  const normalizedBanner = normalizeSiteBanner(siteBanner ?? defaultSiteBanner);

  return clean(paymentIntent?.batchNumber) || clean(normalizedBanner?.announcement?.batchNumber);
}

function getCheckoutEmail(authUser, shippingAddress, paymentIntent = null, targetOrder = null) {
  return clean(
    paymentIntent?.email
      || authUser?.email
      || targetOrder?.customerEmail
      || shippingAddress?.emailAddress,
  );
}

function getCheckoutCustomer(authUser, shippingAddress, paymentIntent = null, targetOrder = null) {
  return {
    id: authUser?.id ?? targetOrder?.customerId ?? shippingAddress?.customerId ?? "guest",
    name: authUser?.name ?? paymentIntent?.name ?? targetOrder?.customerName ?? shippingAddress?.fullName ?? "Guest",
    email: authUser?.email ?? paymentIntent?.email ?? targetOrder?.customerEmail ?? shippingAddress?.emailAddress ?? "",
  };
}

function StatusIcon({ variant }) {
  if (variant === "failed") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 8v5" />
        <path d="M12 16.5h.01" />
        <path d="M10.3 4.5h3.4l7.1 12.2-1.7 2.8H4.9l-1.7-2.8 7.1-12.2Z" />
      </svg>
    );
  }

  if (variant === "success") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 7 9.25 17.75 4 12.5" />
        <path d="M12 2a10 10 0 1 0 10 10" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6v6l4 2" />
      <path d="M21 12a9 9 0 1 1-3.2-6.9" />
    </svg>
  );
}

function PaymentMethodCard({ value, selected, title, description, onClick, children }) {
  return (
    <button
      type="button"
      className={`payment-method-card${selected ? " is-selected" : ""}`}
      onClick={() => onClick(value)}
    >
      <div className="payment-method-card__top">
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <span className="payment-method-card__radio" aria-hidden="true" />
      </div>
      {children}
    </button>
  );
}

function PaymentSummary({ shippingAddress, cartRows, totals }) {
  return (
    <section className="payment-summary checkout-order-summary">
      <div className="payment-summary__header">
        <p>Order Summary</p>
        <strong>
          {cartRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0)} item{cartRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0) === 1 ? "" : "s"}
        </strong>
      </div>

      <div className="payment-summary__items">
        {cartRows.map((row) => {
          const quantity = Number(row.quantity) || 1;
          const unitPrice = (Number(row.lineSubtotal) || 0) / quantity;
          const shipping = Number(row.lineShipping) || 0;
          const shippingPending = row.hasPendingShipping || row.shippingFeeStatus === "pending";
          const selectedOptions = Array.isArray(row.item?.selectedOptions ?? row.selectedOptions)
            ? (row.item?.selectedOptions ?? row.selectedOptions)
            : [];

          return (
            <article key={row.key} className="payment-summary__item checkout-order-summary__item">
              <img src={row.product.image} alt={row.product.name} />
              <div>
                <strong>{row.product.name}</strong>
                {selectedOptions.length > 0 ? (
                  <span>{selectedOptions.map((option) => `${option.label || option.name || "Option"}: ${option.value || option.optionValue || ""}`).join(" · ")}</span>
                ) : row.variant?.color || row.variant?.size ? (
                  <span>{[row.variant.color, row.variant.size].filter(Boolean).join(" / ")}</span>
                ) : null}
                <span>{quantity} × {formatGhanaCedis(unitPrice)}</span>
                <span>{shippingPending ? "Shipping: To be calculated later" : `Shipping: ${shipping > 0 ? formatGhanaCedis(shipping) : "Free"}`}</span>
              </div>
              <strong>{formatGhanaCedis(Number(row.lineSubtotal) || 0)}</strong>
            </article>
          );
        })}
      </div>

      <div className="payment-summary__rows">
        <div className="payment-summary__row">
          <span>Subtotal</span>
          <strong>{formatGhanaCedis(totals.subtotal)}</strong>
        </div>

        <div className="payment-summary__row">
          <span>Known Shipping</span>
          <strong>{totals.shippingTotal > 0 ? formatGhanaCedis(totals.shippingTotal) : totals.hasPendingShipping ? "Calculated later" : "Free"}</strong>
        </div>

        <div className="payment-summary__total">
          <span>Total Order Value</span>
          <strong>{formatGhanaCedis(totals.knownCommercialTotal ?? totals.totalPrice)}</strong>
        </div>

        <div className="payment-summary__row payment-summary__row--payable">
          <span>Amount to Pay Now</span>
          <strong>{formatGhanaCedis(totals.amountPayableNow ?? totals.totalPrice)}</strong>
        </div>

        {(totals.shippingDueLater ?? 0) > 0 ? <div className="payment-summary__row"><span>Shipping Due Later</span><strong>{formatGhanaCedis(totals.shippingDueLater)}</strong></div> : null}
      </div>

      <p className="payment-summary__note">Shipping is calculated per item. Pending fees will be updated later.</p>
    </section>
  );
}

function PaymentProcessing({ title = "Processing Payment", message, amount }) {
  return (
    <section className="payment-processing" aria-live="polite">
      <div className="payment-processing__spinner" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {amount ? <span>{formatGhanaCedis(amount)}</span> : null}
    </section>
  );
}

function PaymentCheckout({
  cartItems = [],
  orders = [],
  ordersLoading = false,
  ordersError = "",
  authUser = null,
  siteBanner = null,
  onClearCart = () => {},
  onReplaceOrders = () => {},
  onUpdateOrder = () => {},
  onSaveAddress = async () => ({ ok: false }),
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [checkoutOwnerKey, setCheckoutOwnerKey] = useState(() =>
    clean(location.state?.guestCheckoutOwnerKey) ||
    clean(location.state?.guestCheckoutEmail) ||
    clean(authUser?.id),
  );
  const paymentIntent = useMemo(() => getPaymentIntent(location.search), [location.search]);
  const checkoutBatchNumber = useMemo(
    () => getCheckoutBatchNumber(paymentIntent, siteBanner),
    [paymentIntent, siteBanner],
  );
  const snapshot = useMemo(
    () => getInitialCheckout(location.state, cartItems, checkoutOwnerKey),
    [cartItems, checkoutOwnerKey, location.state],
  );
  const session = useMemo(
    () => loadPaymentSession(checkoutOwnerKey),
    [checkoutOwnerKey, location.pathname, location.search],
  );
  const targetOrder = useMemo(() => {
    if (!paymentIntent) {
      return null;
    }

    return (
      orders.find((order) => order.id === paymentIntent.orderId) ??
      orders.find((order) => order.orderNumber === paymentIntent.orderNumber) ??
      orders.find(
        (order) =>
          clean(order.paymentReference).toLowerCase() === clean(paymentIntent.orderId).toLowerCase(),
      ) ??
      null
    );
  }, [orders, paymentIntent]);
  const isShippingBalancePayment = paymentIntent?.purpose === "shipping-balance";
  const targetShippingAccounting = getShippingAccounting(targetOrder ?? {});
  const displayedShippingBalance = targetShippingAccounting.outstandingShipping > 0
    ? targetShippingAccounting.outstandingShipping
    : paymentIntent?.amount ?? 0;
  const checkoutShippingAddress = isShippingBalancePayment ? targetOrder?.shippingAddress ?? null : snapshot.shippingAddress;
  const checkoutCartRows = isShippingBalancePayment ? [] : snapshot.cartRows;
  const checkoutTotals = isShippingBalancePayment
    ? {
        subtotal: 0,
        shippingTotal: displayedShippingBalance,
        totalPrice: displayedShippingBalance,
      }
    : snapshot.totals;
  const shippingPaymentPreference = snapshot.shippingPaymentPreference;

  const [paymentMethod, setPaymentMethod] = useState(() => normalizePaymentMethod(session?.paymentMethod ?? "mobile-money"));
  const [mobileNetwork, setMobileNetwork] = useState(() => session?.paymentNetwork ?? "mtn");
  const [mobileNumber, setMobileNumber] = useState(
    () =>
      session?.paymentPhoneNumber ??
      targetOrder?.shippingAddress?.phoneNumber ??
      snapshot.shippingAddress?.phoneNumber ??
      "",
  );
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponMessage, setCouponMessage] = useState("");
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const nextOwnerKey =
      clean(location.state?.guestCheckoutOwnerKey) ||
      clean(location.state?.guestCheckoutEmail) ||
      clean(authUser?.id);

    if (nextOwnerKey && nextOwnerKey !== checkoutOwnerKey) {
      setCheckoutOwnerKey(nextOwnerKey);
    }
  }, [authUser?.id, checkoutOwnerKey, location.state?.guestCheckoutEmail, location.state?.guestCheckoutOwnerKey]);

  const shippingAddress = checkoutShippingAddress;
  const cartRows = checkoutCartRows;
  const totals = checkoutTotals;
  const summaryTotal = isShippingBalancePayment ? displayedShippingBalance : totals.totalPrice ?? totals.total ?? 0;
  const summaryAmount = formatGhanaCedis(summaryTotal);
  const checkoutEmail = getCheckoutEmail(authUser, shippingAddress, paymentIntent, targetOrder);
  const checkoutCustomer = getCheckoutCustomer(authUser, shippingAddress, paymentIntent, targetOrder);

  useEffect(() => {
    setCustomerName(
      clean(location.state?.customerName) ||
        (checkoutCustomer.name === "Guest" ? "" : checkoutCustomer.name),
    );
    setCustomerEmail(clean(location.state?.customerEmail) || checkoutEmail);
    setCustomerPhone(
      clean(location.state?.customerPhone) ||
        shippingAddress?.phoneNumber ||
        authUser?.phoneNumber ||
        "",
    );
  }, [
    authUser?.id,
    authUser?.phoneNumber,
    checkoutEmail,
    checkoutCustomer.name,
    location.state?.customerEmail,
    location.state?.customerName,
    location.state?.customerPhone,
    shippingAddress?.phoneNumber,
  ]);

  useEffect(() => {
    if (!isShippingBalancePayment && (!shippingAddress || cartRows.length === 0)) {
      navigate("/shipping-address", { replace: true });
    }
  }, [cartRows.length, isShippingBalancePayment, navigate, shippingAddress]);

  useEffect(() => {
    if (session?.paymentMethod) {
      setPaymentMethod(normalizePaymentMethod(session.paymentMethod));
    }
  }, [session?.paymentMethod]);

  if (ordersLoading) {
    return (
      <main className="payment-page">
        <div className="payment-shell">
          <PaymentProcessing
            title="Loading orders"
            message="We are fetching your order history from Supabase before checkout."
          />
        </div>
      </main>
    );
  }

  if (ordersError) {
    return (
      <main className="payment-page">
        <div className="payment-shell">
          <section className="shipping-empty">
            <h1>Unable to load orders right now.</h1>
            <p>{ordersError}</p>
          </section>
        </div>
      </main>
    );
  }

  const mobileReady = clean(mobileNetwork) && clean(mobileNumber).length >= 9;
  const hasReadyStockItems = cartRows.some((row) => row.availabilityType === "ready_stock");
  const hasPendingShipping = cartRows.some((row) => row.hasPendingShipping || row.shippingFeeStatus === "pending");
  const canSubmit = agreeToTerms && !isSubmitting && !processing && Boolean(customerName.trim()) && Boolean(customerPhone.trim()) && isReasonableEmail(customerEmail) && (paymentMethod === "card" || mobileReady);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!agreeToTerms) {
      setError("Please confirm your order details and delivery address.");
      return;
    }

    if (!customerName.trim() || !customerPhone.trim()) {
      setError("Please add your full name and phone number before continuing.");
      return;
    }

    if (!customerEmail.trim()) {
      setError("Email address is required.");
      return;
    }

    if (!isReasonableEmail(customerEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    if (paymentMethod === "mobile-money" && !mobileReady) {
      setError("Please choose a mobile money network and enter your number.");
      return;
    }

    if (isShippingBalancePayment && summaryTotal <= 0) {
      setError("No shipping balance is due for this order.");
      return;
    }

    setError("");
    setProcessing(true);
    setIsSubmitting(true);

    let pendingOrder = null;
    let authoritativeAmount = summaryTotal;

    try {
      const checkoutCustomerName = customerName.trim();
      const checkoutCustomerEmail = customerEmail.trim().toLowerCase();
      const checkoutCustomerPhone = customerPhone.trim();

      if (!authUser) {
        const initResponse = await initializePaystackCheckout(
          {
            callbackUrl: getCallbackUrl(),
            guestCheckout: true,
            guestCheckoutEmail: checkoutCustomerEmail,
            guestCheckoutName: checkoutCustomerName,
            guestCheckoutOwnerKey: checkoutOwnerKey,
            batchNumber: checkoutBatchNumber,
            shippingAddress,
            cartRows,
            totals,
            shippingPaymentPreference,
            paymentPurpose: "order",
            paymentMethod,
            paymentNetwork: paymentMethod === "mobile-money" ? mobileNetwork : "",
            paymentPhoneNumber: paymentMethod === "mobile-money" ? mobileNumber : "",
          },
          { accessToken: "" },
        );

        const guestCheckout = initResponse?.guestCheckout ?? initResponse?.data?.guestCheckout ?? null;
        const paystackData = initResponse?.data ?? {};
        const paymentReference = clean(paystackData.reference || guestCheckout?.paymentReference);
        const authorizationUrl = clean(paystackData.authorization_url || guestCheckout?.authorizationUrl);
        const accessCode = clean(paystackData.access_code || guestCheckout?.accessCode);
        const guestCheckoutId = clean(guestCheckout?.id || initResponse?.guestCheckoutId || `guest-${Date.now()}`);
        authoritativeAmount = Number(guestCheckout?.amountDueNow) || Number(paystackData.amount ?? 0) / 100 || summaryTotal;

        if (!paymentReference || !authorizationUrl) {
          throw new Error("Paystack did not return a valid checkout link.");
        }

        pendingOrder = {
          id: guestCheckoutId,
          orderNumber: clean(guestCheckout?.orderNumber) || `GUEST-${Date.now()}`,
          customerId: "guest",
          customerName: checkoutCustomerName,
          customerEmail: checkoutCustomerEmail,
          batchNumber: checkoutBatchNumber,
          shippingAddress,
          total: authoritativeAmount,
          subtotal: totals.subtotal ?? 0,
          shippingTotal: totals.shippingTotal ?? summaryTotal,
          status: "pending_payment",
          paymentStatus: "pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        savePaymentSession(
          {
            id: session?.id ?? `session-${Date.now()}`,
            guestCheckout: true,
            guestCheckoutId,
            orderId: pendingOrder.id,
            orderNumber: pendingOrder.orderNumber,
            paymentReference,
            paymentMethod,
            paymentNetwork: paymentMethod === "mobile-money" ? mobileNetwork : "",
            paymentPhoneNumber: paymentMethod === "mobile-money" ? mobileNumber : "",
            paymentPurpose: "order",
            batchNumber: checkoutBatchNumber,
            shippingBalanceDue: 0,
            status: "initiated",
            paystackAccessCode: accessCode,
            paystackAuthorizationUrl: authorizationUrl,
            shippingAddress,
            cartRows,
            totals,
            customerId: "guest",
            customerName: checkoutCustomer.name,
            customerEmail: checkoutEmail,
            amount: authoritativeAmount,
            amountInPesewas: Math.round(authoritativeAmount * 100),
            topUpOrderId: "",
          guestCheckoutEmail: checkoutCustomerEmail,
          guestCheckoutName: checkoutCustomerName,
            createdAt: session?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          checkoutOwnerKey,
        );

        window.location.assign(authorizationUrl);
        return;
      }

      const tokenResult = await getAccessToken();

      if (!tokenResult.ok) {
        setError(tokenResult.message);
        return;
      }

      if (isShippingBalancePayment) {
        pendingOrder = {
          ...(targetOrder ?? {}),
          id: targetOrder?.id ?? paymentIntent?.orderId ?? `topup-${Date.now()}`,
          orderNumber: targetOrder?.orderNumber ?? paymentIntent?.orderNumber ?? `ORD-TOPUP-${Date.now()}`,
          customerId: targetOrder?.customerId ?? checkoutCustomer.id,
          customerName: targetOrder?.customerName ?? checkoutCustomer.name,
          customerEmail: targetOrder?.customerEmail ?? checkoutEmail,
          batchNumber: targetOrder?.batchNumber ?? checkoutBatchNumber,
          shippingAddress: targetOrder?.shippingAddress ?? shippingAddress,
          total: summaryTotal,
          subtotal: targetOrder?.subtotal ?? 0,
          shippingTotal: summaryTotal,
          status: targetOrder?.status ?? "processing",
          paymentStatus: targetOrder?.paymentStatus ?? "pending",
          createdAt: targetOrder?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } else {
        let resolvedShippingAddressId = shippingAddress?.id ?? "";
        if (resolvedShippingAddressId && typeof onSaveAddress === "function") {
          const addressResult = await onSaveAddress({
            ...shippingAddress,
            id: resolvedShippingAddressId,
            fullName: checkoutCustomerName,
            phoneNumber: checkoutCustomerPhone,
            emailAddress: checkoutCustomerEmail,
            country: "Ghana",
            region: shippingAddress.region,
            city: shippingAddress.city || shippingAddress.deliveryLocation,
            landmark: shippingAddress.landmark ?? "",
          });
          if (!addressResult?.ok) {
            throw new Error(addressResult?.message || "Unable to save your customer details.");
          }
          resolvedShippingAddressId = addressResult.address?.id || resolvedShippingAddressId;
        }

        const createResult = await createOrderFromCart({
          shippingAddressId: resolvedShippingAddressId,
          batchNumber: checkoutBatchNumber,
          shippingPaymentPreference,
        });

        if (!createResult.ok || !createResult.order) {
          throw new Error(createResult.message || "Unable to create your order right now.");
        }

        pendingOrder = createResult.order;
        authoritativeAmount = Number(createResult.combined?.amountDueNow) || summaryTotal;

        if (typeof onReplaceOrders === "function") {
          onReplaceOrders((current = []) => [
            pendingOrder,
            ...current.filter((order) => order.id !== pendingOrder.id),
          ]);
        }
      }

      const initResponse = await initializePaystackCheckout(
        {
          callbackUrl: getCallbackUrl(),
          orderId: pendingOrder.id,
          orderNumber: pendingOrder.orderNumber,
          paymentPurpose: isShippingBalancePayment ? "shipping-balance" : "order",
          paymentMethod,
          paymentNetwork: paymentMethod === "mobile-money" ? mobileNetwork : "",
          paymentPhoneNumber: paymentMethod === "mobile-money" ? mobileNumber : "",
          shippingBalanceDue: isShippingBalancePayment ? summaryTotal : 0,
          shippingPaymentPreference,
          batchNumber: pendingOrder.batchNumber ?? checkoutBatchNumber,
        },
        { accessToken: tokenResult.accessToken },
      );

      const paystackData = initResponse?.data ?? {};
      const paymentReference = clean(paystackData.reference);
      const authorizationUrl = clean(paystackData.authorization_url);
      const accessCode = clean(paystackData.access_code);

      if (!paymentReference || !authorizationUrl) {
        throw new Error("Paystack did not return a valid checkout link.");
      }

      savePaymentSession(
        {
          id: session?.id ?? `session-${Date.now()}`,
          orderId: pendingOrder.id,
          orderNumber: pendingOrder.orderNumber,
          paymentReference,
          paymentMethod,
          paymentNetwork: paymentMethod === "mobile-money" ? mobileNetwork : "",
          paymentPhoneNumber: paymentMethod === "mobile-money" ? mobileNumber : "",
          paymentPurpose: isShippingBalancePayment ? "shipping-balance" : "order",
          shippingBalanceDue: isShippingBalancePayment ? summaryTotal : 0,
          status: "initiated",
          paystackAccessCode: accessCode,
          paystackAuthorizationUrl: authorizationUrl,
          shippingAddress,
          cartRows,
          totals,
          customerId: checkoutCustomer.id,
          customerName: checkoutCustomer.name,
          customerEmail: checkoutEmail,
          batchNumber: pendingOrder.batchNumber ?? checkoutBatchNumber,
          amount: authoritativeAmount,
          amountInPesewas: Math.round(authoritativeAmount * 100),
          topUpOrderId: isShippingBalancePayment ? pendingOrder.id : "",
          createdAt: session?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        checkoutOwnerKey,
      );

      window.location.assign(authorizationUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start Paystack checkout.");
      setProcessing(false);
      setIsSubmitting(false);
    }
  }

  if (!isShippingBalancePayment && (!shippingAddress || cartRows.length === 0)) {
    return <Navigate to="/shipping-address" replace />;
  }

  return (
    <main className="payment-page">
      <div className="payment-shell">
        <nav className="payment-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">&rsaquo;</span>
          <Link
            to="/cart"
            state={{
              shippingAddress,
              customerName,
              customerPhone,
              customerEmail,
              shippingPaymentPreference,
            }}
          >
            Back to Cart
          </Link>
          <span aria-hidden="true">&rsaquo;</span>
          <Link to="/shipping-address">Delivery Location</Link>
          <span aria-hidden="true">&rsaquo;</span>
          <span aria-current="page">Checkout</span>
        </nav>

        <header className="payment-header">
          <div>
            <p>Secure checkout</p>
            <h1>Checkout</h1>
          </div>

          <div className="payment-header__meta">
            <span>
              {cartRows.length} item{cartRows.length === 1 ? "" : "s"} ready
            </span>
            <strong>{summaryAmount}</strong>
          </div>
        </header>

        {processing ? (
          <PaymentProcessing
            amount={summaryTotal}
            message="Please do not close or refresh this page while we connect you to Paystack."
          />
        ) : null}

        <section className="payment-layout">
          <div className="payment-main">
            <section className="checkout-card-flow">
              <div className="payment-panel__header checkout-legacy-header">
                <div>
                  <p className="payment-panel__eyebrow">Select a method</p>
                  <h2>Choose one payment option</h2>
                </div>
                <span className="payment-panel__secure">
                  <span aria-hidden="true">🔒</span> Secure and encrypted payment
                </span>
              </div>

              <>
                <section className="checkout-info-card checkout-info-card--location">
                  <div className="checkout-info-card__heading">
                    <span className="checkout-info-card__icon" aria-hidden="true">⌖</span>
                    <div>
                      <p className="payment-panel__eyebrow">Delivery Location</p>
                      <h2>{shippingAddress?.region || "Region not selected"}</h2>
                    </div>
                  </div>
                  <div className="checkout-info-card__details">
                    <strong>{shippingAddress?.city || shippingAddress?.deliveryLocation || "Delivery location not selected"}</strong>
                    {shippingAddress?.landmark ? <span>{shippingAddress.landmark}</span> : null}
                    <span>{shippingAddress?.country || "Ghana"}</span>
                  </div>
                  <Link
                    to="/shipping-address"
                    state={{
                      cartRows,
                      shippingPaymentPreference,
                      customerName,
                      customerPhone,
                      customerEmail,
                    }}
                    className="checkout-info-card__link"
                  >
                    Change
                  </Link>
                </section>

                <section className="checkout-info-card checkout-info-card--customer">
                  <div className="payment-panel__header">
                    <div>
                      <p className="payment-panel__eyebrow">Customer information</p>
                      <h2>Who should we contact?</h2>
                    </div>
                  </div>
                  <div className="payment-grid">
                    <label className="payment-field">
                      <span>Full Name *</span>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(event) => setCustomerName(event.target.value)}
                        autoComplete="name"
                        required
                      />
                    </label>
                    <label className="payment-field">
                      <span>Phone / WhatsApp Number *</span>
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(event) => setCustomerPhone(event.target.value)}
                        autoComplete="tel"
                        required
                      />
                    </label>
                    <label className="payment-field payment-field--full">
                      <span>Email Address *</span>
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(event) => setCustomerEmail(event.target.value)}
                        autoComplete="email"
                        placeholder="e.g. customer@example.com"
                        required
                      />
                    </label>
                  </div>
                </section>

                {isShippingBalancePayment ? (
                  <section className="payment-summary payment-summary--topup">
                    <div className="payment-summary__header">
                      <p>Shipping balance</p>
                      <strong>{paymentIntent?.productName || targetOrder?.orderNumber || "Top-up"}</strong>
                    </div>
                    <div className="payment-summary__rows">
                      <div className="payment-summary__row">
                        <span>Remaining Balance</span>
                        <strong>{formatGhanaCedis(summaryTotal)}</strong>
                      </div>
                    </div>
                  </section>
            ) : (
              <PaymentSummary shippingAddress={shippingAddress} cartRows={cartRows} totals={totals} />
            )}

            <section className="checkout-info-card checkout-phase-card checkout-coupon-card">
              <div className="checkout-phase-card__header">
                <span className="checkout-phase-card__icon" aria-hidden="true">%</span>
                <h2>Coupon Code</h2>
              </div>
              <div className="checkout-coupon-card__form">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(event) => {
                    setCouponCode(event.target.value);
                    setCouponMessage("");
                  }}
                  placeholder="Enter coupon code"
                  aria-label="Coupon code"
                />
                <button
                  type="button"
                  onClick={() => setCouponMessage("Coupon codes are not available yet.")}
                >
                  Apply
                </button>
              </div>
              {couponMessage ? <p className="checkout-phase-card__message">{couponMessage}</p> : null}
            </section>

            <section className="checkout-info-card checkout-phase-card checkout-delivery-card">
              <div className="checkout-phase-card__header">
                <span className="checkout-phase-card__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M3 6.5h11v10H3zM14 10h3.5l3.5 3.5v3H14z" />
                    <path d="M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
                  </svg>
                </span>
                <h2>Delivery &amp; Shipping</h2>
              </div>
              <div className="checkout-delivery-card__groups">
                {hasReadyStockItems ? (
                  <div className="checkout-delivery-card__group">
                    <strong>Ready Stock</strong>
                    <p>Available items will proceed to delivery after order processing and payment confirmation.</p>
                  </div>
                ) : null}
                <div className="checkout-delivery-card__group checkout-delivery-card__group--preorder">
                  <strong>Preorder Items</strong>
                  <p>Delivery takes 6–9 weeks after monthly orders are closed.</p>
                  <p>Air shipment: approximately 2 weeks.</p>
                </div>
              </div>
              {hasPendingShipping ? <p className="checkout-phase-card__message">Shipping fees marked as pending will be communicated when available.</p> : null}
              <p className="checkout-phase-card__note">Contact us for more information about delivery options.</p>
            </section>

            <section className="checkout-info-card checkout-phase-card checkout-payment-info-card">
              <div className="checkout-phase-card__header">
                <span className="checkout-phase-card__icon" aria-hidden="true">&#128274;</span>
                <h2>Payment Method</h2>
              </div>
              <strong>Secure payment via Paystack</strong>
              <p>Mobile Money and Cards</p>
            </section>

            </>

                <section className="payment-panel">
                  <div className="payment-panel__header">
                    <div>
                      <p className="payment-panel__eyebrow">Payment</p>
                      <h2>Payment controls</h2>
                    </div>
                    <span className="payment-panel__secure">Secure and encrypted payment</span>
                  </div>
                  <form className="payment-form" onSubmit={handleSubmit}>

                <div className="payment-methods">
                  <PaymentMethodCard
                    value="mobile-money"
                    selected={paymentMethod === "mobile-money"}
                    title="Mobile Money"
                    description="MTN, Telecel Cash, AirtelTigo Money"
                    onClick={(value) => {
                      setError("");
                      setPaymentMethod(value);
                    }}
                  >
                    <div className="payment-method-card__list">
                      <span>MTN Mobile Money</span>
                      <span>Telecel Cash</span>
                      <span>AirtelTigo Money</span>
                    </div>
                  </PaymentMethodCard>

                  <PaymentMethodCard
                    value="card"
                    selected={paymentMethod === "card"}
                    title="Debit or Credit Card"
                    description="Card checkout is handled directly by Paystack"
                    onClick={(value) => {
                      setError("");
                      setPaymentMethod(value);
                    }}
                  />
                </div>

                {paymentMethod === "mobile-money" ? (
                  <div className="payment-card">
                    <div className="payment-grid">
                      <label className="payment-field">
                        <span>Mobile Money Network</span>
                        <select value={mobileNetwork} onChange={(event) => setMobileNetwork(event.target.value)}>
                          {MOBILE_NETWORKS.map((network) => (
                            <option key={network.value} value={network.value}>
                              {network.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="payment-field">
                        <span>Mobile Money Number</span>
                        <input
                          type="tel"
                          value={mobileNumber}
                          onChange={(event) => setMobileNumber(event.target.value)}
                          placeholder="024 XXX XXXX"
                          autoComplete="tel"
                        />
                      </label>
                    </div>

                    <p className="payment-card__note">
                      Paystack will send the authorization prompt to this number during checkout.
                    </p>
                  </div>
                ) : (
                  <div className="payment-card">
                    <p className="payment-card__note">
                      Card details are collected securely by Paystack after you click Pay.
                    </p>
                  </div>
                )}

                <label className="payment-check">
                  <input
                    type="checkbox"
                    checked={agreeToTerms}
                    onChange={(event) => setAgreeToTerms(event.target.checked)}
                  />
                  <span>I confirm that my order details and delivery address are correct.</span>
                </label>

                {error ? <p className="payment-error">{error}</p> : null}

                <button type="submit" className="payment-submit" disabled={!canSubmit}>
                  {isSubmitting || processing ? "Processing Payment" : `Pay ${summaryAmount} Securely`}
                </button>
              </form>
            </section>
            </section>
          </div>

          {false ? (
            <aside className="payment-summary payment-summary--topup">
              <div className="payment-summary__header">
                <p>Shipping balance</p>
                <strong>{paymentIntent?.productName || targetOrder?.orderNumber || "Top-up"}</strong>
              </div>

              <div className="payment-summary__rows">
                <div className="payment-summary__row">
                  <span>Order Number</span>
                  <strong>{targetOrder?.orderNumber ?? paymentIntent?.orderNumber ?? "Pending"}</strong>
                </div>
                <div className="payment-summary__row">
                  <span>Remaining Balance</span>
                  <strong>{formatGhanaCedis(summaryTotal)}</strong>
                </div>
              </div>

              <div className="payment-summary__address">
                <p>Why you’re paying</p>
                <div>
                  <strong>Shipping fee updated</strong>
                  <span>
                    {paymentIntent?.productName
                      ? `The shipping fee for ${paymentIntent.productName} changed after your order was placed.`
                      : "Your order needs a shipping fee top-up before delivery can continue."}
                  </span>
                </div>
              </div>

              <p className="payment-summary__note">
                Tap Pay to settle only the remaining shipping balance.
              </p>
            </aside>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function PaymentStatusPage({
  variant = "pending",
  cartItems = [],
  orders = [],
  ordersLoading = false,
  ordersError = "",
  authUser = null,
  onUpdateOrder = () => {},
  onClearCart = () => {},
}) {
  const guestResetRequestRef = useRef("");
  const navigate = useNavigate();
  const location = useLocation();
  const session = useMemo(() => loadPaymentSession(authUser?.id), [authUser?.id, location.pathname, location.search]);
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const reference = clean(query.get("reference") ?? query.get("trxref") ?? session?.paymentReference);
  const paymentPurpose = session?.paymentPurpose ?? "order";
  const checkoutOwnerKey =
    clean(session?.ownerUserId) ||
    clean(authUser?.id) ||
    clean(location.state?.guestCheckoutEmail) ||
    clean(location.state?.guestCheckoutOwnerKey);

  const activeOrder = useMemo(
    () =>
      orders.find((order) => order.id === session?.orderId) ??
      orders.find((order) => order.orderNumber === session?.orderNumber) ??
      orders.find((order) => clean(order.paymentReference).toLowerCase() === reference.toLowerCase()) ??
      null,
    [orders, reference, session?.orderId, session?.orderNumber],
  );

  const [resolvedVariant, setResolvedVariant] = useState(
    session?.status === "successful" && variant === "success"
      ? "success"
      : session?.status === "failed" && variant === "failed"
        ? "failed"
        : variant,
  );
  const [verificationState, setVerificationState] = useState(
    session?.status === "successful" && variant === "success"
      ? "success"
      : session?.status === "failed" && variant === "failed"
        ? "failed"
        : "idle",
  );
  const [verificationError, setVerificationError] = useState("");
  const [guestCredentials, setGuestCredentials] = useState(null);
  const [guestMessage, setGuestMessage] = useState("");
  const [receiptRecord, setReceiptRecord] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  const amount = receiptRecord?.amountPaid ?? activeOrder?.total ?? session?.amount ?? session?.totals?.totalPrice ?? 0;
  const orderNumber = receiptRecord?.orderNumber ?? activeOrder?.orderNumber ?? session?.orderNumber ?? "ORD-PENDING";
  const paymentReference = reference || session?.paymentReference || receiptRecord?.paymentReference || "PAY-PENDING";
  const methodLabel = receiptRecord?.paymentNetwork
    ? getMobileNetworkLabel(receiptRecord.paymentNetwork)
    : getPaymentMethodLabel(receiptRecord?.paymentMethod ?? session?.paymentMethod ?? "mobile-money");
  const statusLabel =
    resolvedVariant === "success"
      ? paymentPurpose === "shipping-balance"
        ? "Shipping balance paid"
        : "Successful"
      : resolvedVariant === "failed"
        ? "Unsuccessful"
        : "Pending";

  useEffect(() => {
    setResolvedVariant(variant);
  }, [variant]);

  useEffect(() => {
    return undefined;
  }, []);

  useEffect(() => {
    if (!reference || !authUser?.id) {
      setReceiptRecord(null);
      setReceiptError("");
      setReceiptLoading(false);
      return undefined;
    }

    let isMounted = true;
    setReceiptLoading(true);
    setReceiptError("");

    const loadReceipt = async () => {
      const result = await loadPaymentReceipt(reference, { authUser });

      if (!isMounted) {
        return;
      }

      if (result.ok) {
        setReceiptRecord(result.receipt ?? null);
      } else {
        setReceiptRecord(null);
        setReceiptError(result.message || "Unable to load the receipt right now.");
      }

      setReceiptLoading(false);
    };

    void loadReceipt();

    return () => {
      isMounted = false;
    };
  }, [authUser?.id, reference]);

  async function verifyPayment() {
    if (!reference) {
      setVerificationError("No payment reference was found for this checkout.");
      return;
    }

    const tokenResult = authUser ? await getAccessToken() : { ok: true, accessToken: "" };

    if (!tokenResult.ok) {
      setVerificationError(tokenResult.message);
      return;
    }

    try {
      setVerificationError("");
      setVerificationState("loading");
      const result = await verifyPaystackTransaction(reference, { accessToken: tokenResult.accessToken });
      const paystackData = result?.data ?? {};
      const normalizedStatus = clean(paystackData.status).toLowerCase();
      const serverOrder = result?.order ?? null;
      const serverPayment = result?.payment ?? null;
      const guestAccountCreated = Boolean(result?.accountCreated);
      const existingGuestAccount = Boolean(result?.existingAccount);
      const guestEmailFromServer = clean(result?.email || serverOrder?.customerEmail || activeOrder?.customerEmail || session?.customerEmail);
      const guestInstructions = clean(result?.instructions || result?.guestMessage || "");

      if (serverOrder && typeof onUpdateOrder === "function") {
        onUpdateOrder(serverOrder.id, serverOrder);
      }

      if (normalizedStatus === "success") {
        if (paymentPurpose !== "shipping-balance") {
          onClearCart();
          clearCheckoutDraft(checkoutOwnerKey);
        }

        if (guestAccountCreated || existingGuestAccount) {
          let setupEmailSent = false;

          if (guestAccountCreated && guestEmailFromServer && guestResetRequestRef.current !== guestEmailFromServer) {
            guestResetRequestRef.current = guestEmailFromServer;
            const redirectTo = `${resolveAppUrl().replace(/\/$/, "")}/account/set-password`;
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(guestEmailFromServer, {
              redirectTo,
            });

            setupEmailSent = !resetError;

            if (resetError) {
              setGuestMessage(
                "Your order was successful, but we could not send the password setup email yet. Please use Forgot Password or contact support.",
              );
            }
          }

          setGuestCredentials({
            email: guestEmailFromServer,
            name: clean(serverOrder?.customerName || activeOrder?.customerName || session?.customerName || ""),
          });
          if (guestAccountCreated && setupEmailSent) {
            setGuestMessage("Your order was successful. We sent a secure password setup email to your inbox.");
          } else if (!guestAccountCreated) {
            setGuestMessage(
              guestInstructions || "An account already exists for this email. Sign in or use Forgot Password to track your order.",
            );
          }
        } else {
          setGuestCredentials(null);
          setGuestMessage(guestInstructions || result?.guestMessage || "");
        }

        savePaymentSession(
          {
            ...(session ?? {}),
            orderId: serverOrder?.id ?? activeOrder?.id ?? session?.orderId,
            orderNumber: serverOrder?.orderNumber ?? activeOrder?.orderNumber ?? session?.orderNumber,
            paymentReference: paymentReference || serverPayment?.paymentReference || session?.paymentReference,
            status: "successful",
            paymentGatewayStatus: normalizedStatus,
            updatedAt: new Date().toISOString(),
          },
          checkoutOwnerKey,
        );

        if (serverPayment && !receiptRecord) {
          setReceiptRecord({
            id: serverPayment.id ?? "",
            orderId: serverPayment.order_id ?? "",
            orderNumber: serverOrder?.orderNumber ?? serverPayment.order_number ?? activeOrder?.orderNumber ?? session?.orderNumber ?? "",
            paymentReference: serverPayment.provider_reference ?? paymentReference,
            paymentMethod: serverPayment.payment_method ?? session?.paymentMethod ?? "mobile-money",
            paymentNetwork: serverPayment.payment_network ?? session?.paymentNetwork ?? "",
            paymentPhoneNumber: serverPayment.payment_phone_number ?? session?.paymentPhoneNumber ?? "",
            paymentStatus: serverPayment.status ?? "successful",
            amountPaid: Number(serverPayment.amount) || summaryTotal,
            currency: serverPayment.currency ?? "GHS",
            itemCount: Array.isArray(serverOrder?.items)
              ? serverOrder.items.length
              : Array.isArray(session?.cartRows)
                ? session.cartRows.length
                : 0,
            orderStatus: serverOrder?.status ?? activeOrder?.status ?? "processing",
            createdAt: serverPayment.created_at ?? new Date().toISOString(),
            updatedAt: serverPayment.updated_at ?? new Date().toISOString(),
            paidAt: serverPayment.paid_at ?? new Date().toISOString(),
          });
        }

        setResolvedVariant("success");
        setVerificationState("success");
        return;
      }

      if (PAYSTACK_PENDING_STATUSES.has(normalizedStatus)) {
        savePaymentSession(
          {
            ...(session ?? {}),
            orderId: serverOrder?.id ?? activeOrder?.id ?? session?.orderId,
            orderNumber: serverOrder?.orderNumber ?? activeOrder?.orderNumber ?? session?.orderNumber,
            paymentReference: paymentReference || serverPayment?.paymentReference || session?.paymentReference,
            status: "pending",
            paymentGatewayStatus: normalizedStatus || "pending",
            updatedAt: new Date().toISOString(),
          },
          checkoutOwnerKey,
        );
        setGuestMessage("");
        setResolvedVariant("pending");
        setVerificationState("pending");
        return;
      }

      savePaymentSession(
        {
          ...(session ?? {}),
          orderId: serverOrder?.id ?? activeOrder?.id ?? session?.orderId,
            orderNumber: serverOrder?.orderNumber ?? activeOrder?.orderNumber ?? session?.orderNumber,
            paymentReference: paymentReference || serverPayment?.paymentReference || session?.paymentReference,
            status: "failed",
            paymentGatewayStatus: normalizedStatus || "failed",
            updatedAt: new Date().toISOString(),
          },
          checkoutOwnerKey,
        );

      setGuestCredentials(null);
      setGuestMessage("");
      setResolvedVariant("failed");
      setVerificationState("failed");
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : "We could not verify this payment right now.");
      setVerificationState("error");
    }
  }

  useEffect(() => {
    if (!reference || variant === "failed") {
      return undefined;
    }

    if (session?.status === "successful" && variant === "success") {
      setResolvedVariant("success");
      setVerificationState("success");
      return undefined;
    }

    if (session?.status === "failed" && variant === "failed") {
      setResolvedVariant("failed");
      setVerificationState("failed");
      return undefined;
    }

    if (verificationState !== "idle") {
      return undefined;
    }

    void verifyPayment();
    return undefined;
  }, [reference, session?.status, variant, verificationState]);

  if (ordersLoading) {
    return (
      <main className="payment-page">
        <div className="payment-shell">
          <PaymentProcessing
            title="Loading orders"
            message="We are fetching your order history from Supabase before showing payment status."
          />
        </div>
      </main>
    );
  }

  if (ordersError) {
    return (
      <main className="payment-page">
        <div className="payment-shell">
          <section className="shipping-empty">
            <h1>Unable to load payment records right now.</h1>
            <p>{ordersError}</p>
          </section>
        </div>
      </main>
    );
  }

  const displayVariant = resolvedVariant;
  const heading =
    displayVariant === "success"
      ? paymentPurpose === "shipping-balance"
        ? "Your shipping balance has been received."
        : "Thank you. Your order has been received."
      : displayVariant === "failed"
        ? "We could not complete your payment."
        : paymentPurpose === "shipping-balance"
          ? "We are waiting for confirmation of your shipping fee payment."
          : "We are waiting for confirmation from your payment provider.";

  const message =
    displayVariant === "success"
      ? paymentPurpose === "shipping-balance"
        ? "Your order has been updated and the remaining shipping balance has been recorded."
        : "Your order has been saved in your history and a receipt is ready."
      : displayVariant === "failed"
        ? "No confirmed payment has been recorded for this order."
        : paymentPurpose === "shipping-balance"
          ? "Please do not pay the balance again while the first transaction is still pending."
          : "Please do not charge the order again while the first transaction is still pending.";

  const handleViewOrder = () => {
    navigate("/profile/orders");
  };

  const handleReceipt = () => {
    navigate(`/receipt/${paymentReference}`);
  };

  const handleContinue = () => {
    navigate("/products");
  };

  const handleGuestNext = () => {
    const guestEmail = clean(
      guestCredentials?.email ||
        session?.customerEmail ||
        activeOrder?.customerEmail ||
        "",
    );
    const guestName = clean(
      guestCredentials?.name ||
        session?.customerName ||
        activeOrder?.customerName ||
        "",
    );

    if (!guestCredentials) {
      navigate("/register/login", {
        state: {
          guestCheckoutEmail: guestEmail,
          guestCheckoutName: guestName,
        },
      });
      return;
    }

    navigate("/register/login", {
      state: {
        guestCheckoutEmail: guestEmail,
        guestCheckoutName: guestName,
      },
    });
  };

  const handleRetry = () => {
    clearPaymentSession(checkoutOwnerKey);
    navigate("/payment", { replace: true });
  };

  return (
    <main className="payment-status-page">
      <div className={`payment-status-card payment-status-card--${displayVariant}`}>
        <div className="payment-status-card__icon" aria-hidden="true">
          <StatusIcon variant={displayVariant} />
        </div>

        <p className="payment-status-card__eyebrow">
          {displayVariant === "success"
            ? "Payment Successful"
            : displayVariant === "failed"
              ? "Payment Unsuccessful"
              : "Payment Pending"}
        </p>

        <h1>{heading}</h1>

        {verificationState === "loading" ? (
          <PaymentProcessing
            title="Processing Payment"
            message="Please do not close or refresh this page while we confirm your transaction."
            amount={amount}
          />
        ) : null}

        <p className="payment-status-card__message">{message}</p>

        {receiptLoading && !receiptRecord ? (
          <PaymentProcessing
            title="Loading receipt"
            message="We are loading your payment record from Supabase."
            amount={amount}
          />
        ) : null}

        {receiptError ? <p className="payment-error">{receiptError}</p> : null}

        <div className="payment-status-card__summary">
          <div>
            <span>Order Number</span>
            <strong>{orderNumber}</strong>
          </div>
          <div>
            <span>Payment Reference</span>
            <strong>{paymentReference}</strong>
          </div>
          <div>
            <span>Amount Paid</span>
            <strong>{formatGhanaCedis(amount)}</strong>
          </div>
          <div>
            <span>Payment Method</span>
            <strong>{methodLabel}</strong>
          </div>
          <div>
            <span>Payment Status</span>
            <strong>{statusLabel}</strong>
          </div>
          <div>
            <span>Order Status</span>
            <strong>{receiptRecord?.orderStatus ?? activeOrder?.status ?? session?.status ?? "pending_payment"}</strong>
          </div>
        </div>

        {verificationError ? <p className="payment-error">{verificationError}</p> : null}

        {guestMessage ? <p className="payment-status-card__message">{guestMessage}</p> : null}

        {displayVariant === "success" && guestCredentials ? (
          <section className="payment-guest-card" aria-label="Guest account details">
            <p className="payment-guest-card__eyebrow">Guest account created</p>
            <h2>Your order is ready to track</h2>
            <div className="payment-guest-card__grid">
              <div>
                <span>Email address</span>
                <strong>{guestCredentials.email}</strong>
              </div>
            </div>
            <p className="payment-guest-card__note">
              Check your email for login or password-reset instructions. You can use the address above to sign in and
              track your order.
            </p>
            <div className="payment-guest-card__actions">
              <button type="button" className="payment-button payment-button--primary" onClick={handleGuestNext}>
                Next
              </button>
            </div>
          </section>
        ) : displayVariant === "success" && guestMessage ? (
          <section className="payment-guest-card" aria-label="Guest account notice">
            <p className="payment-guest-card__eyebrow">Guest checkout update</p>
            <h2>Your order is ready to track</h2>
            <p className="payment-guest-card__note">{guestMessage}</p>
            <div className="payment-guest-card__actions">
              <button type="button" className="payment-button payment-button--primary" onClick={handleGuestNext}>
                Sign in
              </button>
            </div>
          </section>
        ) : null}

        {displayVariant === "pending" ? (
          <div className="payment-status-card__actions">
            <button type="button" className="payment-button payment-button--primary" onClick={verifyPayment} disabled={verificationState === "loading"}>
              Check Payment Status
            </button>
            <button type="button" className="payment-button payment-button--ghost" onClick={handleViewOrder}>
              View Order
            </button>
          </div>
        ) : null}

        {displayVariant === "success" ? (
          <div className="payment-status-card__actions">
            <button type="button" className="payment-button payment-button--primary" onClick={handleViewOrder}>
              View Order
            </button>
            <button type="button" className="payment-button payment-button--ghost" onClick={handleReceipt}>
              Download Receipt
            </button>
            <button type="button" className="payment-button payment-button--ghost" onClick={handleContinue}>
              Continue Shopping
            </button>
          </div>
        ) : null}

        {displayVariant === "failed" ? (
          <div className="payment-status-card__actions">
            <button type="button" className="payment-button payment-button--primary" onClick={handleRetry}>
              Try Again
            </button>
            <button type="button" className="payment-button payment-button--ghost" onClick={handleRetry}>
              Choose Another Method
            </button>
            <Link to="/contact" className="payment-button payment-button--ghost">
              Contact Support
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default PaymentCheckout;
export { PaymentStatusPage };
