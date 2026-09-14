# GitHub 最新程式同步（2026-09-14）

原 GitHub `MOZTECHcompany/-moztech-shipment-verification-system` 的 `main` 曾停在 `d4e2bff12545d9243787d52850c16f36e1db4eed`，Cloud Run 維護線存在另一份本機 Git history。此次依使用者要求將最新維護線接回原 repo，讓另一個 Codex 可由同一 GitHub 取得現行程式。

## 合併來源與範圍

- 原 GitHub main：`d4e2bff12545d9243787d52850c16f36e1db4eed`。
- 最新完整維護快照：`08f977a95bd9a94cd8da00a6ef0ceafb320a7b8a`，包含已部署程式 `407c5729bbc7dfaffa1205c604f949c12633a664`。
- 在全新隔離 clone／`codex/wms-github-sync-20260914` 分支建立雙親合併，保留兩段歷史；合併後完整檔案樹先核對與維護快照一致，再加入本次文件與 Vercel Git 部署防護。
- 不 force-push、不改保護規則、不改原本帶有未追蹤交接文件的 checkout，也不改其他 WMS／ERP 工作區。
- 移除 GitHub 舊快照追蹤的 node_modules 等舊內容，是以目前正式維護快照為準；依賴透過 lockfile 和 `npm ci` 還原。
- 本次不改 WMS runtime 業務程式、不部署新 Cloud Run revision、不跑資料遷移。

## 舊部署防護

- Render API `srv-d13f02re5dus73emj2ag` 與前端 `srv-d129nsemcj7s73f5bo8g` 的 Auto-Deploy 已改為 Off，儲存後讀回確認；兩者 PR Previews 原已為 Off。
- 原 GitHub 有 Vercel commit status，代表仍須防範旧自動部署；在 repo 根目錄與 `frontend/` 放置 `vercel.json` 的 `git.deploymentEnabled: false`，涵蓋兩個可能的 frontend project root。這是程式庫層的防護，不代表已解除 Vercel 帳號層 Git 連結。
- Vercel 官方設定說明：https://vercel.com/docs/project-configuration/git-configuration
- GitHub 舊 retention workflow 已以只測試／編譯的 `verify.yml` 取代，CI 不注入正式 DB 或雲端秘密。
- 公司 Cloud Build 在 global / asia-east1 沒有找到本 WMS 對應自動 trigger；Cloud Run 此次不發版。

最新接手方式、雲端資源、測試／部署入口及未完成事項見 [雲端交接](WMS_ENVIRONMENT_HANDOFF_2026-09-14.md)。歷史發布文件中的「GitHub 尚未更新」保留為當時紀錄，本次後以遠端 `main` 為共同維護入口。

## 同步驗證

- 在新 clone 重新 `npm ci` 後，後端單元測試 155/155、前端測試 106/106、前端 Vite build 通過；本機 Node.js 24.19.0，GitHub CI 指定 Node.js 22。
- 本次與維護來源的差異僅交接文件及兩個 `vercel.json`；應用程式、SQL migrations、測試與 lockfile 不變。編譯仍有部分大 chunk 提示，列為後續效能維護事項。
- 來源維護線 17 個提交未追蹤 `.env`、秘密、資料庫備份／dump；來源工作目錄保持乾淨。
- PostgreSQL 與瀏覽器正式前验收沿用既有掃碼發布證據（本機 34/34、私有雲 UI 12/12）；此次沒有把 GitHub 同步當成新的正式功能驗收。
