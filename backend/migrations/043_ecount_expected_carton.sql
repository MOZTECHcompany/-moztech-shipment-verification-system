ALTER TABLE order_items
    ADD COLUMN expected_carton_id TEXT REFERENCES wms_cartons(carton_id) ON DELETE RESTRICT;
