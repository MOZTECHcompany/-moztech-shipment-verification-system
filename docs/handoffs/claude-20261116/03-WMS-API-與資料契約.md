# WMS API 與資料契約

本文件以 WMS commit `ab835f44ef2d9e855360aa6b01fb9216cd70afed` 為基準。程式路徑與行號對應 ZIP 內 `source/`。正式欄位驗證及回應依程式與測試，串接前先以目前 DEV 的授權身分和合成資料讀回。

## API 應從哪裡進入

| 用途 | 入口與責任 |
| --- | --- |
| 人員操作 | ERP 工作台 `/warehouse/marketplace?entityId=tw-entity-001`。ERP 先驗證身分、公司和儲運權限，再載入原生 WMS SDK。 |
| WMS HTTP 服務 | `https://corely-wms-dev-sp5g377smq-de.a.run.app`。前端 ingress 和 Nginx 在 port 8080，`/api/`、`/socket.io/`、`/health`、`/ready` 代理到同服務 API sidecar port 3001。以下 WMS 路徑以該 origin 為基準，嵌入 ERP 時使用正常 host transport。 |
| 版本與靜態資產 | `GET /workspace-manifest.json` 回 SDK 資產資訊，`GET /assets/<檔名>` 取資產。比對 manifest 的 commit 與每個 JS/CSS 檔 SHA-256，再確認 ERP 工作台實際載入。 |
| 健康與 schema | `GET /health` 表示程序運作；`GET /ready` 檢查 schema 並回 `{status:"ready"}`，停機中或不可用回 503。Express 自身 `GET /` 回 API metadata，Cloud Run 的網站根路由由 Nginx 提供 SPA。 |
| 所有 HTTP 方法／路徑 | [可讀路由表](04-WMS-HTTP-路由索引.md) 與 [可供程式處理的 JSON](WMS-HTTP-路由索引.json)。可搜尋完整位置、handler 註冊行號、直接讀取的 request keys 和可靜態取得的 JSON keys、status。 |

來源為 `backend/src/app.js:137–215`、`frontend/nginx.cloudrun.conf.template:20–52`。環境與控制台網址見 [GitHub 與 GCP 部署位置](02-GitHub-與-GCP-部署位置.md)。

### 認證、請求與錯誤

- 一般業務 HTTP 使用 `Authorization: Bearer <WMS 存取 token>`。WMS 核對 HS256、有效期限與當前身分。ERP session 仍受有效綁定與公司授權限制。請透過 ERP 正常登入取得 session。
- 無 Bearer 通常回 401，簽章或有效期不合回 403，權限查證服務不可用回 503 `AUTH_UNAVAILABLE`。即使通過 JWT，個別路由仍可因角色、管理範圍、指派、來源資料或狀態回 403 或 409。ERP `viewer` 僅能使用允許的查詢清單及當前使用者資料。
- Express 的商城轉檔與倉庫回匯 JSON 上限是 10 MB，箱號路由 2 MB。獨立理貨表匯入走 multipart，另有 10 MiB 檔案上限。不要把 Excel 二進位送到期待 `rows` 的 JSON API。
- 全域回應附 `X-Request-Id`，診斷時提供時間、request ID、revision、HTTP status、業務錯誤碼及去識別批次識別即可。部分預覽的 HTTP 200 內仍帶 `output.ok=false` 或待核對資料。
- 回應 409 時先讀回目前版本及來源核對結果。若收到「結果尚未確認」，先讀流程、訂單快照或命令回執核對結果。同一操作的原樣重試沿用原命令 ID 與相同內容，確實要改內容時才重開命令。特定已退回交易的拒絕仍可能留下稽核記錄。

來源為 `backend/src/middleware/auth.js:11–115`、`backend/src/middleware/erpPortalScope.js:1–23`、`backend/src/middleware/errorHandler.js:20–78`。第三方回呼與短效檔案 cookie 另有各自的驗證契約。


### DEV 唯讀驗證命令

```bash
wms_dev_origin='https://corely-wms-dev-sp5g377smq-de.a.run.app'
curl --fail --silent --show-error "$wms_dev_origin/health"
curl --fail --silent --show-error "$wms_dev_origin/ready"
curl --fail --silent --show-error "$wms_dev_origin/workspace-manifest.json" |
  jq '{sourceCommit, entry, styles, portalStyles}'
```

業務 API 預覽從 ERP 原生頁面執行。開發工具做單元測試時，以公司核准的 session 或測試 fixture 從各自的 transport 輸入驗證資料。先查 `GET /api/auth/me`、店鋪連線及 profile，再從 `POST /api/marketplace-intakes/preview` 帶完整 `rows` 與店鋪設定驗證。前端 **產檔** 前應核對 API 的 `output.ok`、條碼待核對、店鋪及金額。此段的三個 curl 都可作為候選版本或 canonical 的版本檢查基礎。

## 商城轉檔、下載、ECOUNT 回匯及預揀

### API 入口與認證

- ERP DEV 工作台 `/warehouse/marketplace?entityId=tw-entity-001` 由 ERP 掛載 WMS SDK，標準作業應沿既有 ERP 登入與同一個工作台工作階段。WMS 後端在 `/api/marketplace-intakes` 掛載 JSON API，上限 `10mb`。一般需要合法的 WMS Bearer session，`ERP_PORTAL_ONLY=true` 時要求 ERP session。後端會重新查驗使用者及其當下權限。`admin`、`dispatcher` 和 `superadmin` 可執行此路由群。檢視者 `viewer` 無上述寫入及轉檔權限。
- HTTP `401` 表示缺認證、ERP session 失效或要求從 ERP 進入。`403` 可表示 token 無效或角色不足，`503 AUTH_UNAVAILABLE` 表示無法確認權限。常見業務錯誤依端點提供 `{code?,message,issues?,orderNumber?}`，列印和匯回的部分端點僅回 `message`。預覽 HTTP 200 仍需看 `output.ok`、`output.issues`、`barcodeConflicts`、`reviewRequired` 與 `canConfirm`。
- 批次 `:id` 為正整數上限 `2147483647`。以字串保留完整商城訂單號、SKU、實物條碼及 ECOUNT 單號，包含前導零。`…Minor` 金額是最小貨幣單位的整數。原始訂單列可能含姓名、地址、電話與其他業務資料，僅在授權環境轉送及保存。
- 來源 `backend/src/app.js:137`、`backend/src/app.js:181`、`backend/src/middleware/auth.js:11`、`backend/src/middleware/auth.js:76`、`backend/src/middleware/erpPortalScope.js:15`、`backend/src/routes/marketplaceRoutes.js:30`。

### `/api/marketplace-intakes` 路由表

| 方法與相對路徑 | 用途 | 執行效果 | 定義 |
| --- | --- | --- | --- |
| `GET /store-connections` | Shopify 可公開給登入使用者的連線設定清單 | 讀設定 | `backend/src/routes/marketplaceRoutes.js:33` |
| `GET /store-profiles` | 此環境的店鋪對照 | 讀資料 | `backend/src/services/marketplaceStoreProfiles.js:32` |
| `POST /store-profiles` | 建立或更新店鋪對照 | 寫設定 | `backend/src/services/marketplaceStoreProfiles.js:36` |
| `POST /preview` | 讀商城、核對品項／金額、產生轉檔預覽 | 讀資料及運算 | `backend/src/routes/marketplaceRoutes.js:41` |
| `POST /ready-preview` | 以伺服器已核對的可轉整單範圍重新預覽 | 讀資料及運算 | `backend/src/routes/marketplaceRoutes.js:46` |
| `POST /barcode-confirmations` | 經人員核對後保存商品對照證據 | 寫核對紀錄 | `backend/src/routes/marketplaceRoutes.js:88` |
| `POST /draft-overwrite/preview` | 比對原草稿或整份新舊混合訂單 | 讀資料及運算 | `backend/src/routes/marketplaceRoutes.js:35` |
| `POST /draft-overwrite/confirm` | 確認修訂與產檔範圍 | 寫草稿版本及批次 | `backend/src/routes/marketplaceRoutes.js:35` |
| `GET /` | 查批次列表 | 讀資料 | `backend/src/routes/marketplaceRoutes.js:133` |
| `POST /` | 核對並保存首轉新單批次 | 寫轉檔批次、來源單及待回匯通知 | `backend/src/routes/marketplaceRoutes.js:164` |
| `GET /:id` | 查原轉檔批次、財務及理貨關聯 | 讀資料 | `backend/src/routes/marketplaceRoutes.js:136` |
| `POST /:id/download-link` | 核發指定文件的短期下載授權 | 回傳 Cookie 及連結 | `backend/src/routes/marketplaceRoutes.js:147` |
| `POST /:id/orders/shipping-preview` | 核對單一 Shopify 原批次訂單收件資料 | 讀資料及運算 | `backend/src/routes/marketplaceRoutes.js:127` |
| `POST /:id/orders/shipping-update` | 採用即時 Shopify 收件資料 | 寫原批次收件快照及稽核紀錄 | `backend/src/routes/marketplaceRoutes.js:127` |
| `PATCH /:id/archive` | 封存批次 | 寫封存狀態及稽核紀錄 | `backend/src/routes/marketplaceRoutes.js:159` |
| `PATCH /:id/restore` | 取消封存 | 寫封存狀態及稽核紀錄 | `backend/src/routes/marketplaceRoutes.js:159` |
| `DELETE /:id` | 永久刪除可刪除的批次 | 刪除批次與相關作業紀錄並留刪除稽核 | `backend/src/routes/marketplaceRoutes.js:159` |

