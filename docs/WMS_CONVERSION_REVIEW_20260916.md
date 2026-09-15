# Marketplace conversion and batch review — 2026-09-16

Scope: the existing isolated WMS checkout, DEV only. Production release remains a separate authorization. No ECOUNT sales or stock mutations are part of this change.

## Operator flow

Marketplace order file → WMS conversion and saved batch → ECOUNT sales import and ERP picking → WMS picking return validation → child work order printing and scan claims → picking and packing checks. ECOUNT owns product management and stock deduction. WMS preserves source order, quantity, money, original SKU, resolved item code and confirmed barcode within each conversion snapshot.

## Changes

- Prominent administrative conversion entry and separate ERP picking return entry.
- Drag/drop upload, dated batch cards, exact store/platform filters, archive/restore, protected permanent deletion with confirmation.
- Prepick/detail opens an on-page preview and scrolls into view; full-batch Excel and printable prepick summary remain independent of pagination. Existing warehouse batch links provide WT work order printing after ERP return.
- Saved sales/prepick downloads are ordinary attachment responses using short-lived HttpOnly, path-scoped download cookies. Tokens do not authenticate other API routes. Current staff role is checked again at download.
- WMS does not create a product catalog. A private ECOUNT reference file is read only when matching source codes; only matching rows are returned. Configure `ECOUNT_REFERENCE_OBJECT` within the environment's existing private `GCS_BUCKET`. Unconfigured environments retain manual confirmation. A configured but unavailable source fails closed. Reference date is visible. Refreshing that file is an explicit operation, not live ECOUNT API synchronization.
- Match the full source SKU against ECOUNT item code and barcode. Preserve leading zeros, case, NEW and suffixes. A unique active match is automatic; inactive/ambiguous matches block sales output. Only eligible order items are validated. Existing batch sales re-downloads use the current reference and block invalid old mappings.
- New operational batch numbers use WMS-; previous TEST- snapshots remain readable.
- Environment label is DEV / 開發環境. Product workflows and role restrictions are shared with production builds. No production deployment is implied.

## Data and acceptance limits

No new database migration accompanies this update. Migration 031 for prior batch management is already on DEV. The proposed product tables/migration 032 were withdrawn before execution following the user's clarification.

ECOUNT reference observed 8,371 distinct item codes, including 1,019 in-use items. Actual Shopify file has 23 eligible SKUs: 22 unique active matches and 1 inactive exact match. `47112992713422` is 秒貼款 and inactive; `4711299271342` is a distinct active item. Do not shorten or replace the original SKU. Saved DEV batch #4 previously used the shorter mapping and must not be uploaded as a correct sales file.

Full real ECOUNT sales → stock deduction → picking return and physical scanner/printer acceptance remain outstanding. Existing synthetic DEV conversion batches are archived, not deleted, to retain traceability; ordinary view uses active batches.

## Store profiles and responsible staff

- Save shared platform/store conversion profiles through the authenticated converter API. Only reusable customer, warehouse, currency/tax and shipping settings are saved; source rows, SKU mappings, batch numbers, dates and per-order release confirmations are excluded.
- Each uploaded file explicitly selects its store. Profiles are filtered by the detected platform. Selecting a profile fills settings without changing product matches or source identifiers.
- User confirmed SHOPLINE bonson(SHOPLINE), ECOUNT customer 00020. This is environment configuration, not a default for every SHOPLINE file.
- New intake snapshots bind handler user ID, account and display name from the verified server login. Client-supplied handler fields are ignored. Identical retries by another user reuse the original creator. Rename and re-download preserve the saved name.
- Existing batches resolve their original created_by account and label this as historical account lookup; no batch data is rewritten. Missing/deleted creators display 未記錄.
- WMS prepick/item Excel, batch details and prepick print display the handler. Draft audit exports label themselves as unsaved drafts.
- ECOUNT sales 承辦人 column remains unchanged pending confirmation of whether ERP also needs it and the actual ECOUNT staff-code mapping. A WMS name or numeric account ID must not be substituted for an ERP staff code.
- Migration 032 adds only marketplace_store_profiles. No WMS product catalog is created.
- Validation: frontend 230, backend 242, isolated PostgreSQL flow 15 passed; frontend build passed (existing large chunk warning).
