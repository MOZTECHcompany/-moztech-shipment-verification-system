# Corely AI ECOUNT 箱號助手（測試預覽）

實際 ECOUNT 全流程驗收與使用者 Chrome 安裝尚未完成，正式自動寫回未啟用。套件建置或隔離 fixture 通過不代表已開通。

公司操作電腦上的 Chrome Manifest V3 擴充套件。WMS 頁面以現有登入呼叫公司 API；擴充套件只操作使用者主動綁定的 ECOUNT 分頁。ECOUNT 登入維持在瀏覽器中，不讀取或傳送密碼、Cookie、登入憑證或含 session 的網址。

## 現在的執行邊界

- 正式包只允許兩個已部署 WMS 網址的 `/settings/ecount-assistant` 與 `https://loginib.ecount.com/ec56/view/erp`。
- 為支援從工作台透過 React Router 進入助手頁，橋接腳本會隨 WMS 網站載入；每次要求、回覆及背景操作仍重新驗證助手路徑，在其他頁面保持不動作。
- 使用者先開啟 WMS 助手頁並連線，再在 ECOUNT 原銷貨單分頁按擴充套件「綁定目前分頁」。同時綁定 WMS 操作人員、分頁及 document identity。
- MV3 worker 閒置重啟時，僅從 `storage.session` 恢復無憑證的 controller 識別資料；每次仍核對 Chrome sender 的 origin、documentId、nonce 與綁定人員。人員切換、頁面重新載入或關閉會清除。未儲存的 preview 不復原成可寫入工作，SAVE 不自動重送。
- 每次注入 ERP 前重新讀取目前綁定，比對操作人員、兩個原生 documentId、nonce 與本次綁定識別；注入後也再次核對，避免交回舊綁定的資料。執行中不可由 popup 重新綁定、解除或重驗公司，以免啟動第二個 writer；已送出的 ERP 儲存不能撤回，未知結果仍只可讀回確認。
- TEST 公司識別由伺服器明確設定公司代碼、公司名稱與統編。先開 ECOUNT「公司基本資訊」，由 popup 主動讀取可見公司名與唯讀統編，匹配唯一設定後綁定 Chrome 原生 documentId；任何分頁重新載入或登出均需重新確認，不從待辦工作猜公司代碼。
- 不使用 ECOUNT 內部 HTTP API、不呼叫 SaveSale、不建立新銷貨、不修改原數量、金額、SN 或庫存欄位。
- 預設僅讀取與預覽。正式儲存必須通過伺服器開關及原生並行保護／僅文字修改驗收；用戶端雜湊不能取代原生鎖或 compare-and-set。
- 專用 TEST 單的驗收模式必須另有精確公司＋單號允許清單、伺服器 test permit、可辨識的 TEST 商品與零金額，文字上限 200 字。它不代表正式並行保護已驗收，結果只能是 `test_verified`。
- 現場寫入 adapter 目前進一步限定此次專用 `2026/10/16-2`、TEST 商品 25 件、零金額、無 SN。只編輯 `WMS箱號明細`；遇安全庫存確認或其他對話停止等待，不自動確定或變更批准狀態。
- 暫存草稿、登入過期、同品號多列缺來源列識別、欄位不足、數量/SN 不合、非指定原單、字數超限都停止。不得自動刪除暫存或重建銷貨單。
- 儲存前先留 actor-scoped intent receipt。斷線、逾時或收到不確定結果只能讀回核對，不能第二次按儲存。
- 另保存 form-proof：仍在畫面中的已填欄位不構成儲存證據。必須由正常查詢結果重新開原單、選用 WMS 格式，讀回新的原單內容才可確認；無法重開時維持待確認。
- 切換格式也會重建 modal，所以新的 form ID 本身不是資料庫讀回證據。重新核對公司後的新 Chrome document 僅提供一次讀回機會；已讀過的畫面不能反覆沿用 freshness 證據。
- 只有已確認沒有舊 receipt、且尚未開始保存 intent 的拒絕，才能回報 `not_attempted / saveAttempted:false`；任何舊紀錄或未知結果都不得用錯誤代碼推定「沒儲存過」。

`src/dom-adapter.mjs` 的正式 DOM 讀寫只可在實際公司表單結構已核實後啟用。診斷成功不等於完整原單可讀，更不等於正式寫回已完成。隔離 fixture 的原生 CAS 測試只證明引擎契約，不證明 ECOUNT 提供此能力。