### 店鋪與共用輸入

- `GET /store-connections` 回 `{connections:[{id,platform:'Shopify',shop,connectionReady,authKind}]}`。`connectionReady` 代表設定所需資料齊備。讀單是否成功須由該店的授權查單與實際資料驗證。可公開欄位由 `backend/src/services/shopifyStoreRouting.js:54` 明確投影。
- `GET /store-profiles` 回 `{profiles:[{id,platform,store,settings,updated_at}]}`。`updated_at` 是 UTC 微秒字串，編輯時直接帶回原字串。
- `POST /store-profiles` 收 `{platform,settings,createOnly?}` 建新對照，或 `{platform,settings,profileId,expectedUpdatedAt}` 樂觀更新。`platform` 為 `Shopify`、`SHOPLINE` 或 `1Shop`。`settings` 要有 `store`、`customerCode`、`warehouseCode`、`currency:'TWD'`、`taxMode:'erp_inclusive'`、`taxType:'11'`、`taxConfirmed:true`。`customerName`、`projectOwner`、`salesOwner`、`erpStaffCode`、`erpProjectCode`、`erpResponsibilityConfirmed`、`erpCurrencyCode`、`erpCurrencyConfirmed`、`apiConnectionId`、`shopifyShop`、`shippingSku:{erpSku,name,confirmed,nonStock}` 依設定使用。提供 ECOUNT 承辦或專案需 `erpResponsibilityConfirmed:true`，提供 ECOUNT 貨幣編碼需 `erpCurrencyConfirmed:true`。Shopify 的受保護建／改路徑要求連線 ID、網域及 ready 設定相符。回 `{id,platform,store,settings,updated_at}`。`400 STORE_PROFILE_GUARD_INVALID` 是條件欄位無效，`400 STORE_CONNECTION_INVALID` 是連線不符，`409 STORE_PROFILE_EXISTS` 或 `STORE_PROFILE_CHANGED` 應重讀目前紀錄。此版另保留無版本欄位的 legacy upsert，接手開發時優先走有條件建／改的現用介面。見 `backend/src/services/marketplaceStoreProfiles.js:1`、`:36`。
- 轉檔共用 JSON `rows` 是原始工作表二維陣列，表頭可在前 10 列內，至多 5,000 列、每列 200 欄，並要求唯一可辨識的平台表頭。實際解析及保留欄名見 `backend/src/services/unifiedMarketplace.mjs:9`、`:31`、`:43`。`settings` 是轉檔設定，`profileId` 可選。由檔案格式辨認 `Shopify`、`1Shop`、`SHOPLINE`，店鋪身份另依服務端連線與 profile 驗證。原讀單證據要保留原始表頭、訂單與明細 ID，尤其 Shopify `Name`、`Id` 和 `Lineitem id`。
- `settings` 可傳 `store/customerCode/customerName/warehouseCode`、`date/batchSequence/batchNumber`、`currency/taxMode/taxType/taxConfirmed`、`erpCurrencyCode/erpCurrencyConfirmed`、`salesExportMode`、`projectOwner/salesOwner`、`erpStaffCode/erpProjectCode/erpResponsibilityConfirmed`、`summaryNote`、`includeTestOrders/bundleZeroConfirmed/discountAllocationConfirmed`、`shippingSku` 與 `skuMappings`。`skuMappings[來源SKU]` 可含 `erpSku,erpName,spec,barcode,physicalBarcode,scanCodeType,internalScanCode,internalScanConfirmed,barcodeConfirmed,confirmed,erpConfirmed,category`。`scanCodeType` 只能為 `international` 或 `internal`。內碼用 `ITM-` 前綴，國際條碼欄保持空白。來源 SKU、ERP SKU、保存的條碼大多限 100 字。`apiConnectionId/shopifyShop` 由伺服器使用持久化店鋪對照決定，傳入值僅可用於辨認同一預覽上下文。見 `backend/src/services/marketplaceSettings.js:3`、`backend/src/services/marketplacePreparation.js:80`、`:122`。

### 轉檔預覽、整單範圍與首次保存

| 路徑 | 請求主要欄位 | 回應、判讀及下一步 |
| --- | --- | --- |
| `POST /preview` | `{rows,settings?,profileId?}` | `{source,raw,parsed,choices,output,prepick,audit,effectiveSettings,settings,verification,profiles,profileId,newOrderCount,reimports,excludedFulfilled,reviewRequired,orderReviews,barcodeScope,catalog,barcodeConflicts,barcodeReviews,readyScope?}`。`output.ok`、`output.issues`、`output.headers/rows`、`output.summary` 是銷貨預覽。`output.reportHeaders/reportRows` 供報表，`prepick` 供預揀。`verification.currentFingerprint` 綁本次商城讀回。讀店失敗的 `409 MARKETPLACE_STORE_SELECTION_REQUIRED` 可能另有 `storeSelection:{platform,reason,choices:[{id,platform,store,shop,connectionReady}]}`。原因含 `ambiguous/not_found/connection_unavailable/mixed_stores/not_configured`。選店重跑原檔，混店檔依實際來源分店匯出。 |
| `POST /ready-preview` | `{rows,settings?,profileId?,readyScopeFingerprint}`，指紋來自前一回的 `readyScope.fingerprint` | `{rows,preview,readyScope}`。伺服器以新一次讀回選出完整可轉單，原始 `rows` 應為整份來源，且不要自行加減 `candidateNumbers`。`readyScope` 提供 `{fingerprint,candidateNumbers,heldOrders:[{orderNumber,reasons}],excludedFulfilled}`。只有可獨立證明的完整 Shopify 訂單才能進入子集。`409 MARKETPLACE_READY_SCOPE_CHANGED` 或 `MARKETPLACE_READY_SCOPE_NOT_READY` 需重核對原檔。此步仍為預覽。 |
| `POST /` | `{rows,settings,profileId?,previewFingerprint?}`，有商城即時核對時必須回傳 `verification.currentFingerprint` | 成功 `201` 提供批次 `id,batchNumber,platform,store,createdAt,archivedAt`、保存快照欄位、`newOrderCount,reimports,salesDownloadAllowed:true`。如果都是原保存單，回 `200 {newOrderCount:0,reimports,salesDownloadAllowed:false}`。舊路徑遇相同批次時可回 `reused:true`。保存會建轉檔批次、原單歸屬、預揀流程預備資料並嘗試通知倉儲主管，後續經 ECOUNT 回匯才建 WMS 工作單。 |

首次保存的 `400` 常見 `SHOPIFY_REVIEW_REQUIRED`、`MARKETPLACE_NOT_READY`。`409` 常見 `SHOPIFY_PREVIEW_CHANGED`、`MARKETPLACE_PREVIEW_CHANGED`、`MARKETPLACE_SOURCE_EXISTS`、`MARKETPLACE_ALREADY_EXISTS`、`MARKETPLACE_RETRY` 或 `MARKETPLACE_REIMPORT_UNAVAILABLE`。`MARKETPLACE_SOURCE_EXISTS` 可能附 `intakeId` 或 `workOrderId`。`503 MARKETPLACE_RESULT_UNKNOWN` 表示提交結果未確認，先重讀已保存批次，以相同內容核對後重試。沒有任何回應可作為 ECOUNT 已入帳的證明。

