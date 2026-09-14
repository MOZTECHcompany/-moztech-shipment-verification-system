# 作業畫面與維護流程調整（2026-09-14）

本次範圍：以已部署的 70bb869 程式與 002401f 文件為基準，保留所有舊 WMS 功能，新增作業快捷列，修正個人釘選快取，整理維護及驗證入口。

- 作業首屏顯示訂單、剩餘件數、個人釘選摘要；可快速返回掃碼或前往完整討論。原留言操作、SN、例外、新品不良、匯出及列印保持原流程。
- 個人釘選以登入者、角色和訂單區分 React Query 快取，移除讀取舊 order-only localStorage 的行為，並共用伺服器結果。連線恢復、留言刪除／撤回及定時重新確認會刷新。
- 私有驗收抓到訂單明細載入前可開啟空白異動表單的時序問題，新增資料就緒檢查與慢速載入回歸案例。
- 清理指令改為預設唯讀預覽、明確 database 比對、參數驗證、交易與 timeout；未在正式資料執行刪除或啟用排程。
- 移除指向不存在檔案的 legacy／單檔 migration／修復命令，補齊測試命令、只驗證的 GitHub workflow、從已提交檔案生成建置包的工具，更新接手入口。

## 發布結果

- 正式入口：https://wms.corely.cc （原 run.app 網址亦通過驗證）。
- 正式 revision：`corely-wms-workstation-20260914`，100% 流量。
- 程式提交：`d10207ba04ac6ac2e5996514f3053345e3c99e98`；分支 `codex/wms-workstation-maintenance-20260914`。
- Cloud Build：`cdc5ad3c-c8e0-4384-ad6e-5dbc1026b9b4`。
- 私有驗收 revision：`corely-wms-migration-validation-workstation-0914b`；未開放匿名存取；合成資料、測試附件已清除。
- 正式 runtime、資料庫、Secret Manager、附件 bucket、IAM 與前次發布一致；本次不執行 schema migration、資料清理或庫存扣帳。
- 原 GitHub main 尚停留 d4e2bff，現用 gh 帳號只有讀取權；本次程式與 CI 尚未推送 GitHub。另提供 Git bundle 保留可接續的提交歷史。

## 驗證

| 範圍 | 結果 |
|---|---|
| 後端單元測試 | 155 / 155 通過 |
| 前端單元測試 | 98 / 98 通過 |
| 本機 PostgreSQL 與瀏覽器流程 | 最終 33 / 33 通過；含維護預覽真實 SQL、五角色、舊業務 API 與 11 個瀏覽器情境 |
| 前端編譯 | 通過；仍有部分大資源包提示，保留後续模組拆分事項 |
| 雲端驗收 | 22 / 22 檢查通過；400 次 API 掃碼、4 次命令重送無重複扣量、120 次瀏覽器掃碼、附件 round-trip、留言、異動、例外、新品不良、匯出與列印 |
| 大單驗收 | 78 品項／2,269 個 SN，揀貨與裝箱各 100 次；p95 約 114 / 109 ms；超過第 50 次後未出現累積等待 |
| 正式候選與正式入口 | 登入殼、健康／就緒、未登入拒絕、資料查詢、71 筆新品不良、訂單快照、備註／快捷列新版資源皆通過 |
| 現場掃碼觀察 | 發布後抽樣 70 個新 revision 的真實掃碼請求，0 個 HTTP 錯誤，p95 約 50 ms；此為抽樣窗口，非所有網路／設備條件的保證 |

私有雲第一次驗收發現明細尚未回來即可開空白異動表單；已修正資料就緒檢查，用延遲 snapshot 的瀏覽器案例驗證，並重新建置、驗收後才切正式流量。沒有把測試失敗的版本切到正式流量。

## Google Cloud 資料比對

將封鎖寫入時的 Render 原始 dump 還原至本機隔離 PostgreSQL，再用唯讀 transaction 比對公司 `moztech-main-db / corely_wms` 的原欄位、主鍵與逐筆內容。不是只比筆數或看空白看板。

