-- ERP exports are independent warehouse documents. Keep the signed source
-- quantity while using its positive magnitude for existing scan/completion
-- logic. Existing shipment rows retain their current meaning and progress.
ALTER TABLE orders ADD COLUMN document_type VARCHAR(20) NOT NULL DEFAULT 'shipment'
    CHECK (document_type IN ('shipment','reversal','adjustment'));
ALTER TABLE order_items ADD COLUMN quantity_sign SMALLINT NOT NULL DEFAULT 1
    CHECK (quantity_sign IN (-1,1));
