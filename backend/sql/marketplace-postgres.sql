BEGIN;

CREATE TABLE IF NOT EXISTS mk_sellers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  seller_type TEXT DEFAULT 'individual',
  verified INTEGER DEFAULT 0,
  avatar TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  rating_avg DOUBLE PRECISION DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  sales_count INTEGER DEFAULT 0,
  satisfaction_rate DOUBLE PRECISION DEFAULT 100,
  paypal_merchant_id TEXT DEFAULT '',
  paypal_tracking_id TEXT DEFAULT '',
  paypal_onboarding_status TEXT DEFAULT '',
  paypal_payments_receivable INTEGER DEFAULT 0,
  paypal_email_confirmed INTEGER DEFAULT 0,
  paypal_permissions_granted INTEGER DEFAULT 0,
  paypal_connected_at TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mk_listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES mk_sellers(id),
  card_id TEXT,
  title TEXT NOT NULL,
  title_normalized TEXT NOT NULL,
  license_slug TEXT DEFAULT '',
  extension TEXT DEFAULT '',
  card_number TEXT DEFAULT '',
  language TEXT DEFAULT '',
  description TEXT DEFAULT '',
  card_condition TEXT NOT NULL DEFAULT 'NM',
  price DOUBLE PRECISION NOT NULL,
  negotiable INTEGER DEFAULT 0,
  stock INTEGER DEFAULT 1,
  photos TEXT DEFAULT '[]',
  status TEXT DEFAULT 'active',
  views INTEGER DEFAULT 0,
  slug TEXT DEFAULT '',
  seo_title TEXT DEFAULT '',
  seo_description TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mk_orders (
  id TEXT PRIMARY KEY,
  buyer_email TEXT NOT NULL,
  buyer_name TEXT DEFAULT '',
  buyer_id TEXT DEFAULT '',
  seller_id TEXT NOT NULL REFERENCES mk_sellers(id),
  listing_id TEXT NOT NULL REFERENCES mk_listings(id),
  listing_title TEXT DEFAULT '',
  items_json TEXT DEFAULT '[]',
  qty INTEGER DEFAULT 1,
  unit_price DOUBLE PRECISION NOT NULL,
  shipping_cost DOUBLE PRECISION DEFAULT 0,
  shipping_carrier TEXT DEFAULT '',
  total DOUBLE PRECISION NOT NULL,
  status TEXT DEFAULT 'pending',
  payment_status TEXT DEFAULT 'pending',
  payment_method TEXT DEFAULT '',
  payment_provider TEXT DEFAULT '',
  paypal_order_id TEXT DEFAULT '',
  paypal_capture_id TEXT DEFAULT '',
  platform_fee DOUBLE PRECISION DEFAULT 0,
  seller_amount_after_platform_fee DOUBLE PRECISION DEFAULT 0,
  sumup_checkout_id TEXT DEFAULT '',
  sumup_transaction_id TEXT DEFAULT '',
  stripe_session_id TEXT DEFAULT '',
  stripe_payment_intent TEXT DEFAULT '',
  shipping_tracking TEXT DEFAULT '',
  shipping_label_url TEXT DEFAULT '',
  shipping_address TEXT DEFAULT '',
  invoice_number TEXT DEFAULT '',
  vat_rate DOUBLE PRECISION DEFAULT 20,
  vat_amount DOUBLE PRECISION DEFAULT 0,
  dispute_status TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mk_reviews (
  id BIGSERIAL PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES mk_sellers(id),
  order_id TEXT NOT NULL UNIQUE,
  buyer_email TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  comment TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mk_favorites (
  user_id TEXT NOT NULL,
  listing_id TEXT NOT NULL REFERENCES mk_listings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS mk_wishlist (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  card_id TEXT,
  listing_id TEXT,
  note TEXT DEFAULT '',
  target_price DOUBLE PRECISION,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mk_price_alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  card_id TEXT,
  listing_id TEXT,
  target_price DOUBLE PRECISION NOT NULL,
  active INTEGER DEFAULT 1,
  last_notified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mk_cart_items (
  user_id TEXT NOT NULL,
  listing_id TEXT NOT NULL REFERENCES mk_listings(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price DOUBLE PRECISION NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS mk_invoices (
  invoice_number TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  subtotal DOUBLE PRECISION NOT NULL,
  vat_rate DOUBLE PRECISION DEFAULT 20,
  vat_amount DOUBLE PRECISION DEFAULT 0,
  total DOUBLE PRECISION NOT NULL,
  buyer_email TEXT DEFAULT '',
  issued_at TEXT NOT NULL,
  html_snapshot TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS mk_disputes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  buyer_email TEXT DEFAULT '',
  seller_id TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  reason TEXT DEFAULT '',
  resolution TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mk_listings_seller ON mk_listings(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_mk_listings_license ON mk_listings(license_slug, status);
CREATE INDEX IF NOT EXISTS idx_mk_listings_price ON mk_listings(price);
CREATE INDEX IF NOT EXISTS idx_mk_listings_title ON mk_listings(title_normalized);
CREATE INDEX IF NOT EXISTS idx_mk_listings_slug ON mk_listings(slug);
CREATE INDEX IF NOT EXISTS idx_mk_orders_buyer ON mk_orders(buyer_email);
CREATE INDEX IF NOT EXISTS idx_mk_orders_seller ON mk_orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_mk_orders_paypal ON mk_orders(paypal_order_id, paypal_capture_id);
CREATE INDEX IF NOT EXISTS idx_mk_favorites_user ON mk_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_mk_wishlist_user ON mk_wishlist(user_id);
CREATE INDEX IF NOT EXISTS idx_mk_alerts_user ON mk_price_alerts(user_id, active);
CREATE INDEX IF NOT EXISTS idx_mk_cart_user ON mk_cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_mk_disputes_order ON mk_disputes(order_id, status);
CREATE INDEX IF NOT EXISTS idx_mk_invoices_order ON mk_invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_mk_sellers_paypal ON mk_sellers(paypal_merchant_id, paypal_onboarding_status);

COMMIT;
