# Corely 原生出貨預揀入口

## 範圍與版本

從乾淨 WMS `eca381be9e743e2ad1de043c132c7449c8e40922` 建立獨立 clone 與 `codex/wms-corely-intake-20260923`。保留現有 ERP 統一登入、ECOUNT 回匯、商城批次、預揀、揀貨與裝箱。此次只有本機實作，未推送、部署或修改雲端資料。

Corely 是庫存帳與預留的來源。WMS 接收簽章出貨指示、執行實點與雙重掃碼，不在這個入口寫庫存或建立 ECOUNT 銷貨。

## 入口契約

`POST /api/integrations/erp/workflow/v1/orders/:salesOrderId/dispatch`

沿用 ERP `WmsWorkspaceBridge` 的 RS256：固定 issuer / audience，`sub` 為 ERP actor，`entityId` 為公司，`station=dispatch`、`scope=wms.workspace.command`、method/path/bodyHash 全部逐一比對。path 是掛載點後的 `/orders/:id/dispatch`。JWT 最長 60 秒，ERP 既有簽發為 45 秒；不接受 HS256、過期／未來簽發、query scope 或未簽章內容。

```json
{
  "requestId": "stable-request-id",
  "order": {
    "orderNumber": "SO-20260923-001",
    "brand": "MOZTECH",
    "sourceHash": "64 lowercase hexadecimal characters",
    "items": [{
      "id": "sales-order-line-id",
      "productId": "corely-product-id",
      "sku": "000123",
      "name": "商品",
      "barcode": "4710000000001",
      "quantity": 2,
      "tracked": false,
      "serials": []
    }],
    "reservationReference": {
      "salesOrderId": "same-id-as-path",
      "warehouseId": "corely-warehouse-id",
      "quantitiesByProduct": [{"productId": "corely-product-id", "quantity": 2}]
    }
  }
}
```

`productId` 在有預留證據時必填。依商品合計來源明細數量，與全部 `quantitiesByProduct` 一一核對；不可少列、多列、重複或不同數量。未提供證據的原生訂單可以保存，但一直保持 `warehouse_hold=true`，預揀完成也不可放行。錯誤證據直接拒絕。

同公司／ERP order ID 僅建立一次原生工作單。同 request ID 不能更換訂單或內容；同訂單不同版本不能覆寫。資料庫採 request→order 鎖定順序；交易結果未知時以原請求重試。重試仍檢查現行公司／actor／品牌授權與 WMS 人員角色。

回應兼容 `wms.workspace-command.v1`，保留來源訂單 ID、來源明細 ID、商品、數量、SN、當前揀貨／裝箱進度；`allowedActions=[]`，讓正式揀貨／裝箱繼續走既有 WMS 工作台。額外回傳 `nativeIntakeId`、`wmsOrderId`、`batchId`、`workBarcode`、`reservationAccepted`；ERP 若需要跳轉，須在回應 projection 明確保留，導向 `/corely-intakes/:nativeIntakeId`。

## 倉庫作業

工作台「Corely 出貨預揀」→ 管理員／拋單員列印總表與明細 → 指派預揀人員 → 人員掃商品條碼並登記本次實點 → 預留與全部數量符合後放行 → 掃 WT 工作條碼認領現有揀貨、裝箱作業。

印出總表與完整來源明細、SN 件數提示及 WT 工作條碼；列印動作記錄代表開啟列印作業，不代表實體出紙。實點命令有持久防重回執；未指派人員無法讀取或操作該原生預揀單。對原工作單的數量／品項／SN 修改或作廢會阻擋預揀放行。

## 設定與 migration

- 新 migration：`036_corely_native_intakes.sql`，只有額外表；不改歷史 ECOUNT 回執。
- 既有設定名稱：`ERP_WORKSPACE_COMMANDS_ENABLED`（預設關閉）、`ERP_WORKSPACE_ISSUER`、`ERP_WORKSPACE_AUDIENCE`、`ERP_WORKSPACE_PUBLIC_KEY`。
- `corely_dispatch_grants` 必須明確建立公司＋ERP actor＋品牌→WMS dispatcher/admin/superadmin 的對照。migration 不建立任何帳號或授權，不以姓名或 Email 猜配。此對照與揀货／装箱的 `erp_staff_identities` 分開，不能提升既有倉庫員工權限。
- 部署需 ERP 同步提供已確認且不可在拋單期間被取消的預留證據；WMS 不會自行推測 Corely 庫存。

## 驗證

- 原生 HTTP＋真 SQL：PGlite 10 項通過；固定 loopback PostgreSQL 獨立資料庫 10 項通過，涵蓋並發鎖定、重試、回應遺失、撤銷授權、資料／SN／預留不符及預揀 gate。
- 既有 ECOUNT 回匯→預揀→獨立揀貨／裝箱 PostgreSQL 8 項通過。
- 既有 backend 單元 280 項通過；frontend 273 項通過；frontend production build 通過。
- 所有 PostgreSQL 測試使用固定 `127.0.0.1:55441` disposable DB，自動刪除，不讀 `DATABASE_URL` 或雲端帳密。

## 尚未在此範圍完成

- WMS 裝箱完成只代表實裝完成；尚未加入承運交接證據、可靠 outbox／callback、日結核銷或正式 ERP 庫存分錄。
- 此 MVP 一張 Corely 訂單對應一張 WMS 工作單；分批出貨、取消或修改已拋單內容、後補缺失預留證據，需另設受控來源變更契約，不能直接覆寫原始 payload。
- 本機 API／build 驗證不等於 DEV、真實訂單、實體列印／掃碼或人員現場驗收。