重拋原單識別鍵為 `[platform,store,orderNumber]`。`reimports[]` 提供 `orderNumber,intakeId,workOrderId,state,message,canUpdateShipping`，狀態有 `pending/excluded/completed/warehouse_completed/cancelled/partial/voided/in_progress/needs_review`。已入帳的原單從 `intakeId` 讀原批次與 `links`，依原銷貨回匯。草稿修訂另走下節。來源歸屬由伺服器保存。

原始碼 `backend/src/routes/marketplaceRoutes.js:19`、`:41`、`:164`、`backend/src/services/marketplacePreparation.js:449`、`backend/src/services/marketplaceReadyScope.js:74`、`:165`、`backend/src/services/marketplaceReimports.js:15`、`:48`、`frontend/src/components/admin/MarketplaceConverter.jsx:598`。

### 商品條碼核對

1. 讀取 `preview.barcodeConflicts[]`，以 `sourceSku`、`targetOptions`、`selectedErpSku`、`relatedOrders`、`reviewReason`、`canConfirm` 與 `fingerprint` 顯示實際核對項目。錯 SKU、多個主檔對應、歷史變體已移除、來源條碼未填，會有不同核對條件。需手輸實物條碼或使用內碼時，先以相應 `skuMappings` 重跑預覽，讓伺服器產生正確證據。
2. `POST /barcode-confirmations` 收 `{rows,settings,profileId,verificationFingerprint,confirmation:{fingerprint,confirmed:true,historicalLineAttested?}}`。`verificationFingerprint` 取這次預覽 `verification.currentFingerprint`，`confirmation.fingerprint` 取該衝突候選。歷史明細需 `historicalLineAttested:true`，必須由 `admin/superadmin` 或通過 ERP session 驗證、有 `erpSubject` 和 `wms_admin` 授權的 `dispatcher` 確認。一般認證為 `dispatcher` 並不足以覆核這種歷史明細。
3. 成功 `201 {confirmed:true,id,confirmedAt}`。核對由伺服器再讀商城，對應此完整上傳檔及可驗證的確切明細投影，保存於 `marketplace_product_mapping_reviews`。使用內碼時亦驗證 `marketplace_internal_scan_codes` 的唯一商品綁定。此步沒有改 ECOUNT 參考主檔。保存後重跑預覽驗證解除待核對。
4. `400 BARCODE_CONFIRMATION_REQUIRED`、`STORE_PROFILE_REQUIRED` 是缺確認或店鋪。`403 BARCODE_REVIEW_FORBIDDEN` 是歷史明細授權不足。`409 BARCODE_REVIEW_CHANGED` 為商城或候選證據有變，需重跑預覽。`503 BARCODE_REVIEW_RESULT_UNKNOWN` 先重讀現存對照。內碼衝突查 `INTERNAL_SCAN_CODE_CONFLICT`。

原始碼 `backend/src/routes/marketplaceRoutes.js:88`、`backend/src/services/marketplaceBarcodeReviews.js:125`、`backend/src/services/marketplacePreparation.js:339`、`frontend/src/components/admin/MarketplaceConverter.jsx:398`。

### 草稿修訂與整份重轉

兩個模式共用 `POST /draft-overwrite/preview`、`POST /draft-overwrite/confirm`。`scopeMode:'uploaded-file-v2'` 是整份轉檔比對助理模式，適合 Shopify 新單與原草稿同檔。未選此 mode 走舊的原批次草稿覆蓋。各自的確認開關為 `WMS_MIXED_REEXPORT_ENABLED` 與 `WMS_DRAFT_OVERWRITE_ENABLED`，僅字串 `true` 啟用。

| 步驟 | 請求 | 回應與意義 |
| --- | --- | --- |
| 舊模式預覽 | `{rows,settings,profileId?}` | `{previewFingerprint,affectedBatches,confirmationRequired:true}`。批次有 `id,batchNumber,revision,canOverwrite,blockedReasons,uploadedOrders,omittedOrders`。`uploadedOrders` 含 `orderNumber,changed,restoring,before,after,changes,live,diffAPI`。缺在新版上傳中的 `omittedOrders` 帶 `decisionKey,canKeep,keepBlockedReason?`。該模式遇新單會回 `MARKETPLACE_DRAFT_NEW_ORDERS`。 |
| 舊模式確認 | 同一份預覽輸入，再加 `previewFingerprint,commandId,confirmed:true,notImportedConfirmed:true,decisions,reason?`。`decisions` 為 `{[orderNumber]:'keep' 或 'exclude'}`，只包含全部漏列訂單，且 `keep` 需 `canKeep:true` | `{applied:true,commandId,batches:[{id,batchNumber,draftRevision,draftFingerprint,activeOrderCount,excludedOrderNumbers}],replayed}`。原批次修訂、保留變更前快照與逐單狀態。 |
| 整份模式預覽 | `{scopeMode:'uploaded-file-v2',rows,settings,profileId?}` | `{scopeMode,reviewRequired,orderReviews,barcodePrerequisites?,previewFingerprint,summary,newOrders,affectedBatches,excludedFulfilled,canConfirm,blockedReasons,confirmationRequired:true}`。`summary` 有 `totalOrderCount,newOrderCount,changedOrderCount,unchangedOrderCount,quantity,totalMinor`。以差異與必要提醒呈現，`newOrders` 含 `orderNumber,after,live`。|
| 整份模式確認 | 同一份整份預覽輸入，再加 `previewFingerprint,commandId,confirmed:true,notImportedConfirmed:true,excludedFulfilledConfirmed?,reviewDecisions?,reason?`。有已出貨排除單時需 `excludedFulfilledConfirmed:true`，`decisions` 省略或保持空物件 | `{applied:true,scopeMode,commandId,exportBatch,batches,newOrderCount,updatedOrderCount,excludedFulfilled,replayed}`。`exportBatch` 有 `id,batchNumber,orderCount,activeOrderCount,draftRevision,quantity,totalMinor,scopeFingerprint`。由 `exportBatch.id` 取得新版下載授權。原歸屬保留，整份批次透過 `marketplace_intake_scope_orders` 指向各訂單目前版本，未上傳的原單保留。|

- `commandId` 是 UUID v4，`previewFingerprint` 是伺服器返回的 64 位小寫十六進位指紋，`reason` 選填、最多 500 字。服務重讀商城與轉檔歸屬，再鎖原單和批次檢查。交易回應遺失 `503 MARKETPLACE_DRAFT_RESULT_UNKNOWN` 時重用同一 actor、`commandId`、原 body 讀回結果。相同 ID 改內容回 `MARKETPLACE_DRAFT_COMMAND_CHANGED`。變更後的正常封裝用新 ID 和新預覽。旗標關閉回 `423 MARKETPLACE_DRAFT_OVERWRITE_DISABLED` 或 `MARKETPLACE_MIXED_REEXPORT_DISABLED`。
- `notImportedConfirmed:true` 是作業人員對 ECOUNT 入帳狀態的事實確認。封存、已核對 ERP 或已發生倉庫活動的批次有額外阻擋，常見 `MARKETPLACE_DRAFT_ALREADY_STARTED` 或 `MARKETPLACE_DRAFT_CHANGED`。原批次商品的歷史證據不足時查 `MARKETPLACE_BARCODE_OWNER_REVIEW_REQUIRED` 及預覽的 `barcodePrerequisites`。
- `orderReviews[]` 包含取消商品、剩餘商品、可證明的 `editChanges` 與 `live` 金額。部分退款若要求人員決定，`reviewDecisions` 逐筆使用 `{orderNumber,decision:'net-payment-with-allowance-v1',fingerprint}`，其中 `fingerprint` 取該筆 `proposal.fingerprint`。服務以 Shopify 即時退款與剩餘數量核對，確認折讓和實收的守恆。先前比較成功後若商城更新，需重新核對。

原始碼 `backend/src/services/marketplaceDraftOverwrite.js:96`、`:165`、`:178`、`:226`、`backend/src/services/marketplaceMixedReexport.js:169`、`:179`、`:229`、`backend/src/services/shopifyOrderReview.js:10`、`:41`。

### 查批次、收件人異動與下載

