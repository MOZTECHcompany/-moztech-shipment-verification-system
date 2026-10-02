# ERP 正負理貨單匯入（2026-10-02）

## 現場操作

業務沿用 ERP 理貨單格式，從「出貨管理 → 匯入出貨單」直接匯入。每份檔案依其憑證號碼建立一筆獨立的出貨核對訂單；不用選原單，也不需要額外審核。

- 一般正數單照原流程處理。
- 全負數單顯示「沖正理貨單」。
- 同一張單有正數、負數，顯示「異動理貨單」。例如 `2026/10/02 -27` 的 `4711299274640 × -1`、`4711299274633 × +1`，畫面顯示「新增 1 件／沖正 1 件，共需核對 2 件」。
- 揀貨、裝箱、批次認領及掃碼沿用現有流程。正負品項各自核對；同條碼同時有兩種方向時，選擇對應品項列。合計零不等於完成。
- 原訂單、原本掃碼與留言保持不變；正式銷貨沖正仍由 ERP 處理，WMS 不自動更動庫存／帳務。
- 憑證號碼重複仍會攔截，防止重建任務。數量 0、小數、失真條碼及不完整 SN 仍會提示修正。理貨單最後的列印日期時間仍可忽略。

## 數量及相容性

新增 migration `030_signed_import_quantities.sql`：

- `orders.document_type`：shipment／reversal／adjustment，既有訂單預設 shipment。
- `order_items.quantity_sign`：+1／-1，既有品項預設 +1。
- `quantity` 保留正的核對件數；ERP 數量為 `quantity × quantity_sign`，API 另回傳 `signed_quantity`。掃碼進度、SN 比對、完成判斷以核對件數計算，不能以正負相抵後的淨數判斷。
- 匯入回覆增加 `documentType`、`positiveQuantity`、`negativeQuantity`、`signedTotalQuantity`。原有 `totalQuantity` 表示核對件數，維持原正數单的意義。
- 列印與品項 Excel 保留負號。營運 CSV 原「出貨總件數」顯示 ERP 淨數量，新增類型、正數、負數及核對總件數欄；一般正數單的原欄位數值不變。
- ERP 正負單的品項數量由 ERP 新理貨單確定，不在 WMS 的一般數量異動編輯器混改；例外、SN 更換、留言、刪除審核仍保留。

## 驗證與部署界線

所有流程測試使用本機隨機 disposable database、獨立 Chrome 與合成理貨單；沒有把測試單匯入正式站，也沒有修改真實舊訂單或 ERP。

本機 PostgreSQL 為 18.4、Node 為 24；正式 PostgreSQL 為 17、映像及 CI 使用 Node 22。正式 17 的 schema 相容性與候選版本另以 release migration、read-only 檢查及 ready 驗證確認，不將本機版本當作正式版本。

030 只新增欄位與固定預設值，不變更既有數量、狀態、SN、留言、權限或時間。應用啟動不自動執行 migration，發布時使用明確指定 `corely_wms` 的獨立 migration 程序。

回復：保留上一正式 revision。未產生正負單前，可回復原程式並保留新增欄位。正負單開始使用後，舊程式不能正確顯示方向，需使用支援正負數的修正映像；不可直接回退舊畫面繼續處理這些單，更不能刪除欄位或覆蓋資料庫。

部署 revision／digest／GitHub 提交與最終測試數量於發布後補記。
