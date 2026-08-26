import { migrateMarketplace } from "./migrate.js";
import { seedMarketplaceIfEmpty } from "./seed.js";
import { initPayments } from "../payments/index.js";
import { initMarketplaceV1 } from "./v1/index.js";
import { setOrderNotificationHook } from "./orders.js";
import { onOrderStatusChange } from "./v1/notifications.js";
import { isMarketplaceDemoMode } from "./demo-mode.js";

export function initMarketplace() {
  migrateMarketplace();
  initMarketplaceV1();
  initPayments();
  setOrderNotificationHook(onOrderStatusChange);
  if (isMarketplaceDemoMode()) return seedMarketplaceIfEmpty();
  return { seeded: false, production: process.env.NODE_ENV === "production" };
}