- `GET /` 可用 `status=active|archived|all`（預設 active）、`platform`、`store`、`from/to=YYYY-MM-DD`、`q`（批號片段或 ID）、`page`（每頁 20 筆）。回 `{intakes,total,orders,page,pageSize,facets}`，列項含 `id,batch_number,source_platform,source_store,created_at,archived_at,sales_date,summary,superseded,warehouse_flow,order_count,linked_count`。`GET /:id` 回保存快照及 `financials,financialWarning,superseded,handler,reviewWarning,links`。`links[]` 含 `source_order_number,order_id,import_batch_id,work_barcode,status,voucher_number`。讀原單以既存批次及工作單為錨點。
- `PATCH /:id/archive` 或 `/restore` 可用空 body。`DELETE /:id` 要求 `{confirmed:true,batchNumber:精確原批號}`。回 `{id,action,unchanged?}`。整份轉檔版本具來源關聯、已有 ECOUNT 確認或已接理貨工作單時拒絕刪除。原批次仍被新版引用時拒絕封存。應以 `GET /:id` 讀回狀態。此類錯誤通常回 `400/404/409 {message}`。
- `POST /:id/orders/shipping-preview` 只收 `{orderNumber}`，回 `{intakeId,orderNumber,previousShipping,currentShipping,changed,changedFields,sourceFingerprint,previewFingerprint}`。收件欄位 `recipient,phone,address,postalCode,method,storeName,storeCode,trackingNumber,note`。`POST /:id/orders/shipping-update` 只收 `{orderNumber,previewFingerprint,commandId,expectedActorId}`。`expectedActorId` 是當前 WMS actor ID，`commandId` 是 UUID v4。回 `{ok:true,intakeId,orderNumber,updated,changedFields,reused?}`。更新值由服務端即時讀 Shopify，核對原訂單仍未作業、證據完整且商品、數量、金額等未變更。整份轉檔 scope、已回匯或已開始作業會受限。成功有變更才寫原快照 `shipping` 並留事件。常見 `MARKETPLACE_SHIPPING_BUSINESS_CHANGED`、`MARKETPLACE_SHIPPING_CHANGED`、`MARKETPLACE_SHIPPING_UPLOAD_SCOPE`、`MARKETPLACE_SHIPPING_RESULT_UNKNOWN`。
- `POST /:id/download-link` 收 `{kind:'ecount'|'ecount-grouped'|'prepick'}`，回 `{url,expiresIn:120}`，同時設定 `wms_marketplace_download` Cookie，`HttpOnly`、`SameSite=Strict`，production 模式 `Secure`。`GET /api/marketplace-files/:id/:kind` 使用該 Cookie，重新核對 actor、批次、種類、草稿版本以及整份範圍指紋，回 XLSX 二進位與 `Content-Disposition`。直接 GET 缺 Cookie 或已過期為 `403`，已更新版本為 `409`，不存在為 `404`。銷貨型下載再核對商品主檔與對照證據。獨立 WMS 網頁的瀏覽器呼叫須保留 credentials。ERP 原生 SDK 使用 host 提供的 `runtime.download({id,kind})`，接 Blob 並核對原 session；宿主實作由 ERP 版本確認。

原始碼 `backend/src/services/marketplaceBatchManagement.js:6`、`:26`、`:41`、`:47`、`backend/src/services/marketplaceShipping.js:27`、`:159`、`:196`、`backend/src/services/marketplaceDownloads.js:5`、`:17`、`frontend/src/workspace/downloads.js:29`。

### 相鄰 API｜主檔、通知、ECOUNT 理貨回匯與預揀

- `POST /api/marketplace-products/resolve`，認證角色同轉檔群。收 `{skus:[string]}`，最多 1,000 個完整編碼，每個最多 100 字。回 `{sync:{product_count,created_at,source_note}|null,products:{[sku]:{status,matches}}}`，用於查參考主檔的 `matched/missing/inactive/ambiguous` 等狀態，資料源為部署所配的 ECOUNT 參考檔。見 `backend/src/services/marketplaceProductCatalog.js:55`、`:86`。
- `GET /api/marketplace-batch-notices`、`POST /api/marketplace-batch-notices/:noticeId/seen` 要登入且目前使用者為倉儲主管。前者回 `{total,notices}`，通知含 `noticeId,intakeId,stage,title,batchNumber,platform,store,actorId,actorName,actorRole,createdAt,href`；僅顯示本人待讀且有效的 `prepared` 或 `ready_for_print`。後者以 notice ID 標為本人已讀，回 `{noticeId,seenAt}`。通知收件人、回匯、預揀釋放各由自己的業務流程決定。見 `backend/src/routes/marketplaceBatchNoticeRoutes.js:13`、`backend/src/services/marketplaceBatchNotifications.js:60`。
- `GET /api/warehouse-intakes?ready=1` 回 `{batches}`，`ready=1` 限已核對且預揀未完成，普通預揀人員只看指派給自己的未完成批次。`GET /api/warehouse-intakes/staff` 由倉儲主管取 `{staff:[{id,name,role}]}`。`GET /api/warehouse-intakes/receipt-format` 由拋單員或管理員下載銷貨回傳 XLSX 欄位格式。`GET /api/warehouse-intakes/:id` 回 `{batch,flow,orders,products,events}`，拋單員、管理員或被指派的該批作業人員可看，依角色遮蔽部分財務證據與稽核細節。見 `backend/src/routes/warehouseReleaseRoutes.js:11`、`:22`。
- `POST /api/orders/import` 為既有檔案匯入入口，`admin/dispatcher/superadmin` 可用。`multipart/form-data` 傳 `orderFile`，單檔 `.xlsx/.xls/.csv`，最多 10 MiB，附帶欄位只允許選填正整數 `marketplaceIntakeId`。服務先辨認商城 ECOUNT 回匯格式，依平台、店鋪、商城訂號與來源明細定位可對應的原批次或整份版本。匹配後走 `confirm-return` 或 `confirm-sales`，成功新建 `201`、重用原回匯 `200`，回 `warehouseIntakeId,workOrderCount,...`。`IMPORT_NOT_APPLIED`、`IMPORT_ALREADY_EXISTS`、`IMPORT_RESULT_UNKNOWN` 應先讀原批及回匯狀態。獨立非商城檔仍走其既有解析和建立工作單路徑。見 `backend/src/routes/orderRoutes.js:150`、`:475`、`backend/src/services/marketplaceReturnImport.js:35`、`:48`。

#### `POST /api/warehouse-intakes/:id/:action`

每項動作用 `{commandId,expectedActorId,...}`，UUID v4 與當前使用者 ID。成功一般回 `{ok:true,intakeId,action,reused?}`。動作完成後有資料庫事件，同一 actor 及操作 ID 配相同 body 可以讀回收據。503 結果不明時重用原 ID/body 或先讀回該批。`manager` 在此指 `admin/superadmin/dispatcher`，`warehouseManager` 需額外滿足倉儲管理範圍。見 `backend/src/services/warehouseRelease.js:8`、`:61`、`:164`。

| `action` | 額外欄位 | 守衛與執行 |
| --- | --- | --- |
| `enable` | 無 | `manager`。啟用原批流程、補工作條碼；已有舊理貨關聯需走原流程。 |
| `confirm-barcode` | `productCode,barcode,confirmed:true` | `manager`。ECOUNT 回匯確認前才可更正該批作業商品的實物條碼。 |
| `confirm-sales` | `rows,savedSalesConfirmed:true` | `manager`。核對 ECOUNT 已保存銷貨回傳，查批次、客戶、倉庫、交易類型、商品、數量及財務拆分。 |
| `confirm-return` | `rows` | `manager`。核對 ECOUNT 理貨／出貨回匯，查商品、數量、來源單、實際銷貨單號與適用的條碼／SN。 |
| `print` | `kind:'orders'\|'all'\|'prepick'` | 倉儲主管。ERP 回匯已核對、工作單未異動、所有商品條碼齊備才記錄列印與領單。介面執行實體列印。 |
| `assign` | `assigneeId` | 倉儲主管。先列印、尚未放行、指派有效人員。 |
| `scan` | `productKey,barcode,quantity` | 已被指派且具預揀角色的人員。須掃到指定商品，正整數數量不可超需求。`productKey` 取 GET detail 的 `products[].key`。 |
| `reset-product` | `productKey,reason` | 倉儲主管。回匯後且尚未放行，可重設該商品清點並留原因。 |
| `complete` | 無 | 已被指派且具預揀角色的人員。所有商品清點符合、工作單未異動後清除 `warehouse_hold`，工作單進入揀貨。 |

`confirm-sales` 與 `confirm-return` 以整批原單範圍核對，初次成功建立 WMS 理貨批次／工作單／原單連結與預揀保留狀態。回應另含 `batchId,batchNumber,workOrderCount,totalQuantity,warehouseIntakeId,itemCount,serialCount,orders,reused`，`orders[]` 含 `orderId,voucherNumber,workBarcode,sourceOrderNumber,sourcePlatform,sourceStore`。相同 ECOUNT 回傳指紋可以重用，不同指紋須處理原單據差異。WMS 的回匯動作把 ECOUNT 已有文件核對進 WMS，正式銷貨產生及扣庫仍由 ECOUNT 操作完成。

