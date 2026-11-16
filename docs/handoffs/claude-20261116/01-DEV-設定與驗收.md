# Corely WMS 銷貨單轉檔｜Claude 設定與開發指南

交接原始碼固定為 `ab835f44ef2d9e855360aa6b01fb9216cd70afed`。2026-11-16 14:12（台灣時間）的發布讀回紀錄記載，當時 WMS DEV 預設流量 100% 指向 `corely-wms-dev-histreview-ab835f44`，工作台 SDK 的 sourceCommit 與交接版相符。接手後請先重新讀取實際部署，再記錄版本與能驗證的範圍。操作流程、例外情境與業務決策見交接 Word 主文件。[部署位置與憑證參照](02-GitHub-與-GCP-部署位置.md) 和 [API 與資料契約](03-WMS-API-與資料契約.md) 供設定及開發對照。

## 1. 接手前的環境確認

| 項目 | 查證位置或方式 |
| --- | --- |
| WMS Git 與分支 | 在包內 `source/` 找 `backend/`、`frontend/`、`tools/release/` 及 `.github/workflows/verify.yml`。執行 `git rev-parse HEAD`、`git status --short`、`git worktree list`。包內 Git 已保留單一固定提交，追溯舊提交或合併其他分支需要公司的授權 Git 來源 |
| ERP 工作台 | DEV 入口為 [商城訂單轉檔](https://corely-erp-dev-sp5g377smq-de.a.run.app/warehouse/marketplace?entityId=tw-entity-001)。透過正常 ERP 登入、切換有權限的倉儲公司後進入 |
| GCP | 本次讀回 GCP project 為 `moztech-main-db`，Cloud Run 服務名為 `corely-wms-dev`，區域為 `asia-east1`。接手時與持有人重新確認 Cloud SQL database、registry、bucket、Secret 版本及帳號的 IAM。另核對 ERP 和其他共用 DEV 服務的 revision、流量、tags 與 image digest |
| 權限與保管人 | 分別確認程式倉庫、GCP DEV 發布與回滾、ERP DEV 操作帳號、Shopify 商店 App 授權、ECOUNT 主檔維護與出貨驗收的人員。Claude 是否可用這些連線，取決於執行環境當下可用的身份 |
| 資料 | 取得核准的 DEV 測試 CSV/XLSX 或去識別 fixture。Shopify shopper、訂單收件資料、ERP session、DB dump 與憑證留在原系統。跨環境複製業務資料前請向資料持有人確認 |

移交過程應保留可比對的 commit、Cloud Run revision、流量百分比與映像 digest。Cloud Run 的 Ready、HTTP 200、頁面渲染、業務預覽與實體驗收各自記錄。

包內 `artifacts/packaging/DEV-ab835f44-readback.safe.json` 記錄本次查到的 DEV 流量、前後端 image digest、選定的非秘密設定及必須由 Secret Manager 提供的環境變數名稱。ECOUNT 主檔請依該表讀回 GCS 指標與版本。ERP 主系統的工作台掛載與 Cloud SQL 連線內容，從公司授權的現行設定取得。

## 2. 本機啟動與測試

CI 使用 Node.js 22。請在包內的 `source/` 目錄執行下列命令，使用已提交的 lockfiles。

```bash
node --version
npm ci --prefix backend
npm ci --prefix frontend

npm run test:unit --prefix backend
node --test backend/tests/cartonTransactions.test.cjs
node --test backend/tests/oneShopOrderVerification.test.cjs backend/tests/shoplineOrderVerification.test.cjs
npm test --prefix frontend
npm run build --prefix frontend
```

建立專用本機 PostgreSQL database 與專用開發角色。下列名稱是範例，先建好 database 及權限、透過目前終端工作階段注入對應的 `PGPASSWORD`，並留意不要在 shell history 或輸出紀錄留下值。遷移與後端啟動使用同一組 DB 設定。進行遷移時，`WMS_TARGET_DATABASE` 必須與實際連線的 DB 名相同。

```bash
export NODE_ENV=development
export PGHOST=127.0.0.1
export PGPORT=5432
export PGDATABASE=wms_local_dev
export PGUSER=wms_local_dev
export WMS_TARGET_DATABASE=wms_local_dev
export DB_SSL_MODE=disable
export STORAGE_BACKEND=local
export JWT_SECRET="$(openssl rand -hex 32)"
npm run migrate --prefix backend
npm run dev --prefix backend
```

```bash
# 另一個終端，從同一個 WMS 根目錄執行
npm run dev --prefix frontend
```

Vite 通常開在 `http://localhost:5173`，以啟動輸出為準。其 `/api`、`/socket.io` 代理預設指向 `http://127.0.0.1:3001`。Express 預設埠 3001。可用 `curl --fail http://127.0.0.1:3001/health` 檢查程序，以及 `curl --fail http://127.0.0.1:3001/ready` 檢查 DB schema 與啟動依賴。走實際業務預覽還需要對應的商城及參考主檔設定。

如需全新的本機測試管理員，`backend/scripts/bootstrap-admin.js` 是離線一次性入口。由 `WMS_BOOTSTRAP_SECRET_FILE` 傳入權限受限的絕對路徑，JSON 使用 `username`、`name`、`password`，密碼至少 16 字元且最多 72 UTF-8 bytes。空 DB 遷移完成後，使用同一組本機 DB 變數執行 `node backend/scripts/bootstrap-admin.js`。程式會驗證 database、schema 和使用者表，既有使用者或初始化紀錄會拒絕再次執行。共用 DEV 請使用正常 ERP SSO 與既有作業帳號。

`backend/src/config/runtime.js` 負責 DB、CORS 與 Socket 來源限制。非 production 模式要求 PostgreSQL 為 loopback。production 模式需要精確的 `CORS_ORIGINS`，Cloud SQL Unix socket 路徑下 DB 預設停用連線層 TLS，其他 production 連線預設 `verify-full`。`DB_SSL_MODE` 只接受 `disable`、`verify-full`，`DB_POOL_MAX` 預設 10，允許 1 到 100。設定 `DATABASE_URL` 時由其提供連線細節，SSL 仍由 `DB_SSL_MODE` 決定。

## 3. ERP、WMS 與角色

| 設定 | 作用 |
| --- | --- |
| WMS `ERP_PORTAL_ONLY` | `true` 時要求從 ERP 工作台進入，WMS 本身帳密入口與未經 ERP 的 session 不適用 |
| WMS `ERP_PORTAL_SSO_ENABLED`、`ERP_PORTAL_API_URL`、`ERP_PORTAL_ORIGIN`、`ERP_PORTAL_ENTITY_ID` | 啟用 ERP session 驗證及實體公司範圍，origin 需為完整 HTTPS origin。Portal 內核對需在操作員本來就有權限的公司 |
| WMS／ERP `ERP_PORTAL_SHARED_SECRET`／`WMS_PORTAL_SHARED_SECRET` | Portal 發行端和驗證端需採同一秘密，WMS 驗證設定至少要求 32 字元。只在各自 runtime 以 Secret Manager reference 注入 |
| WMS `CORS_ORIGINS`、`JWT_SECRET` | CORS 名單傳入實際允許的 origin。JWT 值由憑證管理流程注入 |
| ERP 對應 `WMS_NATIVE_ENABLED`、`WMS_PORTAL_SSO_ENABLED`、`WMS_PORTAL_SERVICE_URL`、`WMS_PORTAL_ENTITY_ID`、`WMS_WORKSPACE_URL`、`WMS_PORTAL_URL` | ERP 部分需在其實際部署版本另查。WMS ZIP 不提供 ERP repo。驗收必須進 ERP 的原掛載路由，讀取當時真正載入的 WMS assets |
| `WMS_DRAFT_OVERWRITE_ENABLED`、`WMS_MIXED_REEXPORT_ENABLED` | 各自只接受字串 `true` 開啟，未設定預設關閉。兩者是獨立功能旗標，需核對 DEV revision 的實際值再驗證未匯入草稿覆蓋與整份混合重轉 |
| `VITE_DEPLOY_ENV`、`VITE_SOURCE_COMMIT`、`VITE_API_BASE_URL`、`SOURCE_VERSION` | DEV build 標記、前端資產路徑識別、前端 API base 與部署來源識別。前端資產在建置時嵌入 commit，未設時用 `development`。ERP 掛載情境保留正式的 proxy/API origin 設定 |
| `WMS_ECPAY_CALLBACKS_ENABLED` | 此轉檔測試不用回呼，維持該環境既有設定。本機預設拒收，只有字串 `true` 才開啟 |

ERP 工作台的權限檢查和 WMS 執行期角色都要通過。以一般作業人員的 session 做上傳與預覽，以既有具 `wms_admin` 權限的帳號驗證歷史促銷明細更正。品項有多個可能或未能證明對應時，保留待核對。顯示可操作的欄位、按鈕啟用、保存、重新核對通過與產生檔案是不同的測試步驟。

## 4. Shopify 和店鋪資料

WMS 一方面辨識 CSV 的平台格式，另一方面根據已設定的店鋪連線與中繼資料選擇查單對象。兩個品牌即使使用同一種 Shopify 匯出格式，也應分別保有正式 `.myshopify.com` domain、連線 ID 與客戶／倉庫 profile。`www-omfuture.myshopify.com` 和 `omfuture.myshopify.com` 是兩套不同連線。營運環境不可以檔名或相似訂單號代替店鋪身份。

`WMS_SHOPIFY_CONNECTIONS_JSON` 是後端 JSON 字串。以下可作 schema 範例，實際 domain、Secret 環境變數及 ID 請由專案持有人提供，兩個示意 domain 請勿連線。

```json
[
  {
    "id": "demo-static",
    "shop": "example-store.myshopify.com",
    "authKind": "static_token",
    "tokenEnv": "WMS_SHOPIFY_EXAMPLE_ACCESS_TOKEN",
    "apiVersion": "2026-07"
  },
  {
    "id": "demo-client",
    "shop": "example-second.myshopify.com",
    "authKind": "client_credentials",
    "clientIdEnv": "WMS_SHOPIFY_EXAMPLE_SECOND_CLIENT_ID",
    "clientSecretEnv": "WMS_SHOPIFY_EXAMPLE_SECOND_CLIENT_SECRET",
    "apiVersion": "2026-07"
  }
]
```

檔內只放憑證的環境變數名稱。把相應 Secret 版本綁定至 WMS backend runtime，不要放入前端 `VITE_*` 或平台設定 JSON。使用授權過的唯讀 scope `read_orders`、`read_products`，確認 App 已安裝在正確的 Shopify 商店、可取得所需訂單欄位。API 版本 `2026-07` 為固定程式預設值，接手時應透過開發測試核對相容性。程式亦支援單店相容變數 `WMS_SHOPIFY_SHOP`、`WMS_SHOPIFY_ACCESS_TOKEN`、`WMS_SHOPIFY_API_VERSION`。既有多店使用 JSON 註冊表時，先讀回已遮蔽敏感欄位的連線清單再增修。此次 DEV 的萬魔讀單連線使用 `WMS_SHOPIFY_OMFUTURE_CLIENT_ID` 和 Secret 參照 `WMS_SHOPIFY_OMFUTURE_CLIENT_SECRET`，由公司授權的 DEV 憑證來源提供。

店鋪設定 API 基底為 `/api/marketplace-intakes`。該路由允許 `admin` 或 `dispatcher`，本機既有 `superadmin` 亦可依角色中介層存取。DEV 以正常 ERP 作業授權進入。透過 `GET /store-connections`、`GET /store-profiles` 核對啟用連線、domain 與 profile。連線清單的 `connectionReady` 只反映憑證欄位已配置，再用 `POST /api/marketplace-intakes/preview` 或工作台預覽驗證商店端讀單。下例是先前使用者確認的萬魔官網 DEV 設定，需要先查現有資料，避免重建已存在的 profile。某環境的流水 ID 不適用其他環境。

```json
{
  "platform": "Shopify",
  "createOnly": true,
  "settings": {
    "store": "萬魔未來工學院 Shopify 官網",
    "apiConnectionId": "omfuture-orders",
    "shopifyShop": "omfuture.myshopify.com",
    "customerCode": "02082",
    "customerName": "萬魔未來工學院(shopify)",
    "warehouseCode": "003",
    "currency": "TWD",
    "taxMode": "erp_inclusive",
    "taxType": "11",
    "taxConfirmed": true
  }
}
```

支援 `POST /store-profiles` 搭配 `createOnly` 建立；修改既有 profile 時，傳 `profileId` 與原 `updated_at` 作 `expectedUpdatedAt`，讀取到 409 時重新讀回並比對。實際 `store` 必須沿用該環境現有字串，守衛以同一平台、店鋪名及版本比對。承辦人、專案及外部貨幣編碼如有設定，程式要求額外的對應確認欄位。若需配置運費品項，在確認 ECOUNT 非庫存運費後用 `shippingSku` 與 `erpSku`、`name`、`confirmed`、`nonStock` 表達。測試應驗證正式銷貨仍保留運費金額，WMS 實物掃描則正確略過該非實體品項。

SHOPLINE 設置入口以 `WMS_SHOPLINE_CONNECTION_ID`、`WMS_SHOPLINE_ACCESS_TOKEN`、`WMS_SHOPLINE_MERCHANT_ID`、`WMS_SHOPLINE_HANDLE` 為主。1Shop 可使用 `WMS_1SHOP_STORES_JSON`、`WMS_1SHOP_SHOP_URLS_JSON`，或相容用 `WMS_1SHOP_CONNECTION_ID`、`WMS_1SHOP_APP_ID`、`WMS_1SHOP_SECRET`、`WMS_1SHOP_SHOP_URL`。其店鋪結構與驗證由 `backend/src/services/oneShopOrderVerification.js` 定義。這些配置需向各平台帳號的持有人取得，既有 Shopify App 不涵蓋其他平台。既有萬魔 runtime 用 `WMS_SHOPIFY_OMFUTURE_CLIENT_ID`、`WMS_SHOPIFY_OMFUTURE_CLIENT_SECRET` 兩個名稱綁定 Secret，交接只需提供名稱與保管人。

## 5. ECOUNT 主檔及儲存

在受管的 DEV，依服務規劃設定 `STORAGE_BACKEND`、`GCS_BUCKET` 與 `ECOUNT_REFERENCE_OBJECT`。參考物件格式是 UTF-8 JSON。由指定的 DEV WMS service account 取得物件讀權限，實際為哪些路徑需要可寫儲存，另依部署保管人確認。請先驗證正確的 bucket、object generation、更新時間與資料筆數再測試。

```json
{
  "capturedAt": "2026-11-16T00:00:00Z",
  "source": "synthetic-dev-fixture",
  "products": [
    {
      "erp_sku": "TEST-0001",
      "barcode": "",
      "product_name": "DEV 測試品",
      "active": true
    }
  ]
}
```

`backend/src/services/marketplaceProductCatalog.js` 讀取至少一筆資料，`erp_sku` 需為非空的唯一字串，`barcode`、`product_name` 是字串，`active` 是布林值。條碼未知可保留空字串，由審核流程處理；保留品號字串前導零。主檔有效時，讀取有一分鐘記憶體快取。設定了物件路徑而讀取或格式驗證失敗時，應查權限、JSON 和 generation。辨識到相同條碼對應多個品項、品項停用、條碼與 SKU 指向不同品項等情況，必須留待實物核對；主檔參考讀取不會自己改寫 ECOUNT 的正式品項。

## 6. 發布與回滾操作

1. 先從包內 Git 的固定 HEAD 開發，例如在 `source/` 執行 `git switch -c codex/wms-claude-dev`。在隔離工作樹重跑第 2 節。保留原 lockfiles 和目前 commit。調整功能須另做 commit，一併記錄測試與差異。
2. `node tools/release/prepare-build.cjs /absolute/path/to/new-release-output dev` 需要乾淨且已提交的 Git checkout。它由固定 HEAD 產出 `build-source/`、`source-manifest.json`、`cloudbuild.json`，並準備前後端共用的 `marketplaceBatchFiles.mjs`、`marketplaceIntake.mjs`、`unifiedMarketplace.mjs`、`oneShopSku.mjs`。在提交給 Cloud Build 前讀取產出的 build 設定與來源 manifest。Cloud Build 根目錄使用 `build-source/`，config 指向產出的 `cloudbuild.json`，分別用 `backend/Dockerfile` 及 `frontend/Dockerfile.cloudrun`。腳本的 image registry 固定為歷史 DEV 專案設定，改至其他 GCP 專案時要由持有人確認目的 registry。Nginx ingress 預設 8080，前端設定把 `/api/`、`/socket.io/`、`/health`、`/ready` 代理到 localhost:3001，因此同服務的 backend sidecar 實際必須監聽 3001。
3. 由有權的 DEV 發布人員重新查共用服務 revision、image digest、流量、tag、runtime identity、Secret reference 和工作台掛載來源。記錄當下的穩定 revision 與 digest，注意 ERP 及 Source 可能已因別的發布而變更。對照目前實況聚焦 WMS 調整。
4. 映像建置後使用 digest 鎖定候選，依中央流程以無主流量 revision 驗證。對照 build manifest、`/health`、`/ready`、API 權限、`/workspace-manifest.json` 及其 JS/CSS 各檔雜湊。若需要 schema 變更，由遷移 job 對已確認的 DEV database 執行，先確認向後相容性。固定版以既有 schema readiness 驗證當下 DB。
5. 用既有 ERP 路徑與允許的作業帳號重做唯讀預覽。若 ERP native loader 的正式掛載仍指向現行 WMS，須等中央安排實際掛載或受控發布後再認定候選的 ERP UI。切換後再從 canonical ERP 入口讀回實際載入的版本和資產，更新九服務證據。只透過正常登入授權的瀏覽器操作。
6. 回滾應由中央把 WMS 流量指回當次發布前已記錄的穩定 revision，再驗證 image、流量、首頁、`/ready`、ERP 掛載與唯讀訂單預覽。若改過設定或 schema，按該次版本相容性和變更紀錄處理。舊的部署腳本或舊流量號碼不足以代表這次回滾狀態。

## 7. 交付基線與待驗收事項

| 情境 | 要確認的結果 |
| --- | --- |
| 萬魔 Shopify | `omfuture-orders` 對 `omfuture.myshopify.com`，`02082／003／TWD／含稅 5%（11）`。先做讀單與轉檔預覽。歷史已讀回 `FU1058`、`FU1059`、`FU1061` 的商店訂單，當次皆已履約，因此需用可轉的新單補驗正常產檔流程 |
| 原雙 11 促銷變體已刪除 | 以剩餘穩定的訂單 line identity 與 SKU 核對，保留歷史對照，按權限與實際包裝條碼驗證。`4711299274572` 極簡黑、`4711299274589` 柔光白的品號與實物條碼曾經使用者確認，個別來源明細的待核對應以憑證和現時主檔為準 |
| 混合整份重轉 | 測試新單、未異動和變更項目同檔。核對畫面預設突出變更與確定的「原 → 改為」。只有可覆蓋草稿才走明確確認後取代舊檔；正式 ECOUNT 既有銷貨單須沿正確原單續辦 |
| 部分退款 | 用核准測資驗證取消品項與新金額。有歷史決策的例子 #155297 為 NT$1,080，差額 NT$40.37 列折讓。其結果及來源依當時的訂單證據，規則須保留每筆依據 |
| 已有正式原銷貨 | #154994 原 ECOUNT 銷貨單保留，沿原單／原批次 52 保存對應，正式銷貨及扣庫只發生一次。需要原 ECOUNT 理貨回匯檔、對的人員及實體作業配合才能驗收 |
| 商品對照欄位與角色 | 用有相同限制的一般作業帳號測試，包括無 Shopify 條碼、ECOUNT 參考條碼空白、需要手輸或掃描、要由管理員核對的歷史明細。實體條碼、確認保存與重新轉檔應分別驗證 |
| 運費與理貨回匯 | 保留 ECOUNT 運費與稅務，確認非庫存運費 `00001` 不增加 WMS 掃件需求。倉庫實際掃碼、出貨和印表機另需指定人員及核准測資 |
| 本次交接 | 原碼、設定指引與歷史案例可用於開發。Claude 執行環境取得權限、以目前 DEV 做實際登入、查看雲端當下版本、正式 ECOUNT 入帳與實體刷印，都需另有實際驗證記錄 |
