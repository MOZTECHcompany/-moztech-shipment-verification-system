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
- 匯入回覆增加 `documentType`、`positiveQuantity`、`negativeQuantity`、`signedTotalQuantity`。原有 `totalQuantity` 表示核對件數，維持原正數單的意義。
- 列印與品項 Excel 保留負號。營運 CSV 原「出貨總件數」顯示 ERP 淨數量，新增類型、正數、負數及核對總件數欄；一般正數單的原欄位數值不變。
- ERP 正負單的品項數量由 ERP 新理貨單確定，不在 WMS 的一般數量異動編輯器混改；例外、SN 更換、留言、刪除審核仍保留。

## 驗證與部署界線

所有流程測試使用本機隨機 disposable database、獨立 Chrome 與合成理貨單；沒有把測試單匯入正式站，也沒有修改真實舊訂單或 ERP。

本機 PostgreSQL 為 18.4、Node 為 24；正式 PostgreSQL 為 17、映像及 CI 使用 Node 22。正式 17 的 schema 相容性與候選版本另以 release migration、read-only 檢查及 ready 驗證確認，不將本機版本當作正式版本。

030 只新增欄位與固定預設值，不變更既有數量、狀態、SN、留言、權限或時間。應用啟動不自動執行 migration，發布時使用明確指定 `corely_wms` 的獨立 migration 程序。

回復：保留上一正式 revision。未產生正負單前，可回復原程式並保留新增欄位。正負單開始使用後，舊程式不能正確顯示方向，需使用支援正負數的修正映像；不可直接回退舊畫面繼續處理這些單，更不能刪除欄位或覆蓋資料庫。

## 正式發布結果

於 2026/10/02 17:05 台灣時間 完成發布與正式站唯讀驗證。

- 正式網址：[wms.corely.cc](https://wms.corely.cc)；[Cloud Run 原生網址](https://corely-wms-249593319772.asia-east1.run.app)。
- 專案／服務：`moztech-main-db`／`asia-east1`／`corely-wms`。
- 正式 revision：`corely-wms-signed-import-20261002`，流量 100%。上一 revision `corely-wms-manager-notices-20260930` 保留；其候選 tag 已移除，避免使用忽略正負方向的舊入口。
- 部署程式提交：`e4f3af6b267f64fc3b1f9a9cd1d7450eeca3d90b`；GitHub main 包含此提交及本發布紀錄。
- 封裝來源 SHA256：`d2b1e54b6caf62c09637d8a02582e153004909683ef5eacd2d170bf6889e1bda`。
- Backend image：`asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-backend@sha256:14189af5d4f31ef49096e86bd3effbab2841b694c85407e4c1029ab29dde9eb0`。
- Frontend image：`asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-frontend@sha256:f23b84335fe2cca809fbd066e8a298371359f96b085489cd156432bf59338636`。
- Cloud Build：`fcc76b3f-d9bf-4593-8443-664f3c71859f`，SUCCESS；程式提交的 GitHub CI：`36987093518`，success（Node 22）。
- 正式資料庫 `corely_wms` 在 PostgreSQL 17 僅套用 migration 030；既有訂單、品項皆確認取得 shipment／+1 預設，原業務資料與進度沒有重建。歷史異動減至 0 的品項保留原狀。
- 候選及正式 read-only 檢查確認 signed schema、工作快照正負欄位、管理員分工／審核權限、通知收件及 UTC／台灣時間一致。登入、health、ready 及未登入 API 401 均通過；Cloud Run 僅替換應用映像，IAM、Cloud SQL／附件設定及共用驗收服務未更動。

驗證結果：

- 後端單元 202／202；前端 151／151；Vite build 成功。
- 隔離 PostgreSQL 真實 HTTP 與瀏覽器流程 71／71，其中 20 項為瀏覽器驗收。原有 18 項流程全部保留，新增混合正負匯入／列印／Excel／兩階段核對及同條碼方向選列。
- 另完成 migration replay：既有數量、揀貨／裝箱進度、SN、留言、紀錄與時間保持一致，030 重跑不重複執行。
- 500 次揀貨＋500 次裝箱，單連線池的本機 p95 分別約 18.91／18.18 ms。此為本機測試結果，不能視為正式網路／實體條碼槍效能承諾。
- 真實部署瀏覽器僅以 GET 查核匯入入口、成員表單、中文例外篩選及聲音設定，未將合成單寫入正式資料庫，未新增物流單或操作 ERP／庫存。

本次樣本來源為使用者提供的理貨單圖片；隔離流程使用同欄位／正負數量的合成 XLSX。使用者的實際 ERP 原始檔上傳與現場條碼槍操作，需在正式作業使用時再確認；此處不將模擬檔案測試宣稱為現場實物驗收。

發布查核與截圖位於本機 `artifacts/wms-reversal-20261002`（其名稱沿用前期工作目錄，內容已改為獨立正負單，並未啟用原單匹配）。靜態 `frontend/public/version.json` 是歷史未使用檔案；版本判定請使用上述提交、映像 digest 及即時 Cloud Run traffic。
