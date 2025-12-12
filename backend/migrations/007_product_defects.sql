CREATE TABLE IF NOT EXISTS product_defects (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    user_id INTEGER REFERENCES users(id),
    original_sn VARCHAR(255) NOT NULL,
    new_sn VARCHAR(255) NOT NULL,
    product_barcode VARCHAR(255),
    product_name VARCHAR(255),
    reason TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_product_defects_order_id ON product_defects(order_id);
CREATE INDEX idx_product_defects_product_barcode ON product_defects(product_barcode);
CREATE INDEX idx_product_defects_created_at ON product_defects(created_at);
