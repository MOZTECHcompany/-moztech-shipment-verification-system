# WMS 開發與正式發布規則

使用者於 2026-09-15 明確指定：往後 WMS 一律先在 DEV 開發、測試與驗收；開發完成並確認無誤後，再依當次發布範圍更新正式環境。本規則不代表現在切換正式站，也不建立測試通過就自動上正式的流程。

## 環境

| 用途 | 網址 | Cloud Run | Database | 私有附件 bucket |
|---|---|---|---|---|
| 日常開發與驗收 DEV | https://corely-wms-dev-249593319772.asia-east1.run.app/login | `corely-wms-dev` | `corely_wms_dev_20260915` | `moztech-main-db-corely-wms-dev` |
| 正式作業 | https://wms.corely.cc | `corely-wms` | `corely_wms` | `moztech-main-db-corely-wms-attachments` |

兩者位於 `moztech-main-db`／`asia-east1`，使用獨立帳號、JWT 與附件；Cloud SQL instance 共用，資料庫與權限邏輯隔離。既有 `corely-wms-migration-validation` 是另一個私有驗收環境，不等於日常 DEV，不能順便改動它的 IAM 或資料。

## 固定工作順序

1. 先查核 Git/worktree 與 DEV、正式的實際 revision、流量、映像和資源引用；確定最新 DEV 程式與遠端 main 的差異，在隔離 `codex/` 分支修改。不得以落後的 main 覆寫已完成的 DEV 功能。
2. 保留既有 WMS 功能、資料與角色權限。執行相關單元測試與建置；SQL、掃碼、認領與權限變更另跑隔離 PostgreSQL／瀏覽器回歸。
3. 新功能先發布 DEV，使用合成資料驗證匯入、理貨批次、商城子單、揀貨、裝箱、SN、列印及此次受影響的既有流程。DEV 開發測試不得連到正式資料庫，也不得藉測試提交真實 ERP 扣庫存或物流交易。
4. 開發及 DEV 驗收完成後，依使用者已確認的發布範圍準備正式版；以同一已驗收程式來源產生正式建置，確認正式設定與登入、權限、關鍵流程。保存回復點，建立正式零流量候選後再切換。
5. 發布的是已驗收程式、必要設定與 schema migration。DEV 測試訂單、帳號、密鑰、附件及 dump 不搬進正式；正式原有資料與權限保留。Migration 使用明確指定目標資料庫的獨立工作。
6. 上線後讀回正式 revision／流量／映像、確認正式網址與關鍵操作。回退保留現有資料，不用舊 dump 覆蓋。回報分清楚本機提交、GitHub 推送、DEV 部署、正式候選、正式部署與資料變更。

## 建置差異

- DEV：`node tools/release/prepare-build.cjs /absolute/new-output-dir dev`，畫面及分頁顯示 DEV。
- 正式：省略最後 `dev`；正式前端不可帶 DEV 標示，建置後需驗證。前端環境標示不同，不能把 DEV web digest 直接當正式 web digest；以驗證過的正式建置 digest 發布。
- GitHub CI 僅驗證，不自動部署。一次測試通過不等同業務驗收完成，亦不代表已發布正式。

本規則記錄時，DEV 應用版本為 `3eca2e65438e2206b5ef58d10b3ccc9f5886f720`，正式仍為 `corely-wms-scan-sound-20260914`。這些是歷史快照，後續工作必須重新查核。新增應用程式尚未推送 GitHub；本地文件提交也不代表網站更新。
