# Carton verification contract (DEV)

Migration `040_wms_cartons.sql` is additive to the confirmed formal WMS source.
The EC DEV branch has a different migration history; migrate each independent
database using its own manifest. Do not overwrite its numbered legacy files.
No endpoint creates an ECOUNT sales document, posts ERP stock, or creates stock.
Draft import and sealing record declared contents and physical verification;
they are not a warehouse receipt or accounting entry.

This EC fork adds 040 after its own 039 scan-identity migration. It retains
the existing ERP receipt/prepick release gate: `warehouse_hold=true` rejects
carton preview/scan. Picking requires `picking` and the assigned picker;
packing requires `packing` and the assigned packer, including admin actors.
Use the existing claim API to move `picked` to `packing`; a carton scan does
not claim the station. The formal fork's signed-document columns are absent
from this EC base; this port does not import their divergent migrations.

## Identities and import

`order_items.serial_identity_mode` defaults to `legacy`. Only the explicit
actual-SN import column or an explicit from-carton binding marks a row `exact`;
character format alone never changes legacy identity. The old short-code editor
remains compatible; exact/registered protections apply to the proposal's
affected barcode lines, so an unrelated loose line can still be corrected.

`cartonId` retains the ERP-generated ID (1–128 characters). QR may contain
`CARTON:<id>` or the raw ID. Legacy comma SN QR resolves only when the complete
exact SN set belongs to one registered carton. It never creates a carton.
`itemCode` is the explicitly confirmed WMS product code (1–255 characters).
`ean` and `internalScanCode` are separate nullable strings; an ITM code or SKU
is not an international barcode. EAN matching uses exact declared identity;
legacy no-EAN lines use exact `itemCode === order.product_code`. A new explicit
order identity cannot be bypassed by the legacy fallback.

`actualSN` preserves case and zeros, has 1–100 printable ASCII characters,
and excludes whitespace, comma and carton prefixes. A line's nonempty SN list
must have exactly `quantity` unique values. One registered SN belongs to one
carton, including after a release. Reboxing and returned shipped serials need
a separate custody workflow. Limits: 100 lines and 1000 SNs per carton;
100 cartons and 10000 SNs per manifest.

`POST /api/cartons` accepts:

```json
{"cartonId":"CTN-example","sourceSystem":"ERP","sourceReference":"batch-id","expectedActorId":1,"seal":false,"lines":[{"itemCode":"CONFIRMED-WMS-CODE","productName":"Example","ean":null,"internalScanCode":"ITM-source-sku","quantity":10,"actualSN":[]}]}
```

`POST /api/cartons/import` accepts `{format:"corely-cartons-v1",sourceSystem?,
sourceReference?,expectedActorId?,cartons:[...]}`. Global provenance defaults
onto each carton; individual provenance can override it. The entire batch is
transactional and always imports as draft. Same ID and exact declared contents
replay the existing carton without resetting its state or remaining contents.
Different contents fail the whole batch. A batch reference is trace metadata,
not a unique import key: different ranges from one ERP batch can be imported.

GET `/api/cartons?q=&limit=` searches ID/item code; GET `/lookup?scanValue=`
resolves QR, GET `/:cartonId` returns detail. PATCH `/:cartonId` takes
`{expectedContentRevision,expectedActorId?,lines}` and only edits an unused
draft. POST `/:cartonId/seal` takes `{expectedContentRevision,expectedActorId?}`.
Contents have an immutable sealed revision/history; `stateRevision` changes
with allocations and packing independently of `contentRevision`.

## Pick, pack and release

POST `/api/orders/:orderId/carton-preview` takes:

```json
{"scanValue":"CARTON:CTN-example","type":"pick","mode":"split","serialPolicy":"from-carton","expectedActorId":2,"selections":[{"lineId":12,"orderItemId":34,"quantity":3,"actualSN":[]}]}
```

