import {
  getNotificationCategoryLabel,
  getNotificationsForUser,
} from "../Profile/notificationsStorage";
import { isDeliveredOrder, isInTransitOrder } from "../Profile/ordersStorage";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "GHS",
  currencyDisplay: "symbol",
  maximumFractionDigits: 2,
});

export function formatMoney(value = 0) {
  return moneyFormatter.format(Number(value) || 0);
}

export function formatDateTime(value) {
  if (!value) {
    return "Just now";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatShortDate(value) {
  if (!value) {
    return "Today";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Today";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function getCategoryCounts(products = []) {
  const counts = new Map();

  for (const product of Array.isArray(products) ? products : []) {
    const categoryName = String(product?.category ?? "").trim();

    if (!categoryName) {
      continue;
    }

    counts.set(categoryName, (counts.get(categoryName) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, count]) => ({
      name,
      count,
    }));
}

export function getOrderMetrics(orders = []) {
  const totalRevenue = orders.reduce((sum, order) => sum + (order.total ?? 0), 0);
  const deliveredOrders = orders.filter((order) => isDeliveredOrder(order));
  const inTransitOrders = orders.filter((order) => isInTransitOrder(order));

  return {
    totalOrders: orders.length,
    totalRevenue,
    deliveredOrders: deliveredOrders.length,
    inTransitOrders: inTransitOrders.length,
    averageOrderValue: orders.length > 0 ? totalRevenue / orders.length : 0,
  };
}

export function getNotificationMetrics(notifications = []) {
  const visibleNotifications = getNotificationsForUser(notifications);
  const unreadNotifications = visibleNotifications.filter(
    (notification) => !(notification.isRead ?? notification.read),
  );

  return {
    totalNotifications: visibleNotifications.length,
    unreadNotifications: unreadNotifications.length,
    orderNotifications: visibleNotifications.filter((notification) => notification.category === "orders").length,
    shippingNotifications: visibleNotifications.filter((notification) => notification.category === "shipping").length,
    announcementNotifications: visibleNotifications.filter(
      (notification) => getNotificationCategoryLabel(notification.category) === "Announcement",
    ).length,
  };
}

export function getProductMetrics(products = [], draftProducts = []) {
  const visibleProducts = Array.isArray(products) ? products : [];

  return {
    totalProducts: visibleProducts.length,
    activeProducts: visibleProducts.filter((product) => product.deletedAt == null && product.status === "active").length,
    categoryCount: new Set(visibleProducts.map((product) => product.categorySlug ?? product.category).filter(Boolean)).size,
  };
}

export function getBestSellingProducts(orders = [], products = [], limit = 3) {
  const productIndex = new Map(
    products.map((product) => [
      product.slug ?? product.name,
      product,
    ]),
  );
  const productSales = new Map();

  for (const order of orders) {
    for (const item of order.items ?? []) {
      const key = item.slug || item.name;

      if (!key) {
        continue;
      }

      const quantity = Number(item.quantity) || 0;
      const existing = productSales.get(key) ?? {
        slug: item.slug ?? "",
        name: item.name ?? "Unnamed product",
        brand: item.brand ?? "",
        image: item.image ?? "",
        imageClassName: item.imageClassName ?? "",
        price: Number(item.price) || 0,
        quantity: 0,
      };

      const product = productIndex.get(key);

      productSales.set(key, {
        ...existing,
        slug: product?.slug ?? existing.slug,
        name: product?.name ?? existing.name,
        brand: product?.brand ?? existing.brand,
        image: product?.image ?? existing.image,
        imageClassName: product?.imageClassName ?? existing.imageClassName,
        price: product?.price ?? existing.price,
        quantity: existing.quantity + quantity,
      });
    }
  }

  return [...productSales.values()]
    .sort((left, right) => right.quantity - left.quantity || left.name.localeCompare(right.name))
    .slice(0, limit);
}

export function getRecentNotifications(notifications = [], limit = 4) {
  return [...notifications]
    .sort((left, right) => new Date(right.createdAt ?? 0) - new Date(left.createdAt ?? 0))
    .slice(0, limit);
}

export function getShipmentMetrics(orders = []) {
  const deliveredOrders = orders.filter((order) => isDeliveredOrder(order));
  const inTransitOrders = orders.filter((order) => isInTransitOrder(order));
  const latestOrder = getRecentOrders(orders, 1)[0] ?? null;

  return {
    totalShipments: orders.length,
    deliveredShipments: deliveredOrders.length,
    inTransitShipments: inTransitOrders.length,
    latestShipment: latestOrder,
  };
}

export function getRecentOrders(orders = [], limit = 4) {
  return [...orders]
    .sort((left, right) => new Date(right.createdAt ?? 0) - new Date(left.createdAt ?? 0))
    .slice(0, limit);
}
