import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import { formatMoney, formatShortDate } from "../adminHelpers";
import { getOrderStatusLabel } from "../../Profile/ordersStorage";

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

function getPaymentStatus(order = {}) {
  return normalizeText(order.paymentStatus).toLowerCase() === "paid" ? "Paid" : "Pending";
}

function getCustomerStatus(customer) {
  if (customer.blocked) {
    return "blocked";
  }

  return customer.activeOrderCount > 0 ? "active" : "inactive";
}

function getCustomerStatusLabel(status) {
  switch (status) {
    case "active":
      return "Active";
    case "inactive":
      return "Inactive";
    case "blocked":
      return "Blocked";
    default:
      return "Inactive";
  }
}

function getCustomerStatusTone(status) {
  switch (status) {
    case "active":
      return "green";
    case "blocked":
      return "rose";
    default:
      return "amber";
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

function getCustomerRows({ users = [], orders = [], addresses = [], overrides = [] }) {
  const customers = new Map();
  const aliasMap = new Map();

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
    customer.activeOrderCount = customer.orders.filter((order) => {
      const status = normalizeText(order.status).toLowerCase();
      return status !== "delivered" && status !== "cancelled" && status !== "canceled";
    }).length;
    customer.totalAmountSpent = customer.orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    customer.latestOrder = customer.orders[0] ?? null;
    customer.paymentHistory = customer.orders.map((order) => ({
      transactionId: order.id || order.orderNumber,
      orderId: order.orderNumber || order.id,
      date: order.createdAt,
      amount: Number(order.total) || 0,
      status: getPaymentStatus(order),
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
    <article className={`admin-customers-metric admin-customers-metric--${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function StatusPill({ status }) {
  return <span className={`admin-customers-pill admin-customers-pill--${status}`}>{getCustomerStatusLabel(status)}</span>;
}

function CustomersPage({ orders = [] }) {
  const session = loadAdminSession();
  const liveOrders = orders;
  const [customerOverrides, setCustomerOverrides] = useState([]);
  const [supabaseProfiles, setSupabaseProfiles] = useState([]);
  const [supabaseAddresses, setSupabaseAddresses] = useState([]);
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
        const [profilesResult, addressesResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, email, phone_number, created_at, updated_at, role, account_type, status")
            .order("created_at", { ascending: false }),
          supabase
            .from("addresses")
            .select("id, user_id, address_label, phone_number, email_address, is_default, created_at, updated_at")
            .order("is_default", { ascending: false })
            .order("created_at", { ascending: true }),
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

        setSupabaseProfiles((profilesResult.data ?? []).map(mapSupabaseProfile));
        setSupabaseAddresses((addressesResult.data ?? []).map(mapSupabaseAddress));
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setRemoteError(error?.message || "Unable to load customer data from Supabase.");
        setSupabaseProfiles([]);
        setSupabaseAddresses([]);
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
        addresses: supabaseAddresses,
        overrides: customerOverrides,
      }),
    [liveOrders, customerOverrides, supabaseAddresses, supabaseProfiles],
  );

  const filteredCustomers = useMemo(() => {
    const term = normalizeKey(searchTerm);

    return customers.filter((customer) => {
      if (statusFilter !== "all" && customer.status !== statusFilter) {
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
    const activeCustomers = customers.filter((customer) => customer.status === "active").length;
    const inactiveCustomers = customers.filter((customer) => customer.status === "inactive").length;
    const blockedCustomers = customers.filter((customer) => customer.status === "blocked").length;

    return {
      totalCustomers,
      activeCustomers,
      inactiveCustomers,
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
      totalAmountSpent: customer.totalAmountSpent,
      status: getCustomerStatusLabel(customer.status),
    }));

    const header = [
      "Customer ID",
      "Customer Name",
      "Email",
      "Phone Number",
      "Order Count",
      "Latest Order",
      "Total Amount Spent",
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
          row.totalAmountSpent,
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
    const nextBlocked = customer.status !== "blocked";
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
            <Link
              to="/admin/dashboard"
              className="admin-products-header__button admin-products-header__button--ghost"
            >
              Back to dashboard
            </Link>
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

        <section className="admin-products-summary">
          <SummaryCard
            title="Total Customers"
            value={summary.totalCustomers}
            note="All customers tracked from accounts, orders, and admin additions."
            tone="indigo"
          />
          <SummaryCard
            title="Active"
            value={summary.activeCustomers}
            note="Customers with active orders."
            tone="green"
          />
          <SummaryCard
            title="Inactive"
            value={summary.inactiveCustomers}
            note="Customers with no active order."
            tone="amber"
          />
          <SummaryCard
            title="Blocked"
            value={summary.blockedCustomers}
            note="Blocked by admin from the customer list."
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
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="blocked">Blocked</option>
              </select>
            </label>
          </div>

          <div className="admin-products-table-wrap">
            <table className="admin-products-table admin-customers-table">
              <thead>
                <tr>
                  <th>Customer ID</th>
                  <th>Customer Name</th>
                  <th>Email</th>
                  <th>Phone Number</th>
                  <th>Orders</th>
                  <th>Total Amount Spent</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isTableLoading ? (
                  <tr className="admin-products-empty-row">
                    <td colSpan="8">
                      <div className="admin-products-empty">
                        <h2>Loading customers...</h2>
                        <p>We are loading customer profiles and delivery addresses from Supabase.</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredCustomers.length > 0 ? (
                  filteredCustomers.map((customer) => {
                    const status = customer.status;
                    const isMenuOpen = openMenuKey === getCustomerKey(customer);

                    return (
                      <tr key={getCustomerKey(customer)} className="admin-products-row">
                        <td>
                          <strong>{customer.customerId || "N/A"}</strong>
                        </td>
                        <td>
                          <strong>{customer.name}</strong>
                          <small>{customer.orderCount} order{customer.orderCount === 1 ? "" : "s"}</small>
                        </td>
                        <td>{customer.email || "Not added"}</td>
                        <td>
                          <strong>{formatPhoneNumber(customer.phoneNumber)}</strong>
                          {customer.deliveryContactNumber ? (
                            <small>Delivery: {formatPhoneNumber(customer.deliveryContactNumber)}</small>
                          ) : null}
                        </td>
                        <td>
                          <strong>{customer.orderCount}</strong>
                          <small>{customer.orderCount === 1 ? "Order" : "Orders"}</small>
                        </td>
                        <td>{formatMoney(customer.totalAmountSpent)}</td>
                        <td>
                          <StatusPill status={status} />
                        </td>
                        <td>
                          <div className="admin-customers-action-group">
                            <div className="admin-customers-action-menu">
                              <button
                                type="button"
                                className="admin-customers-action-button admin-customers-action-button--view"
                                onClick={() =>
                                  setOpenMenuKey(isMenuOpen ? "" : getCustomerKey(customer))
                                }
                              >
                                View
                              </button>

                              {isMenuOpen ? (
                                <div className="admin-customers-action-menu__panel">
                                  <button type="button" onClick={() => openCustomerView(customer, "profile")}>
                                    Profile
                                  </button>
                                  <button type="button" onClick={() => openCustomerView(customer, "orders")}>
                                    Orders
                                  </button>
                                  <button type="button" onClick={() => openCustomerView(customer, "payments")}>
                                    Payment History
                                  </button>
                                </div>
                              ) : null}
                            </div>

                            <button
                              type="button"
                              className={`admin-customers-action-button ${
                                status === "blocked"
                                  ? "admin-customers-action-button--activate"
                                  : "admin-customers-action-button--block"
                              }`}
                              onClick={() => handleToggleBlocked(customer)}
                            >
                              {status === "blocked" ? "Activate" : "Block"}
                            </button>
                            <button
                              type="button"
                              className="admin-customers-action-button admin-customers-action-button--delete"
                              onClick={() => handleDeleteCustomer(customer)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr className="admin-products-empty-row">
                    <td colSpan="8">
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
                  <span>Total Spent</span>
                  <strong>{formatMoney(activeCustomer.totalAmountSpent)}</strong>
                </div>
                <div className="admin-customers-profile__card">
                  <span>Orders</span>
                  <strong>{activeCustomer.orderCount}</strong>
                </div>
                <div className="admin-customers-profile__card">
                  <span>Status</span>
                  <strong>{getCustomerStatusLabel(activeCustomer.status)}</strong>
                </div>
              </div>
            ) : null}

            {activeView === "orders" ? (
              <div className="admin-customers-modal__table-wrap">
                <table className="admin-products-table admin-customers-table">
                  <thead>
                    <tr>
                      <th>Order Id</th>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeCustomerOrders.length > 0 ? (
                      activeCustomerOrders.slice(0, 6).map((order) => (
                        <tr key={order.id}>
                          <td>{order.orderNumber || order.id}</td>
                          <td>{formatShortDate(order.createdAt)}</td>
                          <td>{formatMoney(order.total ?? 0)}</td>
                          <td>{getOrderStatusLabel(order.status)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="admin-products-empty-row">
                        <td colSpan="4">
                          <div className="admin-products-empty">
                            <h2>No recent orders.</h2>
                            <p>This customer has not placed any orders yet.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

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
