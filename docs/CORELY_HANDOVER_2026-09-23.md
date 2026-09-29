# Corely 原生交運與 ERP 待核銷回傳

## 整合來源與界線

基底為目前 DEV 對應 `codex/wms-entry-audit-20260923@9a767f3`，整合 native intake `db2c001`。原生 migration 從未部署的 `035_corely_native_intakes.sql` 改為 `036`，保留已在 DEV 套用的 `035_erp_portal_audit.sql` 原檔與 checksum。新增 `037_corely_handover.sql`。此次只在獨立 `codex/wms-handover-20260923` 工作樹實作、測試；未 push、部署或修改雲端資料。

保留新版 ERP-only、dispatcher/admin/viewer 權限、操作人快照及分頁 sessionStorage。原生頁改用分頁登入核對；SSO destination 接受 `/corely-intakes` 與最多 9 位正整數的 `/corely-intakes/:id`。未登入的直接書籤返回 ERP `/warehouse/dispatch`，不根據數字 ID 自動建立票證。ERP 必須驗證原訂單 dispatch intent、公司及目前權限後簽發 destination。

## 作業流程

預留 → 原生入單 → 預揀放行 → 原工作台揀貨／裝箱 → 拋單員或主管在原生預揀單確認本批實際交運。

目前限單倉、非 SN 原生訂單；ECOUNT 來源不可進入此原生交運／ERP 過帳路徑。一張原生工作單可分多次交運，不要求整單 completed。表單帶入原明細及已裝箱、已交運、可交運數量；逐行選本次数量及箱號，填交接證據並明確勾選實物已交付。承運交接需承運商及追蹤號碼或清單編號；自取需簽收編號或交接紀錄。這是人員確認證據，尚未串承運商自動交接驗證。

API 支援一明細分配多箱；目前最小 UI 每一原明細每批填一個箱號，可分批記錄。箱號在同一原生單的不同交運批次不可重用；同一批同箱可放多個原明細。後續若需整箱多品項編輯、跨單合箱或多倉，須另擴充操作介面與契約。

## 資料及交易

- `corely_shipments`：immutable shipment/event UUID、原生工作單、當時交運人員、命令 UUID、請求 hash、交運時間及完整事件。
- `corely_shipment_lines`：immutable 出貨行 UUID、原 WMS item／ERP sales order line／product ID、SKU、實出量。
- `corely_shipment_packages`：原出貨行對箱號／數量。
- `order_items.handed_over_quantity`：累計實交量。資料庫 check 防止已交運量超過已揀／已裝箱；trigger 防止來源識別／數量改写、已交運量回退及作廢。原有掃碼 undo／變更／直接 SQL 皆受保護。
- `corely_handover_outbox`：不可變的完整 wire JSON 與 SHA256；可變的送出狀態、重試、lease、錯誤碼及 ERP 收件回執。

交運依命令→原生單→工作單→商品行的順序鎖定；同一交易建立 shipment／lines／packages、增加實交量、保存事件與 outbox。任何一步失敗全部 rollback。`actor_id + command_id` 唯一；同命令不同內容拒絕。COMMIT 回應遺失時重試原命令返回同一 shipment。相同 SKU 不合併原始行識別。

交運不可就地修改／撤回，不能以庫存釋放代替實體退貨。此切片尚未提供更正或退回 UI；需要後續受控補償事件及 ERP 差異處理。

## 傳送契約

`POST /api/v1/integration/wms/events`；事件 `contractVersion=corely.wms.handover.v1`：

```json
{
  "contractVersion": "corely.wms.handover.v1",
  "eventId": "immutable UUID",
  "entityId": "company",
  "warehouseId": "warehouse",
  "salesOrderId": "source sales order",
  "nativeIntakeId": 1,
  "wmsOrderId": 2,
  "shipmentId": "immutable UUID",
  "sourceHash": "original dispatch sourceHash",
  "occurredAt": "2026-09-23T13:00:00.000Z",
  "handover": { "method": "carrier_collection", "carrier": "carrier", "manifestId": "signed manifest reference", "operatorId": "WMS user id as string" },
  "lines": [{ "shipmentLineId": "immutable UUID", "salesOrderLineId": "original line", "productId": "ERP product", "sku": "000123", "quantity": 60, "packages": [{ "packageId": "BOX-1", "quantity": 60 }] }]
}
```

