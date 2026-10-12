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

## 箱出貨對照

`buildCartonShipmentTrace(payload)` 將 `/api/orders/:orderId/carton-shipments` 的分配展平為 XLSX 表格資料。有 SN 每筆一個 SN、数量 1；無 SN 保存實際分配数量。表格保存箱號、箱內容版本、分配 ID、WMS 工作單、完整來源 SKU／明細、國條／內碼、揀貨與裝箱狀態及解除紀錄。

`batchNumber`、`ecountVouchers` 只能來自已查得的原理貨批次及已核對 ECOUNT 回執。缺少時留空，不能以 WT 工作單號或箱號冒充。已解除分配仍顯示「已解除」供查核。此檔是出貨追溯及核對資料，不能當作新的銷貨匯入檔。

## 驗證及尚待驗收

本機 backend 全部 46 suites / 694 tests 通過；frontend 全部 393 tests 通過，再新增人工內碼 UI 的實際選擇／核對 callback 測試，該檔 47 tests 通過。frontend build 通過。測試涵蓋 Shopify、SHOPLINE、1Shop 內碼核對、來源 SKU 與 ERP 品號不同時的明確人工選擇、原 ECOUNT 回執準備 WMS 身分、撤銷及變更阻擋、既有實物條碼相容，以及箱對照展平。

仍需 root 組合箱模組後的獨立 DB 整箱／拆箱／SN／重複掃描整體驗證、DEV 候選瀏覽器驗收、真實外箱貼紙及人員操作驗收；上述測試不代表正式發布或真實出貨驗收完成。
