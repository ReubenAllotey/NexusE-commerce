import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import { formatMoney, formatShortDate } from "../adminHelpers";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function getCustomerKey(customer = {}) {
  return (
    normalizeKey(customer.customerId) ||
    normalizeKey(customer.email) ||
    normalizeKey(customer.name) ||
    normalizeKey(customer.id)
  );
}

function mapSupabaseProfile(profile = {}) {
  return {
    id: profile.id,
    customerId: profile.id,
    name: profile.full_name || "Customer",
    email: profile.email || "",
    phoneNumber: profile.phone_number || "",
    deliveryPhoneNumber: "",
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
    role: profile.role || "customer",
    accountType: profile.account_type || "member",
    source: "profile",
  };
}

function mapSupabaseAddress(address = {}) {
  return {
    id: address.id,
    customerId: address.user_id,
    customerEmail: address.email_address || "",
    phoneNumber: address.phone_number || "",
    deliveryPhoneNumber: address.phone_number || "",
    addressLabel: address.address_label || "",
    isDefault: Boolean(address.is_default),
    createdAt: address.created_at,
    updatedAt: address.updated_at,
    source: "address",
  };
}

function upsertCustomerOverride(records = [], record = {}) {
  const safeRecords = Array.isArray(records) ? records : [];
  const key = getCustomerKey(record);

  if (!key) {
    return safeRecords;
  }

  const now = new Date().toISOString();
  const nextRecord = {
    customerId: normalizeText(record.customerId || record.id || record.email || record.name),
    name: normalizeText(record.name || "Customer"),
    email: normalizeText(record.email),
    phoneNumber: normalizeText(record.phoneNumber),
    blocked: Boolean(record.blocked),
    deleted: Boolean(record.deleted),
    source: record.source || "admin",
    createdAt: record.createdAt || now,
    updatedAt: now,
  };

  return safeRecords.some((entry) => getCustomerKey(entry) === key)
    ? safeRecords.map((entry) => (getCustomerKey(entry) === key ? { ...entry, ...nextRecord } : entry))
    : [...safeRecords, nextRecord];
}

