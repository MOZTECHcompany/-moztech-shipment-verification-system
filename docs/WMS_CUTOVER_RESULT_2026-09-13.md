# Corely WMS 正式資料庫搬遷結果 — 2026-09-13

## 目前狀態

資料庫搬遷與正式流量切換已完成。使用者本輪授權立即開始遷移，並指示以舊站 `lemon` 覆蓋新站 `Lemon`。兩份歷史附件仍缺少檔案內容，實體工作站驗收尚待完成；不能把這些項目列為已完成。

| 項目 | 已驗證結果 |
|---|---|
| 正式入口 | https://wms.corely.cc |
| Cloud Run 入口 | https://corely-wms-249593319772.asia-east1.run.app |
| 公司專案／地區 | moztech-main-db / asia-east1 |
| 正式服務／流量 | corely-wms / 100% corely-wms-cutover-20260913；舊預覽標籤已移除 |
| Cloud SQL instance / DB | moztech-main-db / corely_wms |
| 正式 DB 帳號 | corely_wms_prod_20260913；connection limit 6，API pool 3，無 superuser / createdb / createrole / replication |
| 前後端映像 | 使用已驗證的 v3 映像；runtime source commit 88b09ae5119102f6b6c49275597882ca8e4d5579 |
| 密碼與登入秘密 | 新 DB 密碼使用 Secret Manager corely-wms-db-password-20260913 v1；JWT 使用 corely-wms-jwt-secret v2 |
| 附件 | moztech-main-db-corely-wms-attachments，保持私有 |
| 綠界 | 保留已核准的 corely-wms-ecpay-accounts v2，兩個帳號設定可讀，callbacks 維持 false |

程式位於 `codex/wms-migration-parity-20260913` 隔離分支，尚未推送 GitHub。原 GitHub main 與其他 ERP worktree 未修改；Render/Vercel 服務未刪除。

## 資料與帳號

- Render 20 個業務資料表全部保留，合併後正式 25 個資料表的筆數及完整資料列摘要與驗證版本一致。
- 訂單 4,571：4,541 已完成、30 作廢；品項 30,607；SN 46,970；異常 273；新品不良 71。
- 原操作日誌 191,263，加上新站保留的 1 筆，共 191,264。討論、提及、已讀、置頂、公告與附件 metadata 保留。
- 原 24 個使用者的 ID、密碼雜湊、姓名及角色未變。新站 superadmin id 2 映射為 id 30，保留其密碼與角色。
- 新站 `Lemon` id 3 的關聯資料映射至來源 `lemon` id 5，使用來源帳號、密碼及 admin 權限。正式共 25 個帳號，只有一個 lemon，沒有 Lemon-cloud。
- 新站既有物流單 5 筆、物流事件 7 筆、待退回 3 筆保留，created_by 等關聯已重新映射。
- 025 大小寫登入唯一索引已套用。來源與新站的舊 JWT 簽章均已驗證遭拒，所有使用者須重新登入。

來源原本沒有進行中的訂單，因此工作台待處理數為 0 是正確結果。歷史清單 `/api/tasks/completed?pagination=cursor` 已逐頁對帳完整 4,541 筆；作廢單仍存在資料庫。

## 停寫、備份與切換

1. 08:38（台灣）重新對兩邊建立一致快照，隔離還原、依核准政策合併及套用 migration。私有候選先通過驗證。
2. 08:47:49 來源停寫、08:48:56 原新站停寫。對所有業務表持有 SHARE lock 期間比對快照、建立 dump，再持久設定 DB `ALLOW_CONNECTIONS false` 並結束其他 client，確認新連線遭拒後才釋放鎖。此控制已在非 superuser、資料庫 owner 的本機 PostgreSQL 完成停寫／拒絕新連線／恢復寫入演練。
3. 公司先將合併資料還原至獨立 DB，再以 PostgreSQL transaction 交換名稱：原新站保留為 `corely_wms_pre_20260913`，合併資料成為正式 `corely_wms`。原新站副本保持 `ALLOW_CONNECTIONS false`。
4. 新 DB 僅授予新的 WMS runtime role 連線權限。舊 role `corely_wms_app` 已實測無法連入遷移後正式 DB，因此舊 revision／既有 Socket 不能用舊連線身分繼續寫入。
5. 08:50:21 正式 DB 25 表對帳一致；候選標籤驗證通過後切 100% 流量。08:52 起正式網域重新驗證通過。

