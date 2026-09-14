# WMS 雲端環境與開發交接（2026-09-14）

本文件供另一台電腦／另一個 Codex 接手。連結提供資源位置，**不會自動授予權限**；使用公司已授權的身分登入。以下 runtime metadata 於 2026-09-14 重新查核；開始修改與發版前仍須讀回現況。

## 程式碼

- 儲存庫：https://github.com/MOZTECHcompany/-moztech-shipment-verification-system
- Clone：https://github.com/MOZTECHcompany/-moztech-shipment-verification-system.git
- ZIP：https://github.com/MOZTECHcompany/-moztech-shipment-verification-system/archive/refs/heads/main.zip
- 接手入口：https://github.com/MOZTECHcompany/-moztech-shipment-verification-system/blob/main/CODEX_HANDOFF.md
- CI：https://github.com/MOZTECHcompany/-moztech-shipment-verification-system/actions/workflows/verify.yml
- 舊版功能基準：`d4e2bff12545d9243787d52850c16f36e1db4eed`。
- 最新部署程式來源：`407c5729bbc7dfaffa1205c604f949c12633a664`；其後 `08f977a95bd9a94cd8da00a6ef0ceafb320a7b8a` 補發布文件；GitHub 同步再加入交接文件與舊 Vercel 部署防護。
- 同步後 `main` 的 SHA 與部署來源 SHA 不相同；不能因此推論正式站漏了程式。請比對實際 runtime source 與映像 digest。

```sh
git clone https://github.com/MOZTECHcompany/-moztech-shipment-verification-system.git corely-wms
cd corely-wms
git status --short --branch
git rev-parse HEAD
git switch -c codex/wms-next-change
```

原電腦最新同步 checkout：`/Users/moztecheason/Documents/moztech-wms-github-sync-20260914`。部署來源 checkout：`/Users/moztecheason/Documents/moztech-wms-scan-recovery-20260914`。协调與歷次測試證據：`/Users/moztecheason/Documents/ChatGPT/AI 儲運管理系統/artifacts/`。這些本機路徑在另一台電腦不存在；請 clone GitHub，不要假設可讀取私有證據或備份。

## Google Cloud 與正式網站

| 項目 | 現況／入口 |
|---|---|
| 正式網站 | https://wms.corely.cc |
| Cloud Run 直接入口 | https://corely-wms-249593319772.asia-east1.run.app |
| 專案／地區 | `moztech-main-db` / `asia-east1`（台灣） |
| 公司帳號 | `info@moztech.cc`，或經公司授權可存取同專案的身分 |
| Cloud Run 服務 | `corely-wms` |
| Cloud Run 控制台 | https://console.cloud.google.com/run/detail/asia-east1/corely-wms/revisions?project=moztech-main-db |
| 本次查核正式 revision | `corely-wms-scan-sound-20260914`，100% 流量 |
| Cloud SQL instance | `moztech-main-db`，PostgreSQL 17；同 instance 有其他系統，不能整個還原或清空 |
| SQL connection name | `moztech-main-db:asia-east1:moztech-main-db` |
| WMS 正式 database／user | `corely_wms` / `corely_wms_prod_20260913` |
| 資料庫控制台 | https://console.cloud.google.com/sql/instances/moztech-main-db/databases?project=moztech-main-db |
| 私有附件 bucket | `moztech-main-db-corely-wms-attachments` |
| 附件控制台 | https://console.cloud.google.com/storage/browser/moztech-main-db-corely-wms-attachments?project=moztech-main-db |
| Secret Manager | https://console.cloud.google.com/security/secret-manager?project=moztech-main-db |
| 映像倉庫 | https://console.cloud.google.com/artifacts/docker/moztech-main-db/asia-east1/cloud-run?project=moztech-main-db |
| Cloud Build | https://console.cloud.google.com/cloud-build/builds?project=moztech-main-db |
| 最新前端建置 ID | `a0b4266b-476b-4203-8600-211655529eca`（asia-east1） |