`type` is pick/pack, `mode` defaults to whole. Whole takes all remaining contents;
it never silently truncates to order demand. Split selects actual quantities
or exact SNs. Multiple entries can map one carton line onto distinct order
lines. Non-SN duplicate products require explicit order line selections. SNs
can group automatically only by each exact SN's unique existing order owner.
Preview returns full `order/items/instances`, `stateToken`, `expectedState`,
`expectedActorId`, `expectedCartonRevision`, `carton`, `selection`, `allocation`.

`serialPolicy:"from-carton"` explicitly binds actual carton SNs to an untouched
quantity-only order line, then picks them in the same transaction. Existing
unit quantity progress prevents switching tracking mode. Subsequent boxes can
extend a line marked `carton_serial_binding`; existing preassigned serial lines
must still match their exact original SNs. Partial 6 then 4 SNs satisfy demand
10 only after all 10 instances exist and are picked. Globally occupied SNs
block the entire box. Positive imports of registered carton SNs share the SN
lock and cannot race a carton binding. Legacy negative single-item imports
retain their previous direction semantics.

POST `/carton-scan` takes the exact preview input plus UUIDv4 `commandId`,
`expectedState`, `expectedCartonRevision`. Actor ID is mandatory on preview,
scan and release; other writes validate it when provided. Responses use:
`{format:"snapshot-v1",commandId,baseState,stateToken,order,items,instances,
carton,allocation}`. Apply the whole snapshot; the old single-item delta cannot
represent a carton with multiple source lines and serials.

Pick subtracts carton remaining once and records one active allocation per
carton/order. Pack verifies that exact allocation; it does not subtract again
and cannot change selections. Different orders can consume separate splits.
To change a split for the same order, explicitly release its unshipped
allocation and select again. Request UUID receipts prevent transport retries;
the active allocation prevents a new UUID from physically rescanning the box.
Order-first/carton-second row locks, expected revisions and SN advisory locks
protect concurrent scanners. Events publish only after commit. Unknown commit
results require reconciliation with the original command, never a new rescan.

POST `/api/cartons/allocations/:allocationId/release` takes
`{commandId,expectedState,expectedCartonRevision,expectedActorId,reason}`.
Warehouse admins must confirm physical put-back. It restores remaining exactly
once and reverses that allocation's picking progress. Newly bound SN instances
are removed; preassigned instances return to pending. SN ownership remains
with the same carton. Packed allocations cannot be released or silently
restocked. Explicit negative carton scans return `SIGNED_CARTON_REVIEW_REQUIRED`;
the existing single-item positive/negative verification remains available.

Legacy unit operations cannot consume reserved box units, decrement their
progress, replace their SNs, void/delete/change the order, or close a quantity
disposition without dealing with active allocations first. Registered sealed
SNs must use box/split scan even before allocation. Other unboxed SNs and
ordinary loose goods retain unit scanning. A shared product barcode does not
identify which physical box a loose unit came from: staff must use box/split
for goods physically removed from registered non-SN cartons.
Independent negative SN lines retain unit verification without changing carton
contents. Legacy SN editors reject registered carton serials even after release
and explicitly reject manufacturer case-sensitive/punctuated values rather
than passing them through uppercase/deduplication. Existing uppercase generated
SNs remain supported. Historical occupied serials are conservatively blocked;
a negative sales document alone does not prove an old physical unit returned.

GET `/api/orders/:orderId/carton-shipments` uses work-snapshot read permissions
and returns allocation records with immutable identity/source snapshots,
quantity/exact SN and stage. `currentRemainingQuantity` is explicitly current,
not the remaining quantity at dispatch. The reference XLSX is not an ECOUNT
sales import and must not trigger a second stock deduction.

## Verification

`node --test tests/cartonTransactions.test.cjs` uses real PGlite SQL and whole
transactions with a serialized pool. Its Promise.all cases do not prove native
PostgreSQL locking. `WMS_CARTON_PG=1 node --test tests/cartonTransactions.test.cjs`
also uses a random disposable database on fixed loopback port 55441 and a real
four-client PostgreSQL pool; cleanup drops only that database. No production
connection environment is consulted. `tests/cartonFixture.cjs` exports the
reusable synthetic HTTP app and seed helpers for browser/joint ERP acceptance.