| 舊資料 | 舊站筆數 | 本次核對 |
|---|---:|---|
| 訂單 | 4,571 | 原始記錄全數相符 |
| 商品明細 | 30,607 | 原始記錄全數相符 |
| SN／商品實例 | 46,970 | 原始記錄全數相符 |
| 操作日誌 | 191,263 | 原始記錄全數相符，包含 details 與時間 |
| 例外 | 273 | 原始記錄全數相符 |
| 新品不良 | 71 | 原始記錄全數相符 |
| 留言／提及／已讀 | 1,125 / 1,072 / 853 | 原始記錄全數相符 |
| 任務釘選 | 4 | 原始記錄全數相符 |
| 附件 metadata | 2 | 資料列相符；原檔缺失，見下節 |
| 來源使用者 | 24 | 23 個帳號原始欄位（含角色及密碼雜湊）相符；ID 25 `lemontst` 已不在現況；另外保留新站 superadmin，現況總數 24 |

其餘來源公告、協作及空資料表也納入原 20 表逐筆比對。`lemontst` 在 9/13 切換後驗證曾存在，9/14 前次發布前已不在名單中；現行日誌沒有可直接確認刪除者的紀錄。已詢問使用者確認，不為對齐歷史人數擅自恢復已可能撤銷的登入權限。

新站已在使用，查核時訂單已增至 4,605 筆、日誌持續增加。發布前後全表 hash 不完全相同，原因是現場持續領單及揀貨；進一步從本次發布前的一致快照逐筆比較，沒有任何資料列遺失，品項數量差額與同一快照內的正式掃碼日誌 amount 完全對得上，沒有合成驗收訂單寫入正式資料庫。

## 備份與回復

- 新站最新一致快照已匯出，並實際還原到隔離 PostgreSQL 成功。備份放在私有目錄，不進 Git。
- Cloud SQL 每日備份及 PITR 已啟用，保留 15 份備份、7 天交易日誌、刪除保護已開啟，近期自動備份成功。
- GCS bucket 位於台灣，使用統一存取控制、禁止公開存取與 7 天軟刪除保護。
- 程式回退 revision：`corely-wms-parity-20260914`；若有新問題，先回退程式流量並保留目前 DB，不重灌 Render dump。不可恢復整個共用 Cloud SQL instance 以免影響其他系統。
- 舊站 DB 仍拒絕新連線（PostgreSQL 55000）；本次沒有解除封鎖。

## Render 可否停用

目前不建議把 Render 的前端、API、資料庫全部刪除或一併停用。

1. 新 WMS 已指向公司 Cloud SQL 和私有 GCS，部署設定、前端編譯資源沒有舊 Render endpoint；公司 34 個 Cloud Run 服務的可見設定未找到舊 WMS Render 連線字串。此檢查不涵蓋外部系統資料庫內的設定或使用者舊書籤。
2. 兩筆舊附件（ID 3、4，各 47,300 bytes）只有 metadata。新站下載仍為 404，正式附件 bucket 目前沒有原檔。搬遷前舊站就回報檔案不存在；不能將這部分寫成附件全數搬遷完成。
3. 9/14 Render 後台確認舊 API 仍 Live、部署 d4e2bff，且沒有掛持久磁碟。Shell 檔案搜尋未取得完成結果（Chrome 同時被切換，工具中斷）；沒有執行停止、重啟、清理、變更帳密或重新部署舊服務。
4. 先找回上述兩檔並驗證下載，或由負責人確認保留缺失紀錄；確認測試帳號狀態、舊網址使用者／外部依賴後，再安排舊前端轉址或公告、停止 API，最後才處理 Render DB 與備份保留。

Render 預設檔案系統不保證跨重新部署／重啟保存，因此在附件核對完成前，不將停止／重啟當成無風險的清理操作。官方說明：https://render.com/docs/disks

本次完成程式修正、測試、私有候選、正式發布、資料逐筆核對與新站備份还原驗證；Render 停用未執行，附件缺檔與測試帳號確認仍是待辦。


## 建置映像與證據

- `asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-backend@sha256:d1660dca18c5e4d2c6d26e66364ca34f8265083fa8da0415360585c2a96b322b`
- `asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-frontend@sha256:447f747653f93122f11628db845d3221d2a4eac14044f6ca5ff942f4dcbc25f6`

- 最新備份 SHA256：`caa473e30b9153a503747bec8cf530fda95512f30fc5080f1281bcd0934c466c`；5,020,983 bytes；本機還原成功。
- 本次證據資料夾：`/Users/moztecheason/Documents/ChatGPT/AI 儲運管理系統/artifacts/wms-workstation-20260914`，包含 source manifest、build/revision 回讀、local/cloud/browser 測試、migration-audit、production-backup、live-activity-reconciliation、live-scan-observation。
