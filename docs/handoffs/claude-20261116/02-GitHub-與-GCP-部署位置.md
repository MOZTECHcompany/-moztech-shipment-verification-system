# 02｜GitHub 與 GCP 部署位置

適用於 WMS 銷貨單轉檔 DEV 版 `ab835f44ef2d9e855360aa6b01fb9216cd70afed`。下列 GitHub 和 Cloud Run 資料於 2026-11-16 17:27（台灣時間）前後重新唯讀核對。服務流量和 IAM 會隨發布變更，操作前再查一次。

## 1. GitHub 程式庫與 CI

| 用途 | 位置及已確認狀態 |
| --- | --- |
| WMS 原始碼上游 | `MOZTECHcompany/-moztech-shipment-verification-system`，GitHub 顯示公開。Clone URL 為 `https://github.com/MOZTECHcompany/-moztech-shipment-verification-system.git`。[WMS GitHub](https://github.com/MOZTECHcompany/-moztech-shipment-verification-system) |
| WMS 預設分支 | 受保護的 `main`，此次查到 `32414652611fcf0e2e3714bf04eb93807f2355c3`。[GitHub main 的實際 commit](https://github.com/MOZTECHcompany/-moztech-shipment-verification-system/commit/32414652611fcf0e2e3714bf04eb93807f2355c3) |
| 交接 DEV 的原始碼 | 使用 ZIP 的 `source/`。此次以完整 SHA 查 GitHub 一般 commit API 得到 422 `No commit found`，Git commit 物件 API 得到 404，該 SHA 的 Deployments 查詢回傳 0 筆。本機開發分支 `codex/wms-historical-review-access-20261118` 已固定該提交。 |
| CI 設定 | `.github/workflows/verify.yml`，名稱 `WMS verification`。監聽 push、PR、workflow dispatch，使用 Node.js 22，安裝前後端 lockfile、執行前後端測試和前端 build。[Workflow 原始檔](https://github.com/MOZTECHcompany/-moztech-shipment-verification-system/blob/main/.github/workflows/verify.yml) · [Actions 執行清單](https://github.com/MOZTECHcompany/-moztech-shipment-verification-system/actions/workflows/verify.yml) |
| GitHub 最近的 main CI | GitHub 回報 `32414652` 對應 run `42995121748` 成功。這筆屬於上述 main SHA。[CI 結果](https://github.com/MOZTECHcompany/-moztech-shipment-verification-system/actions/runs/42995121748) |
| ERP 原生工作台上游 | 本機 ERP 歷史整合工作樹的 origin 為 `moztechCEE/ecom-accounting-system-`，GitHub 顯示公開、預設 main。現行 ERP DEV API 的 `7ce6a06c3b0b037250f073670fe58b96b281ec0b` 在該 repo 查詢回傳 422。若需修改 ERP BFF 或工作台載入器，請向 ERP 持有人取得其獨立部署基線和原始碼。[ERP GitHub](https://github.com/moztechCEE/ecom-accounting-system-) |

`ab835f44` 的實際部署紀錄在 **GCP Cloud Build 與 Cloud Run**。`verify.yml` 的全部 jobs 都是檢查與建置。該次 Cloud Build 的 source provenance 指向上傳的 GCS 建置來源，`buildTriggerId` 為空。在 GitHub 的公開 repo 放入 ZIP 或 DEV 開發分支前，由持有人選定可分享的位置。

## 2. DEV 線上位置

| 系統 | 已核對位置 |
| --- | --- |
| 作業人員入口 | 登入 ERP DEV，切換倉儲公司 `tw-entity-001`，由作業工作台進商城轉檔。[DEV 商城訂單轉檔](https://corely-erp-dev-sp5g377smq-de.a.run.app/warehouse/marketplace?entityId=tw-entity-001) |
| WMS DEV ingress | `corely-wms-dev`，GCP project `moztech-main-db`（專案號 `249593319772`），region `asia-east1`。讀回 revision `corely-wms-dev-histreview-ab835f44` 承接 100% 預設流量，當時共 65 個 tags。容器 `web` 的 Nginx 接 ingress 8080，同 revision 的 container `api` 監聽 3001。[服務與 Revisions](https://console.cloud.google.com/run/detail/asia-east1/corely-wms-dev/revisions?project=moztech-main-db) · [WMS DEV Service URL](https://corely-wms-dev-sp5g377smq-de.a.run.app) |
| WMS DEV HTTP | WMS API 對內與測試使用同一 ingress 的 `/api`，Socket.IO 為 `/socket.io/`。原生工作台正常由 ERP 登入、ERP BFF 和 WMS session 處理權限，API 契約見 [WMS API 與資料契約](03-WMS-API-與資料契約.md)。唯讀讀回 `/health` 為 `ok`、`/ready` 為 `ready`。[Health](https://corely-wms-dev-sp5g377smq-de.a.run.app/health) · [Readiness](https://corely-wms-dev-sp5g377smq-de.a.run.app/ready) |
| ERP 工作台 SDK | `GET /workspace-manifest.json` 讀到固定 SHA、`/assets/workspace-NCdnjIsl.js`、`/assets/workspace-shadow-8e394ea70946300c.css`、`/assets/workspace-portal-2631d9619ff06531.css`。發布時的整份資產 SHA-256 清單在包內 `artifacts/wms-historical-review-access-20261118/promote-readback.safe.json`。[DEV SDK manifest](https://corely-wms-dev-sp5g377smq-de.a.run.app/workspace-manifest.json) |
| ERP DEV 前端相鄰服務 | `corely-erp-dev`，讀回 100% 指向 `corely-erp-dev-carton-v5-api-7ce6a06c`。其 `WMS_PORTAL_URL` 指向 WMS DEV ingress。[ERP DEV revisions](https://console.cloud.google.com/run/detail/asia-east1/corely-erp-dev/revisions?project=moztech-main-db) |
| ERP DEV API 相鄰服務 | `corely-erp-api-dev`，canonical 預設流量 100% 指向 `corely-erp-api-dev-carton-v5-7ce6a06c`。該 revision 的 `WMS_NATIVE_ENABLED`、`WMS_PORTAL_SSO_ENABLED` 為 `true`，`WMS_PORTAL_SERVICE_URL`、`WMS_WORKSPACE_URL` 指向 WMS DEV ingress，`WMS_PORTAL_ENTITY_ID=tw-entity-001`。[ERP API DEV revisions](https://console.cloud.google.com/run/detail/asia-east1/corely-erp-api-dev/revisions?project=moztech-main-db) · [ERP API DEV canonical](https://corely-erp-api-dev-sp5g377smq-de.a.run.app) |
| WMS 向 ERP 查驗 session | WMS revision 的 `ERP_PORTAL_API_URL` 已設為 `https://aftersales-final---corely-erp-api-dev-sp5g377smq-de.a.run.app/api/v1`。該 tag 指向 `corely-erp-api-dev-rl-29eddf86afd3`。保留這項實際配置，除非 ERP／WMS 負責人透過聯合驗證決定換到其他目標。 |
| 正式站識別 | 同 project 的獨立服務為 `corely-wms`。此次只讀看見其預設流量指向 `corely-wms-note-import-e8ce2ce`。本交接使用 DEV 資料庫、bucket、服務及帳號。[正式服務位置](https://console.cloud.google.com/run/detail/asia-east1/corely-wms/revisions?project=moztech-main-db) |

## 3. 把 commit、Cloud Build、映像與流量串起來

1. 本地交付 Git HEAD 為 `ab835f44ef2d9e855360aa6b01fb9216cd70afed`，tree 為 `88c5307c14c52dee8e1e514b8d48bd33fb19e99e`。ZIP 有 510 個 Git 追蹤檔，包含開發、測試與文件。
2. 歷史發布使用 Cloud Build `9875454c-715d-4f65-b1b9-d3bfc058731f`，project `moztech-main-db`，build location `global`。GCP 查到 `SUCCESS`，開始 `2026-11-16 14:03:22`、結束 `14:05:10` 台灣時間。該次發布的來源記錄 451 個檔案，含 materialize 的 `marketplaceBatchFiles`、`marketplaceIntake`、`oneShopSku`、`unifiedMarketplace`。Cloud Build provenance 是 `gs://moztech-main-db_cloudbuild/source/1794808990.945462-5717cdb4bd9241ecbaaef598640513c4.gz#1794809000726224`。這個專案內的物件需要有權限的帳戶讀取。[該次 Cloud Build](https://console.cloud.google.com/cloud-build/builds/9875454c-715d-4f65-b1b9-d3bfc058731f?project=249593319772)
3. 上一步輸出兩個 tag `dev-review-ab835f44ef2d`。Cloud Run revision 的實際內容使用下列 digest。接手比對應讀 digest 及兩容器當時的 `SOURCE_VERSION`。Artifact Registry 位置為 `moztech-main-db / asia-east1 / cloud-run`。[Artifact Registry](https://console.cloud.google.com/artifacts/docker/moztech-main-db/asia-east1/cloud-run?project=moztech-main-db)

| 容器 | Repository image 與 digest |
| --- | --- |
| web | `asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-frontend@sha256:324d104a35cdf1be4145cb68e26b557d85f393ddd512e12a246b4b3e80f30bc3` |
| api | `asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-backend@sha256:f31afb90a76f251cd8f64484f2e317d0ebb2820585e0ffeacd2c02661a117624` |

4. 發布時先在原服務加入 0% 新 revision，預設流量仍在 `corely-wms-dev-manager-refresh-d8d7fa6b`。2026-11-16 14:12:56 台灣時間的發布實票記錄切至新 revision 100%，其餘八服務及九個服務 IAM 保持。對照 `stage-readback.safe.json` 與 `promote-readback.safe.json`。候選階段與 canonical ERP 畫面驗收仍需各自保留證據。
5. 下一次從已提交且乾淨的 Git 工作樹產生建置輸入，可先執行 `node tools/release/prepare-build.cjs /absolute/new-dir dev`。此命令只產出 `build-source/`、`source-manifest.json` 和 `cloudbuild.json`，可在本機核對，`dev` 必須明確指定。這個前後端最小封裝與該次發布的 451 檔 provenance 有各自的清單。後端 Dockerfile 為 `backend/Dockerfile`，前端為 `frontend/Dockerfile.cloudrun`；檢查前端 build arg `VITE_SOURCE_COMMIT` 和 `VITE_DEPLOY_ENV=dev`。Cloud Build、候選 revision、流量操作由共用 DEV 發布窗口執行。

## 4. DEV 資料、權限、秘密參照的位置

| 類別 | 已核對設定及取得位置 |
| --- | --- |
| Cloud Run runtime identity | `corely-wms-dev-runtime@moztech-main-db.iam.gserviceaccount.com`，於 `corely-wms-dev` revision 的 Service Account 欄讀回。[Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=moztech-main-db) |
| DEV Cloud SQL | project `moztech-main-db`、connection name `moztech-main-db:asia-east1:moztech-main-db`、database 與 DB role 為 `corely_wms_dev_20260915`、DB socket `/cloudsql/moztech-main-db:asia-east1:moztech-main-db`。Unix socket 設定 `DB_SSL_MODE=disable`。SQL database metadata 讀到 UTF8。由 DEV 管理者管理 Cloud SQL client 權限及 DB role。[Cloud SQL instance](https://console.cloud.google.com/sql/instances/moztech-main-db/overview?project=moztech-main-db) |
| DEV 物件及商品主檔 | `STORAGE_BACKEND=gcs`，bucket `moztech-main-db-corely-wms-dev`，`ECOUNT_REFERENCE_OBJECT=reference/ecount-catalog264-20261027-674ca20916fa.json`。查得 object generation `1793074530679499`，更新時間 `2026-10-27T04:15:30Z`，JSON 大小 1,683,123 bytes。以授權的 Cloud Storage metadata 核對指標和版本。[DEV bucket](https://console.cloud.google.com/storage/browser/moztech-main-db-corely-wms-dev?project=moztech-main-db) |
| Secret Manager 注入 | WMS `api` 容器的 Secret 參照環境變數為 `PGPASSWORD`、`JWT_SECRET`、`ERP_PORTAL_SHARED_SECRET`、`WMS_SHOPIFY_ACCESS_TOKEN`、`WMS_SHOPLINE_ACCESS_TOKEN`、`WMS_1SHOP_STORES_JSON`、`WMS_SHOPIFY_OMFUTURE_CLIENT_SECRET`。秘密值與綁定版本透過公司授權的 Secret Manager 和 Cloud Run revision 設定取得。[Secret Manager](https://console.cloud.google.com/security/secret-manager?project=moztech-main-db) |
| WMS/ERP 旗標 | WMS DEV 讀到 `ERP_PORTAL_ONLY=true`、`ERP_PORTAL_SSO_ENABLED=true`、`WMS_DRAFT_OVERWRITE_ENABLED=true`、`WMS_MIXED_REEXPORT_ENABLED=true`、`WMS_ECPAY_CALLBACKS_ENABLED=false`，`ERP_PORTAL_ORIGIN` 為 canonical ERP DEV origin，`ERP_PORTAL_ENTITY_ID=tw-entity-001`。其 `NODE_ENV=production` 是容器執行模式，環境識別依 GCP service、DEV DB、DEV bucket 和實際流量。 |

### 已部署 revision 的 Secret Manager 參照

下列為 project `moztech-main-db` 的資源識別與版本參照。所有秘密值均由公司授權的 runtime identity 注入。另開環境時，應以該環境核准的 Secret Manager 資源與版本作設定。

| WMS api 的環境變數 | Secret Manager 資源 ID | 此 revision 綁定版本 |
| --- | --- | --- |
| `PGPASSWORD` | `corely-wms-dev-db-password` | `1` |
| `JWT_SECRET` | `corely-wms-dev-jwt` | `1` |
| `ERP_PORTAL_SHARED_SECRET` | `corely-erp-wms-dev-workspace-20260923` | `1` |
| `WMS_SHOPIFY_ACCESS_TOKEN` | `ecom-accounting-shopify-admin-token` | `1` |
| `WMS_SHOPLINE_ACCESS_TOKEN` | `ecom-accounting-shopline-access-token` | `2` |
| `WMS_1SHOP_STORES_JSON` | `ecom-accounting-oneshop-stores-json` | `1` |
| `WMS_SHOPIFY_OMFUTURE_CLIENT_SECRET` | `wms-dev-shopify-omfuture-client-secret` | `1` |

## 5. 接手及回滾檢查

- 使用包內 `source/` 的固定 SHA 建立獨立開發分支。需要查祖先、合併或 PR 時，由專案持有人提供有完整歷史的 Git 與上傳目的地。公開上游可參考既有 CI 和舊程式。
- 開工先以有權限的帳號重查 WMS、ERP 與共用 DEV revision、image digest、流量、tags、IAM、資料連線及掛載來源。核對候選／canonical 的 `/ready`、SDK manifest、JS/CSS SHA、登入後原生工作台和業務預覽。這些結果、真實資料保存、ECOUNT 入帳以及實體掃碼各自有驗收紀錄。
- 在每次調整前保留實際的上一個穩定 revision、流量百分比及 tags。這次歷史上代 revision 為 `corely-wms-dev-manager-refresh-d8d7fa6b`。需要回滾時，請當次發布負責人依操作前實況與相容性恢復 WMS 目標 revision，再核對 ingress、資料庫、ERP 掛載及測試預覽。
- 本文件的部署查證使用 GitHub repo、branch、workflow、commit 和 deployments API，Cloud Build 及 Cloud Run describe，SQL database、GCS object metadata 和 WMS 唯讀端點。此查證範圍是版本與入口。正式銷貨、庫存、通知、商品對照的驗收使用已核准的操作流程。