Render DB `shipment_verification_db_0xms` 目前保持停寫，資料仍存在。瀏覽器控制工具故障沒有被用來跳過停寫；本次改用已驗證的 DB 控制與公司 gcloud 操作。不可自行開啟舊 DB 寫入，造成兩邊分歧。

私人備份根目錄：`/Users/moztecheason/.codex/private/moztech-shipment-migration`，目錄 0700／檔案 0600，不放進 Git 或公開 artifact。

| 備份 | 位元組 | SHA-256 |
|---|---:|---|
| frozen-source-20260913/frozen.dump | 4,865,368 | f72e6effd534b5572bf27f23ad4c517b8e1037ed30b28ce599a7cb7a1d4c5d87 |
| frozen-target-20260913/frozen.dump | 117,671 | 4b1a337bf764927ad98df710601a20de0da72322cd3bafd6c1b00559f50ccb12 |

公司 instance 既有自動備份與 PITR 已確認啟用，保留 15 份備份、7 日 transaction log；未更動其他系統的備份設定。

## 驗證與限制

- 此次候選 7 組驗證通過：私有入口與登入、五角色、Socket、XLSX 匯入／防重複、60 pick＋60 pack、私有 GCS 附件、報表／查詢。
- 掃碼 p95：pick 158 ms、pack 155 ms；第 50 次後未卡住。這是本次合成單測試結果，不代表所有尖峰時段的保證。
- 測試帳號、訂單、日誌、附件已移除，再對全部 25 表確認一致、重設 20 個序列，才進入正式切換。
- 新版正式網域驗證：登入頁、匿名拒絕、25 使用者、完整歷史訂單分頁、兩個綠界設定、舊 JWT 拒絕及 lemon 權限。沒有呼叫物流建單／退款／發票／扣庫存。
- 剛切換後查詢新 revision 最近 15 分鐘的 ERROR 日誌為空；這是當時查詢結果，不是持續監控或未來無錯誤的保證。
- 私有臨時 `corely-wms-cutover-validation` 服務已移除；操作 SQL 暫存物件及 Cloud SQL service agent 的限定前綴讀取權已清除。原有 migration-validation 服務是較早演練，不代表目前正式資料。
- 瀏覽器驗收工具當時仍無法使用；實體掃碼槍、喇叭、相機／通知設定與印表機需在工作站確認。現在登入中的頁面需重新登入，必要時先登出再重新整理。

兩份原附件 ID 3、4，各 47,300 bytes，Render 原授權下載已明確回覆「附件檔案不存在」。本次保留 metadata，沒有捏造替代檔、刪除紀錄或宣稱檔案已搬完。仍需從 Render 磁碟／其他原始備份補回；未刪除舊服務。

## 回復規則

- 所有新操作以現在的 `corely_wms` 為唯一權威資料。切換後不能直接把舊 Render 寫入打開，或只把 Cloud Run 流量退回 00010-hug。
- 新 role／DB 權限是刻意隔離的；舊 revision 不能連新 DB。需要回復時先停止新寫入並備份最新資料，確認有無切換後新增變動。
- 若還沒有任何新寫入，且與切換 manifest 完全相同，可依已保存 SQL 將兩個公司 DB 名稱換回、還原服務設定，再恢復 Render；SQL 執行前須恢復限定物件前綴的 import 讀取權，完成後移除。
- 若已有新寫入，先從最新 Cloud SQL 產生反向包，在隔離 DB 對原 Render 20 表相容性及所有資料／附件做對帳，再恢復舊站。較早反向演練已通過，但此次切換後的真實新增資料仍須重新演練，不能省略。
- 不可還原整個共用 Cloud SQL instance，覆蓋其他 ERP／售後資料庫。只操作本 WMS 的明確 DB 名稱。

完整證據：`/Users/moztecheason/Documents/ChatGPT/AI 儲運管理系統/artifacts/wms-migration-parity-20260913/cutover`，包含 frozen-source/target、merge-rehearsal、shadow-restore、freeze-rehearsal、production-data-reconciliation、smoke-wms.corely.cc、live-production、live-errors 及各 Cloud SQL operation 記錄。操作腳本是本次的一次性工具，不可直接重新執行。
