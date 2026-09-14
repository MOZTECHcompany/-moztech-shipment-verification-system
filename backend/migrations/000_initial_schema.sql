-- Empty, independent WMS database foundation. No users, passwords, orders or stock.
-- Existing untracked databases must be audited/baselined separately by an operator;
-- the migration runner refuses to adopt them automatically.
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) NOT NULL CHECK (role IN ('superadmin','admin','dispatcher','picker','packer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    voucher_number VARCHAR(255) NOT NULL UNIQUE,
    customer_name VARCHAR(255),
    warehouse VARCHAR(255),
    void_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    picker_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    packer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','picking','picked','packing','completed','voided'))
);

CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_code VARCHAR(255) NOT NULL,
    product_name VARCHAR(255),
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    picked_quantity INTEGER NOT NULL DEFAULT 0 CHECK (picked_quantity >= 0),
    barcode VARCHAR(255),
    packed_quantity INTEGER NOT NULL DEFAULT 0 CHECK (packed_quantity >= 0)
);

CREATE TABLE IF NOT EXISTS order_item_instances (
    id SERIAL PRIMARY KEY,
    order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    serial_number TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','picked','packed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operation_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    item_id INTEGER,
    action_type VARCHAR(50) NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    operation_type VARCHAR(50)
);
