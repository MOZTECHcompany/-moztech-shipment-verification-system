# 批次揀貨／裝箱角色修正與發布（2026-09-17）

## 根因與行為

原工作台僅對 admin / superadmin 顯示批次揀貨，沒有批次裝箱入口；後端既有批次認領支援一般倉儲角色，但介面未串接。此版本恢復 picker 的批次揀貨，並開放 packer 的批次裝箱。

- picker：批次選取待揀貨，或尚未認領的揀貨中訂單。
- packer：批次選取揀貨完成、待裝箱訂單。
- admin / superadmin：可切換兩種模式；切換即清除選取，避免混合階段。
- dispatcher、已完成清單：不提供認領入口。
- 批次功能是批次認領；認領後逐筆使用既有條碼／SN 核對，不會略過掃碼或直接完成出貨。
- 前端清單每頁最多 50 筆；更換頁面、搜尋、篩選或收到他人認領事件會清除不適用選取。
- 待審核異動、裝箱未核可例外及搶先認領仍由後端逐筆檢查；部分失敗顯示原因。網路結果不明時重新載入清單，不自動重送 POST。

## API 相容性

既有 `/api/orders/batch-claim` 保持揀貨專用及 `orders/failed` 回應；`/api/orders/batch/claim` 保持 `results.success/failed` 回應。
新增選用 `stage: pick | pack`；未提供維持舊合約。UI 指定所選階段，後端在資料列鎖定後檢查，管理員也不可在狀態變更時誤認領到其他階段。跨角色階段返回 403，無效階段返回 400。

未變更資料表、庫存邏輯、使用者角色或正式訂單資料；沿用既有鎖定、稽核與提交後 Socket 通知。

## 驗證

- backend：165 個單元測試通過。
- frontend：128 個測試通過；正式 build 通過。
- 本機獨立 PostgreSQL / HTTP / Socket / 瀏覽器：44 個測試通過，含 13 個瀏覽器流程。
- 使用真正 picker / packer 測試登入，各自於工作台批次認領兩筆獨立測試訂單，再逐筆掃碼完成揀貨與裝箱。
- 覆蓋跨角色／跨階段拒絕、重複認領、部分待審核例外、既有兩種 API、選取清除、網路失敗與離開頁面後處理。
- 500 次揀貨 + 500 次裝箱連續掃碼回歸通過；數值僅代表本機測試，不代表正式站網路效能。
- GitHub CI：35205576041 成功。
- 候選與正式 `/login`、`/health`、`/ready` 為 200；未登入 `/api/tasks` 為 401。
- 正式帳號只查閱兩階段清單；無效階段且空 ID 的拒絕檢查為 400，未認領真實訂單。
- 正式瀏覽器 superadmin 顯示兩種按鈕；已檢查裝箱勾選與模式切換，離開時恢復一般清單。一般員工完整操作是在隔離測試環境驗證，沒有冒用正式員工認領真實訂單。

## 部署

- 原始碼 commit：`4e05daf656ee774d7499e3516f75f9fa1690b132`
- Cloud Build：`e962a857-14c1-460d-896a-f42afe3a2833`
- 公司專案：`moztech-main-db`；region：`asia-east1`；service：`corely-wms`
- revision：`corely-wms-batch-stages-20260917`，發布後讀回為 100% traffic。
- 正式入口：https://wms.corely.cc/tasks
- Run URL：https://corely-wms-249593319772.asia-east1.run.app/tasks
- api：`asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-backend@sha256:afaf787353c2108b22763ddd4e73c6dbdc0b38a33f8a7de008c34ee1497ff68b`
- web：`asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-frontend@sha256:99af59f00ba2de28644e8182101b46b5ec6e840a4d619378d4155fd9cba56cf1`
- 僅更新兩個應用映像；IAM、runtime secrets、Cloud SQL、GCS、服務帳號與 scaling 保持一致。
- 未修改共用 `corely-wms-migration-validation` 的 template 與 traffic。
- Render 舊 API / DB 保持前一工作已完成的暫停狀態。

## 回復與接手

前一正式 revision `corely-wms-order-complete-20260917` 已保留。必要時以 Cloud Run traffic 切回該 revision；不回復或覆蓋正式資料庫，也不重新啟動 Render。

本機：`/Users/moztecheason/Documents/moztech-wms-batch-stages-20260917`，branch `codex/wms-batch-stages-20260917`。測試與發布紀錄：協調工作區 `artifacts/wms-batch-stages-20260917/`。GitHub main 以非強制 fast-forward 同步；接手仍應重新查詢 main 與正式 traffic。