目前現場 adapter 可讀已開啟的指定原單，或嘗試點選已可見且唯一符合的銷貨查詢日期連結，再選用「WMS箱號出貨對照」格式。未驗證任意頁面起始的跨訂單全自動定位；普通 UI 事件未觸發開啟時明確停止。實際序號格非空或同品號多列時停止，不能把序號摘要推測成完整 SN。這些限制與正式儲存尚未驗收的狀態均保持可見，不能當作「全部訂單自動回寫已上線」。

## 測試與打包

```sh
npm --prefix tools/ecount-browser-assistant test
node tools/ecount-browser-assistant/package.mjs --output /absolute/path/to/artifacts
```

輸出獨立資料夾、ZIP 及 SHA-256；沒有外部套件或遠端腳本。不要把測試包當作正式包安裝。

需要瀏覽器 loopback 隔離測試時，必須明確提供單一測試 origin：

```sh
node tools/ecount-browser-assistant/package.mjs --output /absolute/path/to/artifacts --loopback-test --loopback-origin http://127.0.0.1:55780
```

這會產生另一個標記為「隔離測試」的套件，loopback 權限及測試 origin 只存在輸出包。正式來源 manifest 不含 localhost 或 `<all_urls>`。

要使用本機 WMS 測試控制頁，對真實 ECOUNT 的明確指定 TEST 單驗收，必須另用不同旗標：

```sh
node tools/ecount-browser-assistant/package.mjs --output /absolute/path/to/artifacts --real-ecount-test --loopback-origin http://127.0.0.1:55780
```

輸出「真實 ECOUNT 指定測試單」包：WMS 僅接受上述完整 loopback origin，ERP 維持 `https://loginib.ecount.com`；不匹配正式 WMS。Chrome 權限格式不區分 localhost 埠，因此 runtime 再核對指定埠。此模式與 `--loopback-test` 互斥，所有 TEST 單、200 字、零金額與單次儲存限制不變。建立套件不等於安裝或驗收，安裝仍需當次確認。

安裝／啟用前，操作人員需確認 Chrome 的擴充功能管理原則。在指定公司操作電腦開啟 `chrome://extensions`、開發人員模式、「載入未封裝項目」，選擇產出的正式包資料夾。不要安裝未驗證來源或將 ECOUNT 登入資訊輸入擴充套件。

## 頁面橋接協定 v1

`window.postMessage` 必須同源、同一 window、固定 channel `corely.ecount-assistant.v1`、32 位十六進位 nonce、UUID requestId。要求方向為 `page-to-extension`，回覆方向 `extension-to-page`、type `RESULT`、同 nonce/requestId；不接受 iframe、外部視窗或任意 URL/腳本。

- `HELLO {actorId,actorLabel,companyMappings?}` → `{protocolVersion:1,mode:'preview',saveEnabled:false}`；公司對照僅由 WMS TEST 設定傳入，不含登入資訊。
- `PING {}` → `{protocolVersion:1}`
- `GET_CAPABILITIES {}` → `{bound,mode,saveEnabled,capabilities?,blockers?}`
- `READ_DOCUMENT {companyCode,voucherNumber}` → `{before,capabilities}`
- `PREVIEW_PLAN {jobId,plan,planFingerprint}` → `{before,capabilities,preview}`
- `SAVE_PLAN {jobId,planFingerprint,permit}` → `{outcome,after?,errorCode?,recovered?}`
- `READ_BACK {jobId,planFingerprint,plan}` → 只讀回核對，沒有 save。worker 重啟時可由原 plan 及本機 receipt 恢復。

`permit` 為 WMS 伺服器已批准計畫的短效許可：`saveAllowed,testSaveAllowed,mode,testWriteEnabled,companyCode,voucherNumber,jobId,planFingerprint,expiresAt`。測試許可不等於正式能力。WMS JWT 不可放入任何橋接要求。

快照 schema、plan 與雜湊必須對齊 `backend/src/services/ecountBrowserContract.js`。metadata 為伺服器產出的完整欄位值；保留原備註，只替換自己訂單的 `[CORELY-WMS:{orderId}]…[/CORELY-WMS:{orderId}]` 區塊。
