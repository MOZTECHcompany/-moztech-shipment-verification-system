# Carton integration candidate — 2026-10-12

Production base: `372dd5a8c38e9a0ae1fd040385eb5a8d21e41db1`, repository `MOZTECHcompany/-moztech-shipment-verification-system`. Work is isolated on `codex/wms-carton-20261012`. Production remains `corely-wms-signed-import-20261002` with 100% traffic; this branch has not been deployed or merged.

## Result

The existing work-order scanner accepts `CARTON:<cartonId>` and expands a sealed carton into exact units. A quantity-only order can explicitly bind actual SNs from a carton. Non-SN cartons allocate the declared quantity, including products with no EAN using confirmed item code and optional ITM scan identity. Carton management supports draft content editing, ERP JSON import, warehouse confirmation, remaining contents, history and QR printing.

Whole scans require all remaining contents to fit the order; they never silently truncate. Split scans select actual quantities/SNs and, where needed, the exact source order line. Packing verifies the existing allocation without reducing remaining quantity again. Durable command receipts, actor/order/carton revisions, native PostgreSQL locks and independent active-allocation checks protect retries and physical rescans. Picked allocations can be released by warehouse administration with a physical put-back reason; packed units are not silently restocked.

Normal unit scanning remains available for loose goods. Quantity corrections can undo loose units without changing reserved carton contents. Exact vendor SN origin is marked separately from legacy SN, so the old editor cannot uppercase or replace vendor identities. A registered carton SN remains protected; unrelated loose-product changes are not blocked when no active allocation exists. Details and API bodies: [backend contract](../backend/docs/CARTON_DEV_CONTRACT_2026-10-12.md).

The shipment XLSX is a trace file. It preserves WMS document, original ECOUNT vouchers when verified, batch, platform/store/order/line/full SKU, carton revision, quantity, exact SN and pick/pack/release history. It does not generate a sales document or inventory movement. ECOUNT remains the formal inventory authority, with the original sales-document deduction occurring once.

## Evidence

- Carton SQL/API scenarios: 70 passed across disposable PGlite and native PostgreSQL 17 with four independent clients. Cases cover atomic rollback, exact SN binding, source groups, remaining quantities, concurrent allocation/import, duplicate and unknown-commit reconciliation, permissions, release and legacy guards.
- Backend unit checks: 25 suites / 218 tests passed.
- Existing full warehouse regression: 71 passed, including 20 actual browser scenarios and 1,000 unit pick/pack requests on a separate random database. The final narrow guard also passed the HTTP-only regression after its last change.
- Frontend: 160 tests and production build passed. The repository has no configured frontend ESLint entrypoint; no lint pass is claimed.
- Actual full-app local browser: 12 accepted records, including real login, ERP module-generated manifest import/edit/seal, decoded QR input for SN10/non-SN10/vendor2, split6/remaining4, same-allocation pack, exact one-SN-per-row export, delayed lookup/detail races and 390px layout. Zero page errors and zero external business requests. Existing Google font assets were recorded separately.
- Three independently generated/rendered ERP PDF samples decoded all three QR and all three Code128 values. No clipping/overlap was observed at 300dpi. This does not constitute printer or physical scanner acceptance.

The integration workspace retains `artifacts/carton-integration-20261012/` with browser screenshots/JSON, PDF outputs/decode receipt, legacy regression report and deployment preflight. Fixtures are entirely synthetic, use loopback only, create random temporary databases and never consult production connection settings.

## Review and publishing boundary

ERP source is `codex/erp-carton-20261012` at `b10c51c1`, based on approved DEV `5c882235`. EC integration is separately based on current `d54fa09a`; it preserves its source identity, hold, claim, designated actor and ECOUNT receipt rules. Its existing migration numbers differ from production. Do not copy historical migration files between those databases. EC uses 039 scan identity plus 040 cartons; production uses its own existing history plus 040.

No shared Cloud DEV or production service, database or traffic was modified. The existing migration-validation service contains a real restored business snapshot and belongs to another workflow. The current IAM SQL identity lacks CREATEDB/CREATEROLE, so it is not a suitable isolated synthetic target. No new continuously billed SQL instance was created. Provision a reviewed isolated DEV database with restricted runtime access, then apply the branch's own migration manifest. ERP's shared DEV publishing must incorporate current shared work through its designated publisher.

Before production, confirm actual paper sizes, printer, scanner suffix/Enter behavior, full/split boxes, wrong boxes/SNs, duplicate scans and reconciliation against the original ECOUNT sales documents. ECOUNT native WMS/carton expansion is not asserted by this implementation; the bridge uses the existing document import and original-document references. No ECOUNT settings/save/import or stock operation was performed.

After real carton allocations exist, routing traffic back to an older binary alone is unsafe: the old binary does not enforce carton reservation guards. A rollback must suspend affected work orders and reconcile allocations first; retain additive schema and audit records. Returned packed SN/reboxing requires a separate physical custody workflow. Ordinary non-SN barcode scans cannot identify the physical box a unit came from; staff must use carton/split operations for goods removed from registered cartons.

## Reproduction

Run normal backend/frontend checks and `node --test backend/tests/cartonTransactions.test.cjs`. Native PostgreSQL cases opt in with `WMS_CARTON_PG=1` against the dedicated loopback fixture runtime at port 55441. Each suite creates/drops only its own random database.

`backend/tests/carton-browser-server.cjs` requires `WMS_CARTON_LOCAL_DEV=1`, serves a synthetic full API at 127.0.0.1:55452 and closes its disposable database on SIGINT. Start the frontend on 127.0.0.1:55771 with `VITE_API_BASE_URL=http://127.0.0.1:55452` and `VITE_CARTON_SYNTHETIC_DEV=1`. Run `backend/tests/carton-browser-local.cjs` with `WMS_PLAYWRIGHT_MODULE`, optional `WMS_CHROME_EXECUTABLE`, `WMS_CARTON_BROWSER_OUTPUT`, the compiled ERP `WMS_ERP_CARTON_MANIFEST_MODULE`, and `WMS_CARTON_LABEL_DECODE` set to the synthetic evidence paths. These opt-ins do not target an existing Cloud service.
