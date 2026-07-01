import { migrateMarketplace } from "./migrate.js";
import { seedMarketplaceIfEmpty } from "./seed.js";
import { initPayments } from "../payments/index.js";
import { initMarketplaceV1 } from "./v1/index.js";
import { setOrderNotificationHook } from "./orders.js";
import { onOrderStatusChange } from "./v1/notifications.js";

export function initMarketplace() {
  migrateMarketplace();
  initMarketplaceV1();
  initPayments();
  setOrderNotificationHook(onOrderStatusChange);
  return seedMarketplaceIfEmpty();
}
