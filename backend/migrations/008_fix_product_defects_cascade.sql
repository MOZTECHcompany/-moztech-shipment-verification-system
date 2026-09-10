-- Add ON DELETE CASCADE to product_defects foreign key
ALTER TABLE product_defects
DROP CONSTRAINT product_defects_order_id_fkey,
ADD CONSTRAINT product_defects_order_id_fkey
    FOREIGN KEY (order_id)
    REFERENCES orders(id)
    ON DELETE CASCADE;
