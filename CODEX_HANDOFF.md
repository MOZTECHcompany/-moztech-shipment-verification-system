# Corely AI WMS 接手入口（2026-09-14）

本目錄是現行 WMS 的 Cloud Run 維護線。舊 repo 的 d4e2bff 是功能比對基準，不是目前正式程式；原先搬遷前的部署說明僅可作歷史參考。

## 正式環境與界線

- 網址：https://wms.corely.cc
- 公司專案：moztech-main-db；Cloud Run：asia-east1 / corely-wms。
- Cloud SQL 共用 instance：moztech-main-db；WMS 專用 database：corely_wms。不要修改同 instance 的 ERP 等其他資料庫。
- 附件：私有 Cloud Storage `moztech-main-db-corely-wms-attachments`；秘密使用 Secret Manager，不存 Git。
- 新功能驗收：私有 Cloud Run `corely-wms-migration-validation`，獨立 `corely_wms_migration_20260913` database 與附件 bucket；不能將正式 database 指給測試。
- Render 舊 DB 在切換時已關閉新連線；不能解除鎖定、重跑切換腳本或把舊 dump 蓋回正式資料庫。
- 庫存維持記錄用途，尚未啟用自動扣庫存。物流實際建單、退款、ERP 入帳不得當作驗收資料操作。

## 從哪裡確認進度

- `docs/WMS_SCAN_RECOVERY_2026-09-14.md`：最新掃碼錯誤恢復、個人音效及 2026-09-14 正式發布記錄（程式 407c572）。

- `docs/WMS_FULL_PARITY_2026-09-14.md`：58 項功能、239 個舊介面控制點、63 個業務 API 與瀏覽器流程的驗證記錄。
- `docs/WMS_CUTOVER_RESULT_2026-09-13.md`：資料搬遷、合併使用者與回復界線；兩筆歷史附件原檔缺失須另行處理。
- `docs/WMS_WORKSTATION_RELEASE_2026-09-14.md`：本次 UI／維護調整、現況查核與部署結果。
- 正式版本必須即時讀回 Cloud Run revision、traffic、image digest，不能把任何交接文件當作目前版本。

## 本機驗證

Node.js 22；分別在 backend、frontend 執行 `npm ci`。開發設定僅允許 loopback 資料庫；不要自動載入舊 `.env`。

```sh
npm run test:unit --prefix backend
npm test --prefix frontend
npm run build --prefix frontend
```

真實 PostgreSQL 回歸另需本機專用 PostgreSQL 17，固定 `127.0.0.1:55441`，測試帳號 `wms_replay`／`wms_replay_local_only`，可建立可刪除測試 database。測試會建立隨機資料庫，完成後只刪除自己的測試資料庫。

```sh
WMS_PARITY_PG_TEST=1 WMS_PARITY_BROWSER=1 node --test backend/tests/warehouse-parity.pg.test.cjs
```

瀏覽器 harness 需要 Playwright（預設從 node_modules 解析，也可用 `WMS_PLAYWRIGHT_MODULE` 指向安裝路徑）；可用 `WMS_CHROME_EXECUTABLE` 指定 Chrome，省略則使用 Playwright Chromium。測試用瀏覽器獨立於使用者登入的瀏覽器。

## 維護與發版

- 應用啟動只檢查 schema，migration 使用獨立 release job 與明確 `WMS_TARGET_DATABASE`；不在正式環境試跑。
- `npm run retention --prefix backend` 預設只讀預覽，仍須注入資料庫連線與 `WMS_TARGET_DATABASE`。只有明確設定 `WMS_RETENTION_APPLY=true` 才會刪除；先確認保留政策與備份，不設定自動清理排程。
- `.github/workflows/verify.yml` 只跑測試及編譯，不自動部署，也不注入正式秘密。
- 在乾淨提交上執行 `node tools/release/prepare-build.cjs /absolute/new-output-dir`，產生逐檔 SHA256、commit 與 Cloud Build 設定；不包含未追蹤資料、秘密、附件或依賴目錄。
- 先部署私有驗收服務，再以相同 digest 建立正式 0% 候選 revision；測試通過、重新核對正式 traffic 與其他工作區後才切換。
- 發版前後以唯讀 transaction 比對正式資料，保留上一 revision。回退程式不代表可還原舊資料庫，避免遺失新站已新增的資料。
- 原 GitHub `MOZTECHcompany/-moztech-shipment-verification-system` 的 main 仍是 d4e2bff；2026-09-14 本機 gh 身分 MOZTECH-Main 僅有讀取權。不能宣稱本次已推送 GitHub；待取得寫入權或指定公司儲存庫後才發布。
- 多份工作區仍在開發，請先讀 `git worktree list` 與各自狀態，在隔離 `codex/` 分支處理；不可覆盖 WMS／ERP 整合工作區。