銷貨回傳前 14 個必要欄位依實際表頭為 `ECOUNT實際銷貨單號`、`WMS批次號`、`客戶/供應商編碼`、`發貨倉庫`、`交易類型`、`平台`、`店鋪`、`商城訂單編號`、`來源明細號`、`品項編碼`、`數量`、`稅前價格`、`營業稅`、`含稅金額`。理貨回匯最少須有實際銷貨單號、平台、店鋪、商城訂號、來源明細、品項編碼與數量。理貨回匯提供任一金額欄就必須同時提供三個金額欄並通過核對。按檔案格式帶回 `國際條碼`、`序號/批號`、`摘要`、`內部掃描碼`、`來源SKU` 或 `實際SN`。倉庫實物預揀從 `expected_items` 聚合，非實體運費在銷貨資料以 `nonstock_items` 保留。`rows` 最多 10,000 列，彙總匯回由保留的 `AG-` 分段 ID 連結原始訂單明細與 SN。見 `backend/src/services/erpSalesReceipt.js:3`、`:29`、`:60`、`backend/src/services/warehouseRelease.js:85`、`:95`、`:122`、`:147`。

## 獨立理貨匯入、工作單與掃碼

| 方法與路徑 | 主要契約 |
| --- | --- |
| `POST /api/orders/import` | `multipart/form-data` 的 `orderFile` 為一份 `.xlsx`、`.xls` 或 `.csv`，最多 10 MiB，唯一可附欄位為十進位字串 `marketplaceIntakeId`。只限拋單角色或管理員。先辨識商城批次原回傳，再辨識有來源明細的批次或舊單。成功是 201 或已處理的 200，回傳批次／訂單、工作條碼、筆數與件數。 |
| `GET /api/order-import-batches/:batchId` | 讀已匯入批次與子工作單。批次識別是內部工作批次 ID。 |
| `GET /api/orders/:orderId/work-snapshot` | 掃碼前取目前訂單、明細與 SN 狀態及 `stateToken`。前端在狀態改變、事件或寫入結果不明時重讀。 |
| `POST /api/orders/claim-by-barcode`、`GET /api/orders/claim-commands/:commandId` | 傳 `{barcode,stage:"pick"或"pack",commandId,expectedActorId}`，依角色、狀態和指派領單。回執用原 `commandId` 查詢，可帶 `?expectedActorId=...`。 |
| `POST /api/orders/update_item` | `orderId`、`scanValue`、`type=pick/pack`、`amount`（預設 1、非零整數）、必要時 `orderItemId`。新工作台帶 `responseMode:"delta-v1"`、UUID v4 `commandId` 與 `expectedState`。多 SN QR 選取另帶 `selectedSerials` 和 `expectedActorId`。揀貨由 picker、裝箱由 packer，或有倉儲管理權的管理員。舊路徑回全量，帶命令一般回 `delta-v1`（`order,item,instance,stateToken,baseState,commandId`），特定 SN QR 多序號分支回完整快照及 `confirmedSerials`。 |
| `POST /api/orders/:orderId/reconcile-picking` | 倉儲管理員傳目前快照的 64 位 `expectedState` 與 `reason`，把已完成全部揀貨且無未結異常的工作單從 picking 校正到 picked 並留稽核，回 `{orderId,status,changed}`。 |
| `DELETE /api/orders/:orderId`、`POST /api/orders/:orderId/deletion-requests` | 都建立刪除申請；`PATCH /api/orders/:orderId/exceptions/:exceptionId/ack` 等主管審核路由另依異常類型處理。 |

上傳成功後，工作批次與工作單會在同一交易建立。重複批次、單號會回 409 `IMPORT_ALREADY_EXISTS` 和可用的既有識別。核對格式或原批次不符會回 `IMPORT_NOT_APPLIED`。收到 503 `IMPORT_RESULT_UNKNOWN` 或 `SCAN_RESULT_UNKNOWN` 要先回作業看板／快照查證；保留原檔、命令識別和回應。一般掃碼的 `SCAN_NOT_APPLIED`、`STATE_CHANGED`、`SOURCE_ITEM_REQUIRED` 需照提示更新現況再操作。銷貨／理貨不同工作表、非庫存運費、摘要欄、主檔與來源識別核對在業務解析層處理。

來源為 `backend/src/routes/orderRoutes.js:63–69,150–175,471–606,609–683,1003–1037`、`backend/src/services/marketplaceImportLink.js`、`backend/src/services/marketplaceReturnImport.js`、`backend/src/services/importBatchSnapshot.js`、`backend/src/services/reconcilePicking.js:8–46`、`backend/src/services/scanSnapshot.js:22–54`、`backend/src/services/orderClaimService.js:41–124`。

### 箱號與 SN

| 方法與路徑 | 主要契約 |
| --- | --- |
| `GET /api/cartons`、`GET /api/cartons/:cartonId`、`GET /api/cartons/lookup` | 列表支援 `q`、`limit`（預設 25，上限 100），回 `items,total`；詳情及查詢帶箱號或 `scanValue`，可用 `matchSerialSubset=true` 查 SN 子集合。 |
| `POST /api/cartons`、`POST /api/cartons/import` | 建箱／匯入實物資料。批次 JSON 為 `format:"corely-cartons-v1"`、`cartons`，一次 1–100 箱且最多 10,000 SN。同箱同內容重送回 `replayed`，同箱不同內容回衝突並取消整批。 |
| `PATCH /api/cartons/:cartonId`、`POST /api/cartons/:cartonId/seal`、`POST /api/cartons/seal-batch`、`POST /api/cartons/:cartonId/void` | 改內容、單箱／批次封箱、作廢草稿。更新以操作者和內容／狀態版本為準，已使用或自身狀態不合會停止。 |
| `POST /api/orders/:orderId/carton-preview` | 傳 `type`、`scanValue`、`expectedActorId` 及操作所需選取。預覽回訂單、箱內容、可用分配及 `expectedState,expectedCartonRevision,expectedActorId`；純子集合查詢可能只回可用選取與部分狀態。 |
| `POST /api/orders/:orderId/carton-scan` | 要求 UUID v4 `commandId`，沿用預覽的 `expectedState,expectedCartonRevision,expectedActorId`。回 `snapshot-v1`、操作識別及更新後快照。與單件掃碼共用命令回執，避免一個 ID 被不同操作重用。 |
| `POST /api/cartons/allocations/:allocationId/release`、`GET /api/orders/:orderId/carton-shipments` | 退回尚未裝箱分配須有倉儲管理權、理由與版本保護。按單讀出貨箱明細、分配及 SN 追溯。 |

典型衝突 `STATE_CHANGED`、`CARTON_STATE_CHANGED`、`CARTON_COMMAND_CONFLICT`、`CARTON_SN_OCCUPIED`。來源為 `backend/src/routes/cartonRoutes.js:17–36`、`backend/src/services/cartonService.js:20–29,152–219,384–406,448–545`、`backend/migrations/040_wms_cartons.sql`。

## 資料來源與資料庫定位

| 資料 | 實際責任與追查位置 |
| --- | --- |
| 店鋪資料 | WMS `marketplace_store_profiles`，版本比對使用完整 `updated_at`。商城連線用自己的 registry、店鋪域名及授權。 |
| WMS 轉檔與歸屬 | `marketplace_intakes` 是批次快照，`marketplace_intake_orders` 是來源訂單，`marketplace_intake_scope_orders` 維持本次可轉檔集合。商城、店鋪、訂單、來源明細都要對應。 |
| 草稿及商品核對 | `marketplace_draft_commands`、`marketplace_draft_revisions` 保存命令及草稿修訂。商品核對與內部掃描碼分別見 `marketplace_product_mapping_reviews`、`marketplace_internal_scan_codes`。 |
| ECOUNT 與倉庫交接 | ECOUNT 的已儲存銷貨文件和理貨／出貨回傳是原批次交接證據。WMS `marketplace_warehouse_flows/events/commands`、`marketplace_work_order_links`、`warehouse_import_batches` 維護核對後的工作衔接。 |
| 工作單、SN 與箱 | `orders`、`order_items`、`order_item_instances`、`wms_scan_commands`、`wms_cartons`、`wms_carton_lines`、`wms_carton_serials`、`wms_carton_allocations`、`wms_carton_history`。 |
| 資料庫結構 | `backend/migrations/` 是固定版 SQL 的來源，`backend/src/config/schemaReadiness.js` 是 runtime 啟動驗證。 |