function removeCustomerOverride(records = [], customer = {}) {
  const key = getCustomerKey(customer);

  if (!key) {
    return Array.isArray(records) ? records : [];
  }

  const safeRecords = Array.isArray(records) ? records : [];
  return safeRecords.some((entry) => getCustomerKey(entry) === key)
    ? safeRecords.map((entry) =>
        getCustomerKey(entry) === key
          ? {
              ...entry,
              deleted: true,
              blocked: false,
              updatedAt: new Date().toISOString(),
          }
          : entry,
      )
    : [
        ...safeRecords,
        {
          customerId: normalizeText(customer.customerId || customer.id || customer.email || customer.name),
          name: normalizeText(customer.name || "Customer"),
          email: normalizeText(customer.email),
          phoneNumber: normalizeText(customer.phoneNumber),
          blocked: false,
          deleted: true,
          source: "admin",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
}

function toggleCustomerBlocked(records = [], customer = {}, blocked = true) {
  return upsertCustomerOverride(records, {
    ...customer,
    blocked,
    deleted: false,
    source: customer.source || "admin",
  });
}

function formatPhoneNumber(value) {
  const phone = normalizeText(value);
  return phone || "Not added";
}

function getOrderCustomerKey(order = {}) {
  return normalizeKey(order.customerId || order.customerEmail || order.customerName);
}

function isCancelledOrder(order = {}) {
  const status = normalizeText(order.status).toLowerCase();
  return status === "cancelled" || status === "canceled";
}

function isSuccessfulPayment(payment = {}) {
  return normalizeText(payment.status).toLowerCase() === "successful";
}

function isOrderPayment(payment = {}) {
  return normalizeText(payment.paymentPurpose || payment.payment_purpose || "order").toLowerCase() === "order";
}

function getOrderAmountDue(order = {}) {
  const amountDueNow = Number(order.amountDueNow);
  const total = Number(order.total);
  return Math.max(Number.isFinite(amountDueNow) && amountDueNow > 0 ? amountDueNow : Number.isFinite(total) ? total : 0, 0);
}

function getOrderPaymentRows(order = {}, paymentRows = []) {
  return (Array.isArray(paymentRows) ? paymentRows : []).filter(
    (payment) => payment.orderId === order.id && isOrderPayment(payment),
  );
}

function getOrderAccounting(order = {}, paymentRows = []) {
  const payments = getOrderPaymentRows(order, paymentRows);
  const paid = payments.filter(isSuccessfulPayment).reduce((sum, payment) => sum + Math.max(Number(payment.amount) || 0, 0), 0);
  const due = getOrderAmountDue(order);

  return {
    due,
    paid: Math.min(paid, due),
    pending: Math.max(due - paid, 0),
    status: paid >= due && due > 0 ? "Paid" : paid > 0 ? "Partially Paid" : "Pending",
  };
}

function getCheckoutGroupKey(order = {}) {
  return normalizeKey(order.checkoutGroupId || order.id);
}

function getCustomerAccounting(orders = [], paymentRows = []) {
  const validOrders = orders.filter((order) => !isCancelledOrder(order));
  const groups = new Map();

  for (const order of validOrders) {
    const key = getCheckoutGroupKey(order);
    const group = groups.get(key) ?? { due: 0, paid: 0, orders: [] };
    group.due += getOrderAmountDue(order);
    group.orders.push(order);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const orderIds = new Set(group.orders.map((order) => order.id).filter(Boolean));
    group.paid = Math.min(
      group.due,
      (Array.isArray(paymentRows) ? paymentRows : [])
        .filter((payment) => orderIds.has(payment.orderId) && isOrderPayment(payment) && isSuccessfulPayment(payment))
        .reduce((sum, payment) => sum + Math.max(Number(payment.amount) || 0, 0), 0),
    );
    group.confirmedOrders = group.orders.filter((order) =>
      group.paid > 0 && (
        normalizeText(order.paymentStatus).toLowerCase() === "paid" ||
        getOrderAccounting(order, paymentRows).paid > 0
      ),
    );
  }

  const totalOrderValue = [...groups.values()].reduce((sum, group) => sum + group.due, 0);
  const amountPaid = [...groups.values()].reduce((sum, group) => sum + group.paid, 0);
  const confirmedOrders = [...groups.values()].flatMap((group) => group.confirmedOrders ?? []);
  const activeOrders = confirmedOrders.filter((order) => {
    const status = normalizeText(order.status).toLowerCase();
    return !["delivered", "completed", "cancelled", "canceled"].includes(status);
  });

  return {
    validOrders,
    totalOrderValue,
    amountPaid,
    pendingAmount: Math.max(totalOrderValue - amountPaid, 0),
    confirmedOrderCount: confirmedOrders.length,
    activeOrderCount: activeOrders.length,
  };
}

function getCustomerStatus(customer) {
  if (customer.orderCount === 0) {
    return "no_active_order";
  }

  if (customer.pendingAmount > 0) {
    return "pending_payment";
  }

  return customer.activeOrderCount > 0 ? "active_order" : "no_active_order";
}

function getCustomerStatusLabel(status) {
  switch (status) {
    case "active_order":
      return "Active Order";
    case "pending_payment":
      return "Pending Payment";
    case "no_active_order":
      return "No Active Order";
    default:
      return "No Active Order";
  }
}

function getCustomerSearchBlob(customer) {
  const orderTerms = customer.orders
    .flatMap((order) => [
      order.orderNumber,
      order.id,
      order.batchNumber,
      order.paymentStatus,
      order.status,
    ])
    .filter(Boolean)
    .join(" ");

  return [
    customer.customerId,
    customer.name,
    customer.email,
    customer.phoneNumber,
    customer.deliveryContactNumber,
    customer.status,
    orderTerms,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getCustomerRows({ users = [], orders = [], payments = [], addresses = [], overrides = [], adminKeys = [] }) {
  const customers = new Map();
  const aliasMap = new Map();
  const adminKeySet = new Set(adminKeys.map(normalizeKey).filter(Boolean));

  const findExisting = (keys) => {
    for (const key of keys) {
      const match = aliasMap.get(key);
      if (match) {
        return match;
      }
    }

    return null;
  };

  const registerCustomer = (candidate = {}) => {
    const keys = [candidate.customerId, candidate.email, candidate.id]
      .map(normalizeKey)
      .filter(Boolean);

    const isAdminProfile = normalizeKey(candidate.role) === "admin";
    const matchesAdminProfile = keys.some((key) => adminKeySet.has(key));

    if (isAdminProfile || matchesAdminProfile) {
      return null;
    }

    if (keys.length === 0 && !candidate.name) {
      return null;
    }

    const existing = findExisting(keys);
    const createdAt = candidate.createdAt || new Date().toISOString();
    const customer =
      existing ?? {
        customerId: normalizeText(candidate.customerId || candidate.id || candidate.email || candidate.name),
        name: normalizeText(candidate.name || "Customer"),
        email: normalizeText(candidate.email),
        phoneNumber: normalizeText(candidate.phoneNumber),
        deliveryPhoneNumber: normalizeText(candidate.deliveryPhoneNumber),
        createdAt,
        updatedAt: candidate.updatedAt || createdAt,
        blocked: Boolean(candidate.blocked),
        deleted: Boolean(candidate.deleted),
        source: candidate.source || "system",
        orders: [],
      };

    if (candidate.customerId && !customer.customerId) {
      customer.customerId = normalizeText(candidate.customerId);
    }

    if (candidate.id && !customer.customerId) {
      customer.customerId = normalizeText(candidate.id);
    }

    if (candidate.name) {
      customer.name = normalizeText(candidate.name);
    }

    if (candidate.email) {
      customer.email = normalizeText(candidate.email);
    }

    if (candidate.phoneNumber) {
      customer.phoneNumber = normalizeText(candidate.phoneNumber);
    }

    if (candidate.deliveryPhoneNumber) {
      customer.deliveryPhoneNumber = normalizeText(candidate.deliveryPhoneNumber);
    }

    if (candidate.blocked != null) {
      customer.blocked = Boolean(candidate.blocked);
    }

    if (candidate.deleted != null) {
      customer.deleted = Boolean(candidate.deleted);
    }

    if (candidate.source) {
      customer.source = candidate.source;
    }

    if (candidate.createdAt && new Date(candidate.createdAt).getTime() < new Date(customer.createdAt ?? candidate.createdAt).getTime()) {
      customer.createdAt = candidate.createdAt;
    }

    if (candidate.updatedAt && new Date(candidate.updatedAt).getTime() > new Date(customer.updatedAt ?? candidate.updatedAt).getTime()) {
      customer.updatedAt = candidate.updatedAt;
    }

    const mergedKeys = [
      customer.customerId,
      customer.email,
      candidate.customerId,
      candidate.email,
      candidate.id,
    ]
      .map(normalizeKey)
      .filter(Boolean);

    const uniqueKeys = [...new Set(mergedKeys)];

    if (uniqueKeys.length > 0) {
      for (const key of uniqueKeys) {
        aliasMap.set(key, customer);
      }

      customers.set(uniqueKeys[0], customer);
    }

    return customer;
  };

  const addressIndex = new Map();

  for (const address of addresses) {
    const phoneNumber = normalizeText(address?.phoneNumber);
    const deliveryPhoneNumber = normalizeText(address?.deliveryPhoneNumber || address?.phoneNumber);

    if (!phoneNumber && !deliveryPhoneNumber) {
      continue;
    }

    const keys = [address?.customerId, address?.customerEmail]
      .map(normalizeKey)
      .filter(Boolean);

    for (const key of keys) {
      if (deliveryPhoneNumber) {
        addressIndex.set(`${key}::delivery`, deliveryPhoneNumber);
      }

      if (phoneNumber) {
        addressIndex.set(key, phoneNumber);
      }
    }
  }

  for (const user of users) {
    const normalizedUserId = normalizeKey(user.id);
    const normalizedUserEmail = normalizeKey(user.email);

    registerCustomer({
      customerId: user.id,
      name: user.name,
      email: user.email,
      phoneNumber:
        normalizeText(user.phoneNumber) ||
        addressIndex.get(normalizedUserId) ||
        addressIndex.get(normalizedUserEmail) ||
        "",
      deliveryPhoneNumber:
        user.deliveryPhoneNumber ||
        addressIndex.get(`${normalizedUserId}::delivery`) ||
        addressIndex.get(`${normalizedUserEmail}::delivery`) ||
        "",
      createdAt: user.createdAt,
      role: user.role,
      source: "user",
    });
  }

  for (const order of orders) {
    const customerKey = getOrderCustomerKey(order);

    if (!customerKey || customerKey === "guest") {
      continue;
    }

    const customer = registerCustomer({
      customerId: order.customerId,
      name: order.customerName,
      email: order.customerEmail,
      source: "order",
      createdAt: order.createdAt,
    });

    if (customer) {
      customer.orders.push(order);
    }
  }

  for (const override of overrides) {
    registerCustomer({
      customerId: override.customerId,
      name: override.name,
      email: override.email,
      phoneNumber: override.phoneNumber,
      role: override.role,
      blocked: override.blocked,
      deleted: override.deleted,
      source: override.source || "admin",
      createdAt: override.createdAt,
      updatedAt: override.updatedAt,
    });
  }

  for (const customer of aliasMap.values()) {
    if (customer.phoneNumber) {
      continue;
    }

    const phoneNumber =
      addressIndex.get(normalizeKey(customer.customerId)) ||
      addressIndex.get(normalizeKey(customer.email)) ||
      "";

    if (phoneNumber) {
      customer.phoneNumber = phoneNumber;
    }
  }

  const uniqueCustomers = [];
  const seen = new Set();

  for (const customer of aliasMap.values()) {
    if (seen.has(customer)) {
      continue;
    }

    seen.add(customer);

    customer.orders = [...customer.orders].sort(
      (left, right) => new Date(right.createdAt ?? 0) - new Date(left.createdAt ?? 0),
    );
    customer.orderCount = customer.orders.length;
    const accounting = getCustomerAccounting(customer.orders, payments);
    customer.activeOrderCount = accounting.activeOrderCount;
    customer.orderCount = accounting.validOrders.length;
    customer.confirmedOrderCount = accounting.confirmedOrderCount;
    customer.totalOrderValue = accounting.totalOrderValue;
    customer.totalAmountSpent = accounting.totalOrderValue;
    customer.amountPaid = accounting.amountPaid;
    customer.pendingAmount = accounting.pendingAmount;
    customer.latestOrder = customer.orders[0] ?? null;
    customer.paymentHistory = payments
      .filter((payment) => customer.orders.some((order) => order.id === payment.orderId) && isOrderPayment(payment))
      .sort((left, right) => new Date(right.paidAt ?? right.createdAt ?? 0) - new Date(left.paidAt ?? left.createdAt ?? 0))
      .map((payment) => ({
        transactionId: payment.providerReference || payment.id,
        orderId: customer.orders.find((order) => order.id === payment.orderId)?.orderNumber || payment.orderId,
        date: payment.paidAt || payment.createdAt,
        amount: Number(payment.amount) || 0,
        status: isSuccessfulPayment(payment) ? "Paid" : normalizeText(payment.status) || "Pending",
      }));
    customer.status = getCustomerStatus(customer);
    customer.deliveryContactNumber = customer.deliveryPhoneNumber || "";
    customer.searchBlob = getCustomerSearchBlob(customer);
    uniqueCustomers.push(customer);
  }

  return uniqueCustomers
    .filter((customer) => !customer.deleted)
    .sort((left, right) => {
      const leftDate = new Date(left.latestOrder?.createdAt ?? left.updatedAt ?? left.createdAt ?? 0).getTime();
      const rightDate = new Date(right.latestOrder?.createdAt ?? right.updatedAt ?? right.createdAt ?? 0).getTime();

      return rightDate - leftDate || left.name.localeCompare(right.name);
    });
}

function getEmptyDraft() {
  return {
    customerId: "",
    name: "",
    email: "",
    phoneNumber: "",
  };
}

function SummaryCard({ title, value, note, tone = "blue" }) {
  return (
    <article className={`admin-orders-stat admin-orders-stat--${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function StatusPill({ status }) {
  return <span className={`admin-customers-pill admin-customers-pill--${status}`}>{getCustomerStatusLabel(status)}</span>;
}

function formatSelectedOptions(item = {}) {
  if (Array.isArray(item.selectedOptions) && item.selectedOptions.length > 0) {
    return item.selectedOptions
      .map((option) => `${option.groupName || "Option"}: ${option.label || option.value || ""}`)
      .filter((value) => value.endsWith(": ") === false)
      .join(" · ");
  }

  return [item.selectedColor && `Color: ${item.selectedColor}`, item.selectedSize && `Size: ${item.selectedSize}`]
    .filter(Boolean)
    .join(" · ");
}

function CustomerOrderCard({ order, payments = [] }) {
  const [expanded, setExpanded] = useState(false);
  const accounting = getOrderAccounting(order, payments);
  const items = Array.isArray(order.items) ? order.items : [];

  return (
    <article className={`admin-customer-order-card${expanded ? " is-expanded" : ""}`}>
      <button type="button" className="admin-customer-order-card__summary" onClick={() => setExpanded((value) => !value)}>
        <span>
          <strong>{order.orderNumber || order.id || "Order"}</strong>
          <small>{formatShortDate(order.createdAt)} · {items.length} product{items.length === 1 ? "" : "s"}</small>
        </span>
        <span className="admin-customer-order-card__totals">
          <strong>{formatMoney(accounting.due)}</strong>
          <small>{accounting.status} · {expanded ? "Hide details" : "View details"}</small>
        </span>
      </button>

      {expanded ? (
        <div className="admin-customer-order-card__body">
          <div className="admin-customer-order-items">
            {items.length > 0 ? items.map((item, index) => {
              const quantity = Math.max(Number(item.quantity) || 1, 1);
              const unitPrice = Number(item.price ?? item.unitPrice) || 0;
              const subtotal = Number(item.lineSubtotal) || unitPrice * quantity;
              const image = item.image || item.imageUrl;
              const options = formatSelectedOptions(item);

              return (
                <div className="admin-customer-order-item" key={item.id || item.key || `${order.id}-${index}`}>
                  <div className="admin-customer-order-item__image">
                    {image ? <img src={image} alt="" /> : <span aria-hidden="true">N</span>}
                  </div>
                  <div className="admin-customer-order-item__content">
                    <strong>{item.name || item.productName || "Unnamed product"}</strong>
                    {options ? <span>{options}</span> : null}
                    <small>Qty {quantity} · Unit {formatMoney(unitPrice)}</small>
                  </div>
                  <strong className="admin-customer-order-item__subtotal">{formatMoney(subtotal)}</strong>
                </div>
              );
            }) : <p className="admin-customers-empty-note">Historical product details are not available for this order.</p>}
          </div>

          <div className="admin-customer-order-card__payment-grid">
            <div><span>Order total</span><strong>{formatMoney(accounting.due)}</strong></div>
            <div><span>Confirmed paid</span><strong>{formatMoney(accounting.paid)}</strong></div>
            <div><span>Pending balance</span><strong>{formatMoney(accounting.pending)}</strong></div>
            <div><span>Payment status</span><strong>{accounting.status}</strong></div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CustomerOrderList({ orders = [], payments = [] }) {
  const validOrders = orders.filter((order) => !isCancelledOrder(order));

  if (validOrders.length === 0) {
    return <p className="admin-customers-empty-note">No valid orders have been placed by this customer.</p>;
  }

  return (
    <div className="admin-customer-orders-list">
      {validOrders.slice(0, 10).map((order) => <CustomerOrderCard key={order.id || order.orderNumber} order={order} payments={payments} />)}
    </div>
  );
}

function getCustomerInitials(customer = {}) {
  const initials = normalizeText(customer.name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return initials || "C";
}

function CustomersPage({ orders = [] }) {
  const session = loadAdminSession();
  const liveOrders = orders;
  const [customerOverrides, setCustomerOverrides] = useState([]);
  const [supabaseProfiles, setSupabaseProfiles] = useState([]);
  const [supabaseAddresses, setSupabaseAddresses] = useState([]);
  const [paymentRows, setPaymentRows] = useState([]);
  const [remoteLoading, setRemoteLoading] = useState(true);
  const [remoteError, setRemoteError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openMenuKey, setOpenMenuKey] = useState("");
  const [activeCustomerKey, setActiveCustomerKey] = useState("");
  const [activeView, setActiveView] = useState("profile");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [draft, setDraft] = useState(getEmptyDraft);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let isMounted = true;

    const loadRemoteCustomers = async () => {
      if (!session) {
        if (isMounted) {
          setSupabaseProfiles([]);
          setSupabaseAddresses([]);
          setRemoteLoading(false);
        }

        return;
      }

      setRemoteLoading(true);
      setRemoteError("");

      try {
        const [profilesResult, addressesResult, paymentsResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, email, phone_number, created_at, updated_at, role, account_type, status")
            .order("created_at", { ascending: false }),
          supabase
            .from("addresses")
            .select("id, user_id, address_label, phone_number, email_address, is_default, created_at, updated_at")
            .order("is_default", { ascending: false })
            .order("created_at", { ascending: true }),
          supabase
            .from("payments")
            .select("id, order_id, payment_purpose, provider_reference, status, amount, paid_at, created_at")
            .order("created_at", { ascending: false }),
        ]);

        if (!isMounted) {
          return;
        }

        if (profilesResult.error) {
          throw profilesResult.error;
        }

        if (addressesResult.error) {
          throw addressesResult.error;
        }

        if (paymentsResult.error) {
          throw paymentsResult.error;
        }

        setSupabaseProfiles((profilesResult.data ?? []).map(mapSupabaseProfile));
        setSupabaseAddresses((addressesResult.data ?? []).map(mapSupabaseAddress));
        setPaymentRows((paymentsResult.data ?? []).map((payment) => ({
          ...payment,
          orderId: payment.order_id,
          paymentPurpose: payment.payment_purpose,
          providerReference: payment.provider_reference,
          paidAt: payment.paid_at,
          createdAt: payment.created_at,
        })));
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setRemoteError(error?.message || "Unable to load customer data from Supabase.");
        setSupabaseProfiles([]);
        setSupabaseAddresses([]);
        setPaymentRows([]);
      } finally {
        if (isMounted) {
          setRemoteLoading(false);
        }
      }
    };

    void loadRemoteCustomers();

    return () => {
      isMounted = false;
    };
  }, [session]);

  const customers = useMemo(
    () =>
      getCustomerRows({
        users: supabaseProfiles,
        orders: liveOrders,
        payments: paymentRows,
        addresses: supabaseAddresses,
        overrides: customerOverrides,
        adminKeys: supabaseProfiles
          .filter((profile) => normalizeKey(profile.role) === "admin")
          .flatMap((profile) => [profile.id, profile.customerId, profile.email]),
      }),
    [liveOrders, paymentRows, customerOverrides, supabaseAddresses, supabaseProfiles],
  );

  const filteredCustomers = useMemo(() => {
    const term = normalizeKey(searchTerm);

    return customers.filter((customer) => {
      const matchesStatus = statusFilter === "blocked" ? customer.blocked : customer.status === statusFilter;

      if (statusFilter !== "all" && !matchesStatus) {
        return false;
      }

      if (term && !customer.searchBlob.includes(term)) {
        return false;
      }

      return true;
    });
  }, [customers, searchTerm, statusFilter]);

  const summary = useMemo(() => {
    const totalCustomers = customers.length;
    const activeCustomers = customers.filter((customer) => customer.status === "active_order").length;
    const pendingCustomers = customers.filter((customer) => customer.status === "pending_payment").length;
    const noActiveCustomers = customers.filter((customer) => customer.status === "no_active_order").length;
    const blockedCustomers = customers.filter((customer) => customer.blocked).length;

    return {
      totalCustomers,
      activeCustomers,
      pendingCustomers,
      noActiveCustomers,
      blockedCustomers,
    };
  }, [customers]);

  const activeCustomer = useMemo(
    () => customers.find((customer) => getCustomerKey(customer) === activeCustomerKey) ?? null,
    [activeCustomerKey, customers],
  );

  const activeCustomerOrders = activeCustomer?.orders ?? [];
  const activeCustomerPayments = activeCustomer?.paymentHistory ?? [];
  const isTableLoading = remoteLoading && customers.length === 0;

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  const closeMenu = () => setOpenMenuKey("");
  const closeModal = () => {
    setActiveCustomerKey("");
    setActiveView("profile");
    setIsAddModalOpen(false);
    setDraft(getEmptyDraft());
    setFormError("");
    closeMenu();
  };

  const openCustomerView = (customer, view) => {
    setActiveCustomerKey(getCustomerKey(customer));
    setActiveView(view);
    setIsAddModalOpen(false);
    setFormError("");
    closeMenu();
  };

  const openAddCustomer = () => {
    setDraft(getEmptyDraft());
    setFormError("");
    setIsAddModalOpen(true);
    setActiveCustomerKey("");
    setActiveView("profile");
    closeMenu();
  };

  const handleSaveCustomer = (event) => {
    event.preventDefault();

    if (!draft.name.trim()) {
      setFormError("Please add a customer name.");
      return;
    }

    if (!draft.email.trim()) {
      setFormError("Please add a customer email.");
      return;
    }

    setCustomerOverrides((records) =>
      upsertCustomerOverride(records, {
      customerId: draft.customerId.trim() || draft.email.trim(),
      name: draft.name.trim(),
      email: draft.email.trim().toLowerCase(),
      phoneNumber: draft.phoneNumber.trim(),
      blocked: false,
      deleted: false,
      source: "admin",
      }),
    );

    setDraft(getEmptyDraft());
    setFormError("");
    setIsAddModalOpen(false);
  };

  const handleExportCustomers = () => {
    const rowsToExport = filteredCustomers.map((customer) => ({
      customerId: customer.customerId,
      customerName: customer.name,
      email: customer.email,
      phoneNumber: customer.phoneNumber,
      orderCount: customer.orderCount,
      orderNumber: customer.latestOrder?.orderNumber || customer.latestOrder?.id || "",
      totalOrders: customer.confirmedOrderCount,
      totalAmount: customer.amountPaid,
      status: getCustomerStatusLabel(customer.status),
    }));

    const header = [
      "Customer ID",
      "Customer Name",
      "Email",
      "Phone Number",
      "Order Count",
      "Latest Order",
      "Total Orders",
      "Total Amount",
      "Status",
    ];

    const csv = [
      header.join(","),
      ...rowsToExport.map((row) =>
        [
          row.customerId,
          row.customerName,
          row.email,
          row.phoneNumber,
          row.orderCount,
          row.orderNumber,
          row.totalOrders,
          row.totalAmount,
          row.status,
        ]
          .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `customers-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleToggleBlocked = (customer) => {
    const nextBlocked = !customer.blocked;

    if (!window.confirm(nextBlocked ? `Block ${customer.name}? They will remain in the system but be marked as blocked.` : `Unblock ${customer.name}?`)) {
      return;
    }

    setCustomerOverrides((records) => toggleCustomerBlocked(records, customer, nextBlocked));

    if (nextBlocked) {
      setOpenMenuKey("");
    }
  };

  const handleDeleteCustomer = (customer) => {
    const confirmed = window.confirm(`Delete ${customer.name}?`);

    if (!confirmed) {
      return;
    }

    setCustomerOverrides((records) => removeCustomerOverride(records, customer));

    closeMenu();
  };

  const renderCustomerActions = (customer) => {
    const isBlocked = customer.blocked;
    const customerKey = getCustomerKey(customer);
    const isMenuOpen = openMenuKey === customerKey;

    return (
      <div className="admin-customers-table-actions">
        <button
          type="button"
          className="admin-customers-table-actions__view"
          onClick={() => openCustomerView(customer, "profile")}
        >
          View
        </button>
        <div className="admin-customers-action-menu">
          <button
            type="button"
            className="admin-customers-table-actions__more"
            aria-label={`More actions for ${customer.name}`}
            aria-expanded={isMenuOpen}
            onClick={() => setOpenMenuKey(isMenuOpen ? "" : customerKey)}
          >
            <span aria-hidden="true">...</span>
          </button>
          {isMenuOpen ? (
            <div className="admin-customers-action-menu__panel admin-customers-action-menu__panel--right">
              <button type="button" onClick={() => openCustomerView(customer, "profile")}>View Customer</button>
              <button type="button" onClick={() => handleToggleBlocked(customer)}>
                {isBlocked ? "Unblock Customer" : "Block Customer"}
              </button>
              <button type="button" onClick={() => handleDeleteCustomer(customer)}>Delete Customer</button>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderCustomerIdentity = (customer) => (
    <div className="admin-customers-identity">
      <span className="admin-customers-identity__avatar" aria-hidden="true">{getCustomerInitials(customer)}</span>
      <span className="admin-customers-identity__content">
        <strong>{customer.name || "Customer"}</strong>
        <small title={customer.customerId || "N/A"}>
          {customer.customerId ? `ID: ${customer.customerId.slice(0, 8)}...${customer.customerId.slice(-4)}` : "ID not available"}
        </small>
      </span>
    </div>
  );

  return (
    <main className="admin-products-page admin-customers-page">
      <section className="admin-products-shell admin-customers-shell">
        <header className="admin-products-header admin-customers-header">
          <div>
            <p>Admin catalog</p>
            <h1>Customers</h1>
            <span>
              Review customer accounts, recent orders, payment history, and customer status in one place.
            </span>
          </div>

          <div className="admin-products-header__actions">
            <button type="button" className="admin-products-header__button" onClick={openAddCustomer}>
              Add Customers
            </button>
            <button
              type="button"
              className="admin-products-header__button admin-products-header__button--ghost"
              onClick={handleExportCustomers}
            >
              Export Customers
            </button>
          </div>
        </header>

        <section className="admin-orders-summary">
          <SummaryCard
            title="Total Customers"
            value={summary.totalCustomers}
            note="All customers tracked from accounts, orders, and admin additions."
            tone="indigo"
          />
          <SummaryCard
            title="Active"
            value={summary.activeCustomers}
            note="Confirmed orders still being processed or shipped."
            tone="green"
          />
          <SummaryCard
            title="Pending Payment"
            value={summary.pendingCustomers}
            note="Customers awaiting payment confirmation."
            tone="amber"
          />
          <SummaryCard
            title="No Active Order"
            value={summary.noActiveCustomers}
            note="No current unpaid or in-progress order."
            tone="rose"
          />
        </section>

        {remoteError ? <p className="admin-customers-error">{remoteError}</p> : null}

        <section className="admin-products-panel">
          <div className="admin-products-toolbar admin-customers-toolbar">
            <label className="admin-products-search" htmlFor="admin-customers-search">
              <span>Search Customers</span>
              <input
                id="admin-customers-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by name, ID, email, phone, or order number"
              />
            </label>

            <label className="admin-products-filter" htmlFor="admin-customers-status">
              <span>Status</span>
              <select
                id="admin-customers-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">All</option>
                <option value="active_order">Active Order</option>
                <option value="pending_payment">Pending Payment</option>
                <option value="no_active_order">No Active Order</option>
                <option value="blocked">Blocked</option>
              </select>
            </label>
          </div>

          <div className="admin-customers-table-desktop">
            <table className="admin-products-table admin-customers-main-table">
              <thead>
                <tr>
                  <th>Customer Name</th>
                  <th>Email</th>
                  <th>Phone Number</th>
                  <th>Orders</th>
                  <th>Amount Paid</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isTableLoading ? (
                  <tr className="admin-products-empty-row">
                    <td colSpan="7">
                      <div className="admin-products-empty">
                        <h2>Loading customers...</h2>
                        <p>We are loading customer profiles and delivery addresses from Supabase.</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredCustomers.length > 0 ? (
                  filteredCustomers.map((customer) => {
                    return (
                      <tr key={getCustomerKey(customer)} className="admin-products-row">
                        <td>{renderCustomerIdentity(customer)}</td>
                        <td title={customer.email || "Not added"}>
                          <span className="admin-customers-table__truncate">{customer.email || "Not added"}</span>
                        </td>
                        <td>
                          <span className="admin-customers-muted-value">{formatPhoneNumber(customer.phoneNumber)}</span>
                        </td>
                        <td>{customer.confirmedOrderCount}</td>
                        <td>{formatMoney(customer.amountPaid)}</td>
                        <td>
                          <StatusPill status={customer.status} />
                        </td>
                        <td>{renderCustomerActions(customer)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr className="admin-products-empty-row">
                    <td colSpan="7">
                      <div className="admin-products-empty">
                        <h2>No customers found.</h2>
                        <p>Try a different search term or change the status filter.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="admin-customers-table-mobile">
            {isTableLoading ? (
              <div className="admin-products-empty">
                <h2>Loading customers...</h2>
                <p>We are loading customer profiles and delivery addresses from Supabase.</p>
              </div>
            ) : filteredCustomers.length > 0 ? (
              filteredCustomers.map((customer) => (
                <article className="admin-customer-mobile-card" key={getCustomerKey(customer)}>
                  <div className="admin-customer-mobile-card__header">
                    {renderCustomerIdentity(customer)}
                    <StatusPill status={customer.status} />
                  </div>
                  <dl className="admin-customer-mobile-card__details">
                    <div><dt>Email</dt><dd title={customer.email || "Not added"}>{customer.email || "Not added"}</dd></div>
                    <div><dt>Phone Number</dt><dd>{formatPhoneNumber(customer.phoneNumber)}</dd></div>
                    <div><dt>Total Orders</dt><dd>{customer.confirmedOrderCount}</dd></div>
                    <div><dt>Amount Paid</dt><dd>{formatMoney(customer.amountPaid)}</dd></div>
                  </dl>
                  {renderCustomerActions(customer)}
                </article>
              ))
            ) : (
              <div className="admin-products-empty">
                <h2>No customers found.</h2>
                <p>Try a different search term or change the status filter.</p>
              </div>
            )}
          </div>
        </section>
      </section>

      {isAddModalOpen ? (
        <div className="admin-customers-modal" role="dialog" aria-modal="true" aria-label="Add customer form">
          <button
            type="button"
            className="admin-customers-modal__scrim"
            onClick={closeModal}
            aria-label="Close customer form"
          />

          <aside className="admin-customers-modal__panel">
            <header className="admin-customers-modal__header">
              <div>
                <p>Customer form</p>
                <h2>Add Customer</h2>
                <span>Create a new customer record for the admin dashboard.</span>
              </div>
            </header>

            <form className="admin-customers-modal__form" onSubmit={handleSaveCustomer}>
              <div className="admin-customers-modal__grid">
                <label className="admin-customers-modal__field">
                  <span>Customer ID</span>
                  <input
                    type="text"
                    value={draft.customerId}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        customerId: event.target.value,
                      }))
                    }
                    placeholder="Optional customer id"
                  />
                </label>

                <label className="admin-customers-modal__field">
                  <span>Customer Name</span>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Example: Nana Mensah"
                  />
                </label>
              </div>

              <div className="admin-customers-modal__grid">
                <label className="admin-customers-modal__field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    placeholder="customer@example.com"
                  />
                </label>

                <label className="admin-customers-modal__field">
                  <span>Phone Number</span>
                  <input
                    type="tel"
                    value={draft.phoneNumber}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        phoneNumber: event.target.value,
                      }))
                    }
                    placeholder="+233 000 000 000"
                  />
                </label>
              </div>

              {formError ? <p className="admin-customers-modal__error">{formError}</p> : null}

              <div className="admin-customers-modal__actions">
                <button
                  type="button"
                  className="admin-customers-modal__button admin-customers-modal__button--ghost"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-customers-modal__button admin-customers-modal__button--primary"
                >
                  Save Customer
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {activeCustomer ? (
        <div className="admin-customers-modal" role="dialog" aria-modal="true" aria-label="Customer details">
          <button
            type="button"
            className="admin-customers-modal__scrim"
            onClick={closeModal}
            aria-label="Close customer details"
          />

          <aside className="admin-customers-modal__panel admin-customers-modal__panel--wide">
            <header className="admin-customers-modal__header">
              <div>
                <p>Customer details</p>
                <h2>{activeCustomer.name}</h2>
                <span>
                  {activeView === "profile"
                    ? "Customer account information"
                    : activeView === "orders"
                      ? "Recent orders"
                      : "Payment history"}
                </span>
              </div>
              <button type="button" className="admin-customers-modal__close" onClick={closeModal}>
                Close
              </button>
            </header>

            {activeView === "profile" ? (
              <div className="admin-customers-profile">
                <div className="admin-customers-profile__card">
                  <span>Customer ID</span>
                  <strong>{activeCustomer.customerId || "N/A"}</strong>
                </div>
                <div className="admin-customers-profile__card">
                  <span>Email</span>
                  <strong>{activeCustomer.email || "Not added"}</strong>
                </div>
                <div className="admin-customers-profile__card">
                  <span>Phone Number</span>
                  <strong>{formatPhoneNumber(activeCustomer.phoneNumber)}</strong>
                </div>
                {activeCustomer.deliveryContactNumber ? (
                  <div className="admin-customers-profile__card">
                    <span>Delivery Contact</span>
                    <strong>{formatPhoneNumber(activeCustomer.deliveryContactNumber)}</strong>
                  </div>
                ) : null}
                <div className="admin-customers-profile__card">
                  <span>Total Order Value</span>
                  <strong>{formatMoney(activeCustomer.totalOrderValue)}</strong>
                </div>
                <div className="admin-customers-profile__card">
                  <span>Amount Paid</span>
                  <strong>{formatMoney(activeCustomer.amountPaid)}</strong>
                </div>
                <div className="admin-customers-profile__card">
                  <span>Pending Amount</span>
                  <strong>{formatMoney(activeCustomer.pendingAmount)}</strong>
                </div>
                <div className="admin-customers-profile__card">
                  <span>Orders</span>
                  <strong>{activeCustomer.orderCount}</strong>
                </div>
                <div className="admin-customers-profile__card">
                  <span>Status</span>
                  <strong><StatusPill status={activeCustomer.status} /></strong>
                </div>
                <section className="admin-customers-profile__orders">
                  <div className="admin-customers-profile__orders-header">
                    <div>
                      <span>Recent orders</span>
                      <strong>Select an order to view its original products and payment details.</strong>
                    </div>
                    <Link to="/admin/orders" className="admin-customers-modal__button admin-customers-modal__button--ghost">
                      View all orders
                    </Link>
                  </div>
                  <CustomerOrderList orders={activeCustomerOrders} payments={paymentRows} />
                </section>
              </div>
            ) : null}

            {activeView === "orders" ? (
              <div className="admin-customers-modal__table-wrap">
                <CustomerOrderList orders={activeCustomerOrders} payments={paymentRows} />

                <div className="admin-customers-modal__footer">
                  <Link to="/admin/orders" className="admin-customers-modal__button admin-customers-modal__button--ghost">
                    View All Orders
                  </Link>
                </div>
              </div>
            ) : null}

            {activeView === "payments" ? (
              <div className="admin-customers-modal__table-wrap">
                <table className="admin-products-table admin-customers-table">
                  <thead>
                    <tr>
                      <th>Transaction ID</th>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeCustomerPayments.length > 0 ? (
                      activeCustomerPayments.slice(0, 6).map((payment) => (
                        <tr key={payment.transactionId}>
                          <td>{payment.transactionId}</td>
                          <td>{formatShortDate(payment.date)}</td>
                          <td>{formatMoney(payment.amount)}</td>
                          <td>{payment.status}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="admin-products-empty-row">
                        <td colSpan="4">
                          <div className="admin-products-empty">
                            <h2>No payment history yet.</h2>
                            <p>Payment records will appear here after the customer places an order.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </main>
  );
}

export default CustomersPage;