JWT 為 RS256、至少 2048-bit RSA，45 秒到期；固定 issuer/audience，claims 包含 `scope=wms.shipment.handover`、`entityId`、`method=POST`、`path=/api/v1/integration/wms/events`、`bodyHash=SHA256(實際送出的完整 JSON 字串)`。重試永遠使用保存的相同 wire body，只有 JWT 更新；不跟隨 HTTP redirect。

ERP ACK 必須符合 `{accepted:true,eventId,inboxId,duplicate:boolean}` 且 event ID 相同。這只代表待核銷事件已保存，畫面顯示「ERP 已收件，待核銷」。正式庫存必須由 ERP 人工逐行核銷後過帳。

Outbox 用 `FOR UPDATE SKIP LOCKED` 與 60 秒 lease，故多 worker 不會同時認領；中斷後可恢復。送出 timeout／5xx／429 或錯誤 ACK 保留 retry 並退避；其他 4xx 列 rejected，需要核對後手動排入重試。成功本地交運即回應，ERP 不可用時畫面維持「交運已記錄，回傳待重試」。啟動背景傳送需 Cloud Run 有可持續執行的 CPU／instance 設定；本次未變更雲端設定。

## 設定與驗收

預設不傳送，須明確設定：

- `WMS_HANDOVER_ENABLED=true`
- `WMS_HANDOVER_ERP_URL=https://<trusted ERP>/api/v1/integration/wms/events`
- `WMS_HANDOVER_JWT_ISSUER`、`WMS_HANDOVER_JWT_AUDIENCE`
- `WMS_HANDOVER_PRIVATE_KEY` 或 `WMS_HANDOVER_PRIVATE_KEY_FILE`；ERP 使用對應公鑰。秘密不可寫入 repo。

原生入單既有 `ERP_WORKSPACE_*` 設定及公司／人員／品牌 grants 仍需另外配置。Worker 每 15 秒讀取 due outbox，每次最多 20 筆；程序重啟從持久資料繼續。schema migration 必須明確指定 DEV database，不能讓啟動程序自動改 schema。

本機測試命令：

```sh
node --test backend/tests/corely-native-intake.test.cjs backend/tests/corely-handover.test.cjs
CORELY_HANDOVER_PG_TEST=1 node --test backend/tests/corely-handover.test.cjs
WMS_MARKETPLACE_PG_TEST=1 node --test backend/tests/warehouse-release.pg.test.cjs
npm run test:unit --prefix backend
npm test --prefix frontend
npm run build --prefix frontend
WMS_PLAYWRIGHT_MODULE=/absolute/playwright WMS_CHROME_EXECUTABLE=/absolute/chrome node frontend/tests/corelyHandover.browser.cjs
```

PostgreSQL fixture 僅使用 `127.0.0.1:55441` disposable database，不讀雲端連線。瀏覽器 fixture 使用實際 React 元件、合成 API 與獨立本機 browser context，不是 DEV 或倉庫現場驗收。跨系統實際簽章／收件／ERP逐行過帳及 DEV 實際帳號流程需在雙端整合後另驗收。

本機驗證結果：native＋handover PGlite／HTTP 21 項；handover 真 PostgreSQL 11 項；舊 ECOUNT 回匯／預揀／揀貨／裝箱 PostgreSQL 8 項；後端 285 項、前端 277 項與 frontend build 通過。新瀏覽器 fixture 實測 60＋40 件、COMMIT 回應遺失後 reload 重試原命令、ACK 僅待核銷、桌面與 390px 手機無水平溢出，沒有 page error。測試用 PostgreSQL database 已清理。完整 Jest 中曾有一次既有 httpAuthorization fixture 回 400 而非 403；未改產品驗證邏輯，該測試單獨及完整重跑均通過。新 HTTP fixture 已改用固定生命週期的 loopback server，消除 supertest 臨時 server 並發關閉造成的 socket hang up。