這一輪比對的是原始碼和路由註冊表。真實訂單、資料庫寫入、正式 ECOUNT 匯入、通知送達和實體列印／掃碼的結果，使用相應環境的驗收證據。

## 外部整合、ERP 工作台與即時通知

此索引按 WMS `ab835f44ef2d9e855360aa6b01fb9216cd70afed` 的程式契約編寫。外部服務的可用授權、實際租戶、GCP 掛載及合格訂單需用交接包中的發行證據和當下 DEV 讀回確認。以下所有環境變數只列名稱。管理 API 與收件資料請用經授權的 DEV 帳號及樣本。

### 1. ERP 工作台、WMS API 與 SSO

#### 位置與伺服器邊界

| 用途 | 入口 | 說明 |
| --- | --- | --- |
| 作業人員 | [ERP DEV 商城訂單轉檔](https://corely-erp-dev-sp5g377smq-de.a.run.app/warehouse/marketplace?entityId=tw-entity-001) | ERP 完成登入後選倉儲公司並掛載 WMS SDK。商城頁內部路由 `/admin/marketplace-converter` |
| WMS DEV | [WMS DEV origin](https://corely-wms-dev-sp5g377smq-de.a.run.app) | 原始 API 路徑以 `/api/` 開頭。Nginx 將 `/api/`、`/health`、`/ready` 與 WebSocket `/socket.io/` 送至 API sidecar `127.0.0.1:3001` |
| WMS 工作台 SDK | [DEV workspace manifest](https://corely-wms-dev-sp5g377smq-de.a.run.app/workspace-manifest.json) | `GET`。公開 build 資產清單 `{version:1,sourceCommit,entry,styles,portalStyles}`，manifest 禁用快取，帶雜湊路徑的 `/assets/` 可長快取 |
| WMS 呼叫 ERP 伺服器 | `ERP_PORTAL_API_URL`，本版讀回對應至 [ERP DEV API origin](https://aftersales-final---corely-erp-api-dev-sp5g377smq-de.a.run.app) 的 `/api/v1` | 見包內 `artifacts/packaging/DEV-ab835f44-readback.safe.json`。發行前核對部署設定及當下服務，保留正常 ERP 來源 |
| 基本健康與 schema | `GET /health`、`GET /ready` | `/health` 回 `{status:"ok",timestamp}`，`/ready` 回 `{status:"ready"}` 或 HTTP 503。`/ready` 檢查 DB schema 與排空狀態，商城授權與真實轉檔另用業務案例查證 |

WMS 來源 `frontend/nginx.cloudrun.conf.template:20-52`、`backend/src/app.js:149-189`、`frontend/src/workspace/contract.mjs:1-47`。

#### 原生載入及檔案代理

| ERP 方法與路徑 | 呼叫契約 |
| --- | --- |
| `POST /api/v1/wms/native/session` | ERP Bearer、`X-WMS-Entity`，JSON `{entry:"marketplace",nonce,entityId}`，nonce 為 64 個小寫十六進位字元。在 ERP 端驗證 `wms_tasks:read`、公司、ERP 身分後簽發 ticket，伺服器呼叫 WMS exchange。回 `{accessToken,user,destination}`。回應禁止快取 |
| `GET／HEAD／POST／PUT／PATCH／DELETE /api/v1/wms/native/proxy/api/…` | ERP Bearer、`X-WMS-Entity`、`X-WMS-Session`（WMS session JWT）。ERP 先核對 WMS `/api/auth/me` 回傳的 ERP 身分和公司，再把 URL query、原始 JSON 或允許的 multipart body 送至 WMS。WMS 本身再檢查權限與業務狀態。例如轉檔預覽為 `POST /api/v1/wms/native/proxy/api/marketplace-intakes/preview` |
| `POST /api/v1/wms/native/files/:id/:kind` | 相同 ERP／WMS 身分與公司 headers，前端傳空 JSON，`kind` 為 `ecount`、`ecount-grouped`、`prepick`。ERP 伺服器向 WMS 取得短效下載 cookie，驗證 path 並取回 XLSX，以附件回瀏覽器。cookie 留在伺服器端 |

SDK 先驗證精確 WMS 資產 origin，取得 manifest，再載 ESM `mountWorkspace(container, options)`。mount 需要相同 `sourceCommit`、合法資產路徑、已驗證的 ERP session 及 ERP host 提供的 `transport`。以 Shadow DOM 和獨立 React root 掛載；`portalStyles` 套至原生操作視窗和列印，session 變更時取消未完成請求與 Socket。ERP proxy 對路徑有允許清單，auth、callbacks、maintenance 及內部服務有所限制；`download-link` 使用專用檔案端點。遇到 actor/entity mismatch、session 失效或 `WMS_NATIVE_RESULT_UNKNOWN` 時，回 ERP 重新核對身份及操作結果，保留既有 command ID 供合規重試。

WMS SDK 來源 `frontend/src/workspace/index.jsx:32-108`、`frontend/src/workspace/contract.mjs:17-47`、`frontend/src/api/api.js:16-87`。ERP 端契約另以工作區可檢查的 ERP 參考提交 `89f2e885cb9c129b57293ca5dacbe44011652f3d` 查閱，追當下部署請到 ERP repo 的 `backend/src/modules/integration/wms/wms-native.controller.ts:23-99`、`wms-native.contract.ts:7-54`、`wms-native.service.ts:195-239,305-355`、`frontend/src/services/warehouse-native.ts:77-178`。該參考提交用於定位契約，ERP 實際部署版本另讀 GCP。

#### 身分 API

| 方向 | 方法與路徑 | 身分、請求與回應 |
| --- | --- | --- |
| 瀏覽器／ERP → WMS | `GET /api/auth/erp/config` | 無需 Bearer，回 `{origin,erpOnly}` 或未啟用時 `{erpOnly:false}`。配置不可用回 503 |
| ERP → WMS | `POST /api/auth/erp/exchange` | JSON `{ticket,nonce}` 各 64 lowercase hex，消耗 ERP ticket。回 `{user,destination,accessToken}`；成功 exchange 會在 WMS 管理 ERP 人員對照（依 immutable ERP user ID，不用顯示名稱），新身分會建立無本機密碼登入用途的人員，既有對照會同步名稱與角色 |
| 瀏覽器／ERP → WMS | `GET /api/auth/me`、`POST /api/auth/erp/logout` | WMS Bearer。前者回當前 `{user}`；後者把 ERP session 送回 ERP revoke，回 `{ok:true}` |
| ERP → WMS | `POST /api/auth/erp/staff`、`POST /api/auth/erp/bind` | 伺服器用 `x-erp-service-key`。staff 回 `{items}`；bind 送 `{userId,wmsUserId,entityId}`，只能連結既有揀貨／裝箱／出貨人員，重複且衝突時 409 |
| WMS → ERP | `POST /api/v1/wms/portal/consume` | `x-wms-service-key`，JSON `{ticket,nonce}`。ERP 回身分、公司、角色、權限、效期、目標路由與 session |
| WMS → ERP | `POST /api/v1/wms/portal/inspect`、`POST /api/v1/wms/portal/revoke` | `x-wms-service-key`，JSON `{session}`。inspect 在 WMS HTTP／Socket 驗證時確認未失效、ERP 主體與 WMS 角色仍相符。revoke 撤銷 session |
| 舊開窗流程 | ERP `POST /api/v1/wms/portal/ticket`，WMS `POST /api/auth/erp/exchange` | 僅向正確 opener/origin 傳 `postMessage`。WMS 發 `corely-wms-ready`＋nonce，ERP 回 `corely-erp-ticket`，收到後 exchange。另有 ERP `GET /api/v1/wms/portal/access`、`POST /api/v1/wms/portal/logout`，ERP 管理員 `GET /api/v1/wms/portal/staff`／`POST /api/v1/wms/portal/bind` |

WMS 配置 `ERP_PORTAL_ONLY`、`ERP_PORTAL_SSO_ENABLED`、`ERP_PORTAL_API_URL`、`ERP_PORTAL_ORIGIN`、`ERP_PORTAL_ENTITY_ID`、`ERP_PORTAL_SHARED_SECRET`、`JWT_SECRET`；ERP 端 `WMS_NATIVE_ENABLED`、`WMS_PORTAL_SSO_ENABLED`、`WMS_PORTAL_ENTITY_ID`、`WMS_PORTAL_SERVICE_URL`、`WMS_PORTAL_SHARED_SECRET`。每端共用 service key 透過公司授權 Secret 注入。整合呼叫限 HTTPS，WMS → ERP 請求逾時 5 秒，失效身分回 401，暫時不可驗證回 503。WMS JWT 使用 HS256；ERP viewer 除本人 `/api/auth/me` 與登出外，只能用被授權的 GET 清單，商城轉檔需具拋單或管理角色。啟用 `ERP_PORTAL_ONLY` 時，一般工作 API 會拒絕非 ERP session。

WMS 來源 `backend/src/routes/authRoutes.js:6,36-60`、`backend/src/services/erpSession.js:6-91`、`backend/src/middleware/auth.js:11-51`、`backend/src/middleware/erpPortalScope.js:1-22`、`frontend/src/components/ErpEntry.jsx:13-34`。ERP 參考來源 `backend/src/modules/integration/wms/wms-portal.module.ts:148-186`。

### 2. Shopify Admin API

| 呼叫 | 方法及位置 | 重要契約 |
| --- | --- | --- |
| 專用 App 取讀單 token | `POST https://{shop}.myshopify.com/admin/oauth/access_token` | application/x-www-form-urlencoded，`grant_type=client_credentials`、`client_id`、`client_secret`。回 `access_token`、`expires_in`、`scope`，程式驗證 scope 恰為 `read_orders,read_products`。token 僅在 server memory 查用、到期前更新；同連線合併並行換 token |
| 店鋪和完整訂單定位 | `POST https://{shop}.myshopify.com/admin/api/{apiVersion}/graphql.json` | `X-Shopify-Access-Token`、JSON `{query,variables}`，預設 `2026-07`。Query `WmsStoreIdentity(ids:[ID!]!)` 回 `shop.myshopifyDomain` 及 `nodes.id/name`，比對 CSV 訂單 ID 與店鋪 |
| 逐筆讀目前訂單及退款 | 同一 GraphQL endpoint | `WmsCurrentOrder(id,after,first)` 讀訂單 ID／名稱／版本／時間、付款與履約、目前商品數量、商品 variant barcode、稅與運費、收件資訊、退款與交易。退款分頁用 `WmsRefundPage(id,lineAfter,transactionAfter)` 並核對退款及原單版本。安全確認的未出貨部分退款以成功退款、取消明細、收款與目前商品金額交叉核對 |
| 讀 Shopify 訂單編輯紀錄 | 同一 GraphQL endpoint | `WmsOrderEditHistory` 查 `order.agreements.sales`，以可證明的 line ID、交易增減、產品與 variant 變動整理差異。資料不足或存在歧義回待核對，不以商品品名猜測原規格 |

`WMS_SHOPIFY_CONNECTIONS_JSON` 支援 array 或 `{connections:[…]}`，最多 8 組，ID 與 `.myshopify.com` domain 唯一。非秘密欄位為 `id,shop,apiVersion,authKind`；`static_token` 指定 `tokenEnv`，`client_credentials` 指定同前綴的 `clientIdEnv/clientSecretEnv`。保留單店相容變數 `WMS_SHOPIFY_SHOP`、`WMS_SHOPIFY_ACCESS_TOKEN`、`WMS_SHOPIFY_API_VERSION`。用 `GET /api/marketplace-intakes/store-connections` 帶有授權的 staff session 查看 `id,platform,shop,connectionReady,authKind`，再用 `/store-profiles` 核對 `apiConnectionId`、`shopifyShop` 與 ECOUNT profile。ready 表示配置已齊，仍要確認 App scopes 與實際讀單。

`omfuture-orders` 連 `omfuture.myshopify.com`，與墨子 `www-omfuture.myshopify.com` 的既有連線分開；萬魔 DEV 歷史核對的設定為 `02082／003／TWD／稅別 11`。固定版選店要求同一店可完整定位整份訂單；未指定 profile 時，遇到多家符合、某店不可查、混店或找不到都回 `MARKETPLACE_STORE_SELECTION_REQUIRED`，附 `storeSelection.reason` 與可用選項。Shopify 當前核對最多 250 單／1,000 來源列，單一訂單最多 1,000 商品列；逾時或限流回 `SHOPIFY_TIMEOUT`／`SHOPIFY_THROTTLED`，不以過時資料完成此次確認。商城整合使用查詢，WMS 草稿、產檔和倉庫放行的寫入各自發生於 WMS 作業流程。

來源 `backend/src/services/shopifyStoreRouting.js:9-105`、`backend/src/services/shopifyTokenProvider.js:17-60`、`backend/src/services/shopifyOrderVerification.js:7-78,198-278,309-453,457-543`、`backend/src/services/shopifyOrderEdits.js:5-108`、`backend/src/routes/marketplaceRoutes.js:32-33`。萬魔 DEV 範例證據 `artifacts/wms-omfuture-routing-20261111/DEV-preview-verified.safe.json`。

### 3. SHOPLINE Open API 與 1Shop

| 平台與方向 | 方法與位置 | 技術契約 |
| --- | --- | --- |
| SHOPLINE 店鋪查證 | `GET https://open.shopline.io/v1/token/info` | Backend `Authorization: Bearer`，比對 `merchant._id`，有設定時比對 `merchant.handle`。若店鋪不符回 `SHOPLINE_SHOP_MISMATCH` |
| SHOPLINE 定位訂單 | `GET https://open.shopline.io/v1/orders` | Query `created_after,created_before,per_page=50,page,sort_by=asc`。來源日期最多 7 天，查最多 20 頁（1,000 筆），逐頁比對分頁、訂單號和唯一 ID |
| SHOPLINE 讀詳細 | `GET https://open.shopline.io/v1/orders/{id}` | 同 Bearer，拿訂單、付款／履約、完整品項、金額、折扣、運費、配送資料，核對來源檔。每批最多 50 單／1,000 商品列，整次驗證 60 秒。回傳正規化 `{rows,verification}`，驗證證據帶店鋪、連線、採集時間及來源 fingerprint |
| 1Shop 讀訂單 | `GET https://api.1shop.tw/v1/order/{encodedOrderNumber}` | 供應商要求 query `appid,secret`，僅由 WMS backend 組 URL，不記錄帶憑證網址。回 `success:0` 與 `data.order/data.cart`；比對訂單號、已確認的 `order.shop_url` HTTPS origin、SKU 合計與實收小計、付款履約、物流。每批最多 50 單／1,000 列，程式每 10 秒最多發 10 次同批請求 |

SHOPLINE 設定 `WMS_SHOPLINE_CONNECTION_ID`、`WMS_SHOPLINE_ACCESS_TOKEN`、`WMS_SHOPLINE_MERCHANT_ID`、`WMS_SHOPLINE_HANDLE`，固定版對應單一配置的連線。1Shop 設定 `WMS_1SHOP_STORES_JSON` 每筆使用 `account,appId,secret,shopUrl`，或用 `WMS_1SHOP_SHOP_URLS_JSON` 由 account 查 shop URL；單店相容 `WMS_1SHOP_CONNECTION_ID`、`WMS_1SHOP_APP_ID`、`WMS_1SHOP_SECRET`、`WMS_1SHOP_SHOP_URL`。profile 選擇 API connection 後才啟用即時核對；未綁連線保留檔案方式，已綁定而讀取失敗須處理授權或白名單。`ONESHOP_IP_NOT_ALLOWED` 要求核對 actual egress 白名單。1Shop 組合品、退款、非庫存等不足以唯一核對時保留人工處理，按完整來源 SKU 與經驗證的條碼格式查 ECOUNT 對照。

來源 `backend/src/services/shoplineOrderVerification.js:46-229`、`backend/src/services/oneShopOrderVerification.js:26-186`、`backend/src/services/oneShopSku.mjs`、`backend/src/services/marketplacePreparation.js:71-110`。

### 4. ECOUNT 主檔、銷貨匯入與回傳

1. **商品主檔**由 WMS 伺服器透過 Cloud Storage ADC 讀 `gs://{GCS_BUCKET}/{ECOUNT_REFERENCE_OBJECT}`，來源 JSON `{capturedAt,source,products:[{erp_sku,barcode,product_name,active}]}`。全檔品號唯一，條碼允許留空，保留字串前導零，記憶體快取 60 秒。WMS `POST /api/marketplace-products/resolve` 帶 WMS Bearer 及 `{skus:["TEST-0001"]}`，最多 1,000 個完整編碼；拋單員／管理員可讀 `{sync,products}`，每個編碼回 `status: matched|missing|ambiguous|inactive` 與候選。API 僅查參考資料；維護正式品項與替換 GCS 參考物件由指定權限人員操作。
2. **銷貨檔**由已保存且仍有效的批次產出 `ecount` 或 `ecount-grouped` XLSX。WMS `POST /api/marketplace-intakes/:id/download-link` 帶 `{kind}` 回 `{url,expiresIn:120}` 同時設 path 限定的 HttpOnly 短效 cookie，再用 `GET /api/marketplace-files/:id/:kind` 取得附件。下載重新查使用者角色、草稿版本、整檔 scope 和條碼證據。ERP 原生走專用 `/api/v1/wms/native/files/:id/:kind`。人員在授權 ECOUNT 介面匯入銷貨檔與儲存正式銷貨，這條固定版工作流使用檔案交換，沒有 ECOUNT HTTP 寫單或扣庫端點。
3. **ECOUNT 完整銷貨回匯** `GET /api/warehouse-intakes/receipt-format` 可取欄位 XLSX；在原批次 `POST /api/warehouse-intakes/:id/confirm-sales` 送 `{commandId,expectedActorId,savedSalesConfirmed:true,rows}`，比對 ECOUNT 真實銷貨單號、WMS 批次、店鋪／訂單／明細、倉庫、商品、數量與銷貨金額。建立 WMS 作業資料並保留 `warehouse_hold`，經預揀流程後放行。
4. **理貨回傳與原單續辦**同批 `POST /api/warehouse-intakes/:id/confirm-return` 送 `{commandId,expectedActorId,rows}`，比對可核的原單、應出實體物件與數量、條碼／SN；收據標記 `verificationKind:"warehouse-return",financialVerified:false`，保留正式財務另核。相同指紋可重用，回傳不同或來源已掛工作單時拒絕重建。已有原 ECOUNT 銷貨的訂單沿正式原單續辦。運費以非庫存銷貨列留存金額及稅，預揀依實物明細處理。
5. **回匯後預揀與列印**本版待核對、可列印、指派、掃描、放行分階段，WMS `/api/warehouse-intakes/:id/:action` 查角色、原批次及相同 command ID 的內容指紋。WMS 前端列印使用瀏覽器與原生工作台 CSS，印表機結果由倉庫現場驗收。

來源 `backend/src/services/marketplaceProductCatalog.js:6-29,55-94`、`backend/src/services/marketplaceDownloads.js:5-40`、`backend/src/services/marketplaceBatchFiles.mjs:20-44`、`backend/src/routes/warehouseReleaseRoutes.js:22-54`、`backend/src/services/warehouseRelease.js:61-166`、`backend/src/services/erpSalesReceipt.js:3-94`、`frontend/src/workspace/printing.js:3-13`。

### 5. 批次通知與 realtime

- 授權倉儲主管（`superadmin` 或 `management_scope=all/warehouse` 的 admin）使用 `GET /api/marketplace-batch-notices`，回 `{total,notices}`，最多 50 筆有效、未讀通知。每則含 `noticeId,intakeId,stage,title,batchNumber,platform,store,actorId,actorName,actorRole,createdAt,href`。本人已收到的通知可 `POST /api/marketplace-batch-notices/:noticeId/seen`，回 `{noticeId,seenAt}`。同一批／階段只建一次通知，操作者從該通知的收件者排除。
- 保存後寫 `prepared`（待理貨回匯），ECOUNT 回匯確認後寫 `ready_for_print`（可列印預揀單），同 transaction 和商務狀態寫入，commit 成功才發布事件。存檔、已回匯、已列印和已放行要分別讀狀態。
- Socket.IO 入口 `/socket.io/`，SDK client 預設 websocket，握手 `auth:{token}` 帶有效的 WMS JWT；伺服器檢查 origin、HS256 簽章、當前 ERP session／身分，到期及每 60 秒重查角色範圍。失效發 `session_expired:{code}` 並斷線。server/config 應核對 `CORS_ORIGINS`、`ERP_PORTAL_ORIGIN` 與實際反向代理支援 Upgrade。
- `marketplace_batch_notice` 發送 `{}`，只促請 UI 刷新，詳細資料由收件人權限過濾的 HTTP inbox 提供。`warehouse_tasks_changed` 帶 `{intakeId}`；確實完成預揀放行的新任務按 `new_task` 更新。這組通知為 WMS 內部收件匣及即時刷新，驗收以 DB 通知、使用者權限與 UI readback 為準。

來源 `backend/src/services/marketplaceBatchNotifications.js:3-84`、`backend/src/routes/marketplaceBatchNoticeRoutes.js:4-15`、`backend/src/routes/warehouseReleaseRoutes.js:47-54`、`backend/src/app.js:88-113`、`backend/src/middleware/socketAuth.js:25-70`、`frontend/src/api/socket.js:7-53`、`frontend/src/components/MarketplaceBatchAlerts.jsx:40-56`。

### 6. 綠界物流查詢、列印與回呼

綠界整合獨立於 ECOUNT 商品與銷貨。設定 `WMS_ECPAY_ACCOUNTS_JSON`，每帳號 `id,label,merchantId,environment,services,enabled,verified,hashKey,hashIv`。帳號與 stage／production 分開，支援 `UNIMART,FAMI,HILIFE`，keys 經公司保管。可用帳號必須 `enabled:true,verified:true`，查詢和列印使用 `CheckMacValue`。WMS 帳號清單只回診斷用 DTO，`writeEnabled:false`。

| WMS 方法與路徑 | 外部位置、輸入及效應 |
| --- | --- |
| `GET /api/logistics/accounts` | admin／superadmin。回遮蔽的帳號清單 `{accounts}`，含 `queryReady` |
| `POST /api/logistics/accounts/:accountId/query` | admin／superadmin。提供 `{logisticsId}` 或 `{merchantTradeNo}` 擇一。伺服器對 stage `https://logistics-stage.ecpay.com.tw/Helper/QueryLogisticsTradeInfo/V5` 或 production 對應 `logistics.ecpay.com.tw` POST form，欄位 `MerchantID`、`AllPayLogisticsID` 或 `MerchantTradeNo`、`TimeStamp`、`CheckMacValue`。驗證回應簽章、商店、單號與通路後回正規化物流狀態。只查供應商，這個 WMS query 不保存物流記錄 |
| `POST /api/logistics/accounts/:accountId/import` | 同權限；`{query:{logisticsId 或 merchantTradeNo},orderId?}` 查證後保存 WMS 物流，選擇時附上現有 WMS 工作單關聯 |
| `GET /api/logistics/shipments?offset=0`、`POST /api/logistics/shipments/:id/sync` | 同權限。清單回 `{items,nextOffset}`；sync 用原帳號和物流單號重新讀取並儲存，帳號 merchant 或 environment 不一致回 `ACCOUNT_MISMATCH` |
| `POST /api/logistics/shipments/print-form` | 同權限，`{shipmentIds:[uuid,…]}` 最多 50 筆，須同帳號／環境和通路，回 `{action,method:"POST",fields}`。瀏覽器依回傳送往環境對應 `/helper/printTradeDocument`，用現有物流訂單編號 |
| `POST /api/logistics-callbacks/ecpay/:accountId` | 供綠界，form-urlencoded 上限 32 KB。只有 `WMS_ECPAY_CALLBACKS_ENABLED=true` 才處理；檢查 MAC、帳號及來源識別後記錄回呼，成功回文字 `1\|OK`，停用回 503 `0\|DISABLED`，失敗回 `0\|ERROR`。回呼標記待查，WMS 獨立查證物流狀態 |

錯誤含 `ACCOUNT_NOT_READY`、`PROVIDER_SIGNATURE_INVALID`、`PROVIDER_IDENTITY_MISMATCH`、`PROVIDER_UNAVAILABLE`、`PROVIDER_TIMEOUT`。未知物流代碼顯示 `unmapped` 供核對，不默認已出貨或已退回。此整合範圍是既有物流單查證、狀態、受控匯入與列印相關作業；正式銷貨、金流退款、庫存與實物退貨各有授權與狀態流程。

來源 `backend/src/routes/logisticsRoutes.js:8-74`、`backend/src/services/ecpay/accounts.js:3-24`、`backend/src/services/ecpay/client.js:3-49`、`backend/src/services/ecpay/printing.js:3-14`、`backend/src/services/ecpay/tracking.js`。