目前為同一 Cloud Run service 兩個 container：`web`（React/Vite 產物、nginx，8080）及 `api`（Node.js 22、Express、Socket.IO，3001）。nginx 將 `/api` 與 `/socket.io` 轉給 API，使用同一個網域。

Runtime service account：`corely-wms-runtime@moztech-main-db.iam.gserviceaccount.com`。目前最大 instance 為 1；協作／Socket 有 process-local 狀態，未完成跨 instance 協作驗收前不能直接放大 max instances。

查核時映像：

```text
web: asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-frontend@sha256:f7a69eacd8362930f842ec7fdf776fb5907ad60ee483985f7ad4b5b3d52284bf
api: asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-backend@sha256:d1660dca18c5e4d2c6d26e66364ca34f8265083fa8da0415360585c2a96b322b
```

## 登入、秘密與連線

先以 `gcloud auth list` 核對已有登入，所有資源命令明確指定 `--project=moztech-main-db`。另一台電腦若未登入，由使用者完成公司的 Google 登入；不要使用舊個人專案 `gen-lang-client-0351711463`。

```sh
gcloud auth list
gcloud run services describe corely-wms --project=moztech-main-db --region=asia-east1 \
  --format='yaml(status.latestReadyRevisionName,status.traffic,status.url)'
gcloud sql instances describe moztech-main-db --project=moztech-main-db \
  --format='yaml(name,connectionName,databaseVersion,state)'
```

正式 runtime 的秘密引用如下，文件只有名稱與版本，沒有秘密值：

- `PGPASSWORD` → `corely-wms-db-password-20260913:1`
- `JWT_SECRET` → `corely-wms-jwt-secret:2`
- `WMS_ECPAY_ACCOUNTS_JSON` → `corely-wms-ecpay-accounts:2`

Cloud Run 內 PGHOST 為 `/cloudsql/moztech-main-db:asia-east1:moztech-main-db`。需要直接唯讀查核時，使用 Cloud SQL Auth Proxy 綁定 `127.0.0.1` 的未使用 port，秘密只注入有權限的程序，不印到對話或写入 Git。先從當下 runtime 核對 database、user、secret version；不要盲目選 `latest` 或將驗收帳號用在正式環境。

應用登入帳密、個人 gh/gcloud token、資料庫 dump、附件原檔不在 repo。連線／修改權限依公司 IAM 及 repo 權限管理，不能在此文件內另建通用 superadmin 或發放永久憑證。

## 隔離驗收環境

- 服務：`corely-wms-migration-validation`，IAM 私有。
- 控制台：https://console.cloud.google.com/run/detail/asia-east1/corely-wms-migration-validation/revisions?project=moztech-main-db
- 網址：https://corely-wms-migration-validation-249593319772.asia-east1.run.app
- database：`corely_wms_migration_20260913`；user：`corely_wms_app`。
- bucket：`moztech-main-db-wms-migration-20260913`。
- 秘密：`corely-wms-db-password:1`、`corely-wms-migration-jwt:1`。必須先即時核對。
- 本機測試命令及 PostgreSQL／Playwright 設定見 `CODEX_HANDOFF.md`。測試使用合成資料，不能讓測試指向 `corely_wms`。

## 部署方式

