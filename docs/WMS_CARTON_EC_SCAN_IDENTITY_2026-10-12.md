# EC 半自動箱出貨與無國條商品

本分支基於已核對 DEV 程式 `d54fa09a78b77e5b1de4abb0b728cd61412f1b1d`，並保留 1Shop 完整來源 SKU、團組資訊、原訂單金額與四項來源身分。正式 `main` 為 `372dd5a8`，兩套歷史 migration 不同；不可把此分支直接覆蓋正式 DB，也不可直接把正式程式的 migration 蓋到現有 DEV DB。本輪使用獨立本機資料庫；沒有部署、移動既有 DEV 流量、操作真實電商訂單或寫入 ECOUNT。

## 人員操作

1. 沿用原商城轉檔頁，選擇店鋪並上傳原始訂單檔。伺服器沿用平台即時核對及 ERP 精確品號對照，不以名稱猜商品。
2. 商品確實沒有國條時，在商品核對區選「無國條：自建內部掃描碼」，填寫 `ITM-` 開頭的內碼。ERP 主檔及來源條碼欄保持空白；不能把 SKU、箱號或 SN 寫成國條。
3. 核對實物與選定的 ECOUNT 品項，保存商品對照。伺服器保存 `internal-scan-v1` 證據及確認人，綁定內碼與單一 ERP 品項。前端勾選或上傳 `internalScanConfirmed: true` 不會取代這份保存的核對。
4. 沿用原銷貨檔下載、ECOUNT 匯入及已儲存原單回執／理貨單回匯流程。此確認準備 WMS 任務，不再建立一張銷貨或扣第二次 ECOUNT 庫存。
5. 在 WMS 建箱時，箱明細使用同一 ERP 品項、空白 `ean`、該 `internalScanCode` 及實際數量；有 SN 時另列全部實際 SN。箱 QR 保持箱號身分，箱內資料由 WMS 查詢。

已有國條或實物條碼的商品沿用原流程。既有 `physical-scan-v1` 核對的證據形狀及 fingerprint 保持相容。1Shop 已宣告國條前綴的團購 SKU 保留原精確對照規則，不轉成內碼商品。

## 資料與核對

`039_order_item_scan_identity.sql` 新增 `order_items.international_barcode`、`internal_scan_code`、`code_type`、`source_sku`。舊資料預設 `legacy`，不推測舊 `barcode` 是 EAN。新來源明細把 `barcode` 保留為原 WMS 相容掃描鍵，另明確保存國條或內碼；無國條須提供獨立內碼欄，不能由品號自動補值。

逐筆理貨檔支援「內部掃描碼」及「來源SKU」，保留平台、店鋪、商城訂單、來源明細号。保存批次的商品明細、預揀資料及 ECOUNT 原單回匯也保留這些欄位。只有含內碼的批次增加掃描身分欄，既有一般批次下載欄位保持原格式。

核對證據綁定完整來源 SKU、原訂單／明細／数量、商品名、店鋪、平台、來源版本集合及 ECOUNT 品號／名稱／規格。來源或 ERP 條碼變成非空、商品停用、對照歧義、內碼被其他商品占用、核對撤銷或原明細變更時，下載與倉儲放行仍阻擋。Shopify 需全部有效 ProductVariant ID；SHOPLINE／1Shop 使用既有 API 核對的原訂單及商品數量，不虛構 API 明細 ID。

`marketplace_internal_scan_codes` 將一個內碼永久綁定一個 ERP 品項；同一商品的多個來源版本可重新核對，不能把該內碼改綁其他品項。

箱模組在本分支使用 `040_wms_cartons.sql`；保留 `039` 的來源掃描身分欄位與原商城流程。`040` 增加 `carton_serial_binding` 與 `serial_identity_mode`，舊資料預設 `legacy`；只有明確「實際SN」欄位或箱內容綁定才標記 `exact`，不由字元格式猜測來源。箱掃描仍受 `warehouse_hold` 阻擋，必須完成原 ERP 回執／預揀放行。揀貨與裝箱分別要求既有 `picking`／`packing` 階段及指定人員，包含管理員；箱掃描不會代替認領，也不會把 `picked` 直接當作可裝箱。

## 箱出貨對照

`buildCartonShipmentTrace(payload)` 將 `/api/orders/:orderId/carton-shipments` 的分配展平為 XLSX 表格資料。有 SN 每筆一個 SN、数量 1；無 SN 保存實際分配数量。表格保存箱號、箱內容版本、分配 ID、WMS 工作單、完整來源 SKU／明細、國條／內碼、揀貨與裝箱狀態及解除紀錄。

`batchNumber`、`ecountVouchers` 只能來自已查得的原理貨批次及已核對 ECOUNT 回執。缺少時留空，不能以 WT 工作單號或箱號冒充。已解除分配仍顯示「已解除」供查核。此檔是出貨追溯及核對資料，不能當作新的銷貨匯入檔。

## 驗證及尚待驗收

最後整合後，backend 全部 48 suites／712 tests 通過。箱號真 HTTP 測試使用兩種独立引擎：PGlite 與本機 PostgreSQL 17.10（127.0.0.1:55441，每輪新建隨機合成 DB）；72 項中 70 項通過、0 失敗、2 項跳過。兩項跳過只對應本 EC base 不具備的正式 signed-document schema 的負向單品 SN 驗證；全部正向 EC／箱號測試均執行，不覆蓋或假造本分支缺少的正式 schema。

整合測試涵蓋整箱／尾箱／拆箱、10 筆保留大小寫的實際 SN、同品兩筆來源明細的 6／4 SN 分配、無國條 `ITM-` 身分、完整來源 SKU 與四項來源身分、合成已儲存 ECOUNT 回執的原單關聯、重掃與雙人競爭、未知 COMMIT 回覆、解除及出貨歷史。既有 hold／認領／指定人員門檻均保留；箱 8 加散貨 2 的更正只可撤回散貨，不能減掉已分配或已裝箱的箱內容。原短碼 SN 編輯仍相容，明確實際 SN 不會透過舊編輯改寫大小寫。

證據：`/tmp/carton-ec-port-final-unit-v3.log`（48／712）、`/tmp/carton-ec-port-final-pg-v3.log`（70 通過／2 signed-only 跳過）。Root 的前端整合 399 項測試與 build 已通過；共用箱 UI 在正式來源的完整本機 app 中完成 12 筆瀏覽器驗證（0 page errors、0 外部商務請求）。該畫面驗證不冒充本 EC 分支的完整 Cloud DEV 或外部 ECOUNT 驗收。EC 的額外唯讀商城角色不顯示箱作業入口；後端權限仍為最後依據。

本分支仍以 `d54fa09a78b77e5b1de4abb0b728cd61412f1b1d` 為來源 base；正式 `main` 的 migration 歷史不同。尚未發布到 shared Cloud DEV，未改其 SQL schema／交通或正式 ERP／WMS 資料，也未新增 Cloud SQL instance。既有 migration-validation 曾有正式資料複本，不能當作本輪合成驗收環境。

仍需外箱實體貼紙、掃描器、實際人員與 ECOUNT 回匯作業驗收。上述本機合成測試不代表正式發布或真實出貨完成。
