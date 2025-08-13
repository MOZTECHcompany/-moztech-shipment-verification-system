-- Moztech WMS database schema

-- 基礎：使用者
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff')),
  name TEXT NOT NULL
);

-- 訂單主檔
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  voucher_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  order_status TEXT NOT NULL CHECK (order_status IN ('pending','completed')) DEFAULT 'pending'
);

-- 訂單明細
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  picked_quantity INTEGER NOT NULL DEFAULT 0,
  packed_quantity INTEGER NOT NULL DEFAULT 0
);

-- 操作日誌
CREATE TABLE IF NOT EXISTS action_logs (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  quantity_change INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 錯誤日誌
CREATE TABLE IF NOT EXISTS error_logs (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  error_type TEXT NOT NULL,
  scanned_barcode TEXT,
  context TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);