1. 先讀 repo/工作樹狀態、遠端 `main`、正式 revision／traffic／digest，確認其他開發者的修改與本次範圍；在自己的 `codex/` 分支開發。
2. Node.js 22 執行 backend/frontend `npm ci`、後端單元測試、前端測試與 build；涉及 SQL、掃碼、權限或舊流程時加跑隔離 PostgreSQL／瀏覽器回歸。
3. 在乾淨提交上執行 `node tools/release/prepare-build.cjs /absolute/new-output-dir`，取得 `source-manifest.json`、`cloudbuild.json` 與 `build-source/`；上傳該 build-source，不上傳整個本機目錄。
4. Cloud Build 使用該輸入建立映像。以現行兩 container spec 為基礎，先更新私有驗收服務；保持驗收用 DB/bucket/secret，實際驗收通過。
5. 用已驗收的相同映像 digest 建立正式 0% 候選。保存並比對原 service spec，只套用本次變更；migration 是獨立、明確指定 database 的 release job，不能靠啟動自動改 schema。
6. 依本次使用者授權完成正式發版與 traffic 切換，重新核對兩個正式網址、登入／權限、關鍵流程、資料一致性與回復點。
7. 優先回退程式 revision 並保留目前資料庫；不要將舊 Render dump 覆蓋已繼續作業的新站。`corely-wms-workstation-20260914` 是本次掃碼版本的上一個正式 revision，未來必須重新查核回復目標。

GitHub Actions 只跑驗證，沒有 Cloud Run 自動部署。歷次 artifacts 裡的部署腳本可能依賴原機器私人 helper，不是可直接複製到另一台電腦執行的部署 CLI。

## 功能、整合與未完成界線

- 必須保留所有舊 WMS 流程，包含匯入／領單／分派、揀貨裝箱、SN、例外及主管審核、訂單異動、新品不良換 SN、釘選備註與留言撤回／回覆／提及／已讀、公告、附件、相機掃碼、列印、匯出、報表、日誌與角色權限。比對入口：`docs/WMS_FULL_PARITY_2026-09-14.md` 及 `docs/legacy-parity/`。
- 最新掃碼修正及八種個人音效已部署；音效偏好依使用者保存在目前瀏覽器，尚未跨裝置同步。仍需現場條碼槍與喇叭試聽。
- 庫存只記錄；不得自動扣庫存、建立退款、銷貨退回或 ERP 會計分錄。`completed` 代表倉內核對完成，不等於已交物流或已送達。
- 綠界 B2C 有兩個帳號設定，可查詢／追蹤與產生官方列印表單；原訂單對應、自動 callback／排程、實際物流建單、逆物流／未取退回後 ERP 作業、熱感機自動列印仍須依需求完成。新竹／順豐直接串接尚未完成。不得把帳號已設定寫成物流全面串接完成。
- AI／ERP 後續以授權的訂單狀態 API、明確事件及可追蹤命令整合；讀取客服狀態不可偷偷領單／改量／扣帳，也不可把內部倉儲狀態冒充物流實際進度。
- 歷史資料已搬到公司 SQL 並有逐筆比對報告，但兩筆舊附件（ID 3、4）在來源已缺原檔，另有舊測試帳號 `lemontst` 在切換後被移除、原因待確認。不要聲稱全部附件無缺失，或未經確認恢復可能已撤銷的登入權限。
- Render 舊站保留；前後端 Auto-Deploy 已於本次同步準備時設為 Off。未停止／刪除舊前端、API 或 DB，缺檔及依賴確認完成前不擅自停用。

## 舊環境（僅追溯，不作新開發入口）

- 舊 Render 前端：https://moztech-shipment-verification-system.onrender.com/
- 舊 Render API：https://moztech-wms-api.onrender.com/
- Render API 控制台：https://dashboard.render.com/web/srv-d13f02re5dus73emj2ag
- Render 前端控制台：https://dashboard.render.com/static/srv-d129nsemcj7s73f5bo8g
- Render DB 控制台：https://dashboard.render.com/d/dpg-d35ci40dl3ps738iagn0-a
- 舊 Vercel：https://moztech-shipment-verification-syste.vercel.app/
- 舊個人 Cloud Run：https://moztech-wms-98684976641.us-west1.run.app/
- 網域 DNS：https://dcc.godaddy.com/control/dnsmanagement?domainName=corely.cc

日後回報分清楚：程式提交／推送、測試、候選、正式部署、資料遷移及待辦。品牌統一 Corely AI；不要修改另一套售後系統或其他 agent 的工作目錄。
