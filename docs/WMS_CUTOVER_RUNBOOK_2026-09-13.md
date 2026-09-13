# Corely WMS 最終切換與回復

本文件是待執行的切換程序。2026-09-13 的快照還原與私有候選驗證不代表已正式完成搬遷。

## 目前資源

| 用途 | 資源 |
|---|---|
| 來源 | Render API moztech-wms-api、PostgreSQL shipment_verification_db_0xms |
| 公司正式入口 | https://wms.corely.cc / corely-wms（asia-east1，moztech-main-db） |
| 正式 DB | Cloud SQL moztech-main-db instance 中的 corely_wms |
| 演練 | corely-wms-migration-validation / corely_wms_migration_20260913 |
| 正式附件 | moztech-main-db-corely-wms-attachments（私有） |
| 演練附件 | moztech-main-db-wms-migration-20260913（私有） |
| 目前正式回復點 | corely-wms-00010-hug；執行前重新查核，不以歷史 revision 當作目前狀態 |

完整證據在 `/Users/moztecheason/Documents/ChatGPT/AI 儲運管理系統/artifacts/wms-migration-parity-20260913`。私人備份在 `/Users/moztecheason/.codex/private/moztech-shipment-migration`，權限 0700／0600。這些路徑不是遠端可用的公開下載連結。

## 最終切換前必須達成

1. 使用者確認同仁主用的舊前端、停機窗口，以及舊系統已停止作業。另由操作者驗證伺服器寫入確實停止；只關閉員工瀏覽器不夠。
2. 核對 Render deployment/env、背景任務、DB retention、API/Socket 和其他直接 DB writer，準備可回復的停寫方式。不得動到其他售後／ERP 系統。
3. 新站也停止接受操作，備份最新 Cloud SQL。若新站已產生訂單、新帳號或新物流關聯，既有合併腳本會拒絕，必須重新設計映射，不可強制覆蓋。
4. 解決來源 lemon 與新站 Lemon 的大小寫登入衝突；保留兩個帳號並重命名，或由使用者選擇合併。不得猜測密碼與身分等價。
5. 找回兩筆來源已 404 的附件，或明確接受保留缺失 metadata 及後續補回；不生成替代檔案、不刪除紀錄。
6. 候選程式及實際部署映像通過驗收，版本、migration checksum 與來源 manifest 能對應。025 unique index 必須先在隔離合併成功，不能讓正式啟動時才碰到帳號衝突。

## 切換步驟

1. 再查 Git/worktree/遠端部署 trigger 及 Cloud Run traffic、image digest。保留現有工作與現行服務設定；不得把其他分支混入候選。
2. 最新演練通過的私有候選為 `corely-wms-migration-validation-00003-wxb`，映像與測試結果見驗收紀錄。該服務 config 僅供 staging，不可直接當正式 config。
3. 在已確認窗口凍結 Render 和新站寫入，等待交易結束，檢查無持續 writer。期間不改 DNS 作為停寫手段。
4. 對兩邊各建立最新 repeatable-read/exported snapshot、custom-format dump、逐表 count/digest、schema/FK/sequence 清單與附件 manifest。備份目錄每次唯一，不覆蓋舊備份。
5. 在獨立 DB 還原最新來源和最新目標，合併來源 20 個業務表及新站帳號／物流資料。保留原 ID 與密碼雜湊，額外帳號映射所有 FK。重新跑每個來源資料列的存在／欄位一致檢查，以及目標保留資料的映射檢查。
6. 執行 migration runner，核對每份 SQL checksum、必要欄位與序列、索引，重新跑完整流程。若出現新 schema、衝突或資料差異，保持停寫，不進行覆蓋。
7. 把驗收通過的合併 dump 原子還原至核准的正式 DB。實際備份／還原命令必須限制 exact project、instance、database，且先做 private rehearsal。不得把測試訂單／帳號一起帶入。
8. 把取得的附件以原 storage_key 上傳正式私有 GCS；核對 byte count/hash。對每筆 missing 記錄保留明確結果。
9. 使用新版本 JWT 秘密。舊新站 ID 2、3 與來源員工 ID 衝突，沿用舊 JWT 會指向錯人；必須全員重新登入。
10. 從當時正式服務設定產生候選 revision，保留核准的綠界帳號秘密與 callbacks 設定；不能直接複製不帶物流秘密的驗證服務設定。PGDATABASE 指向正式 DB、bucket 指向正式 bucket；維持 max instances=1 與連線數預算。
11. 對候選執行登入／角色／只讀資料對帳，確認 API、Socket、附件、聲音設定、工作台和掃碼入口。確認後才讓 wms.corely.cc 的正式流量使用新 revision。
12. 開放新站寫入，Render 維持停寫。做一張經授權的真實完整出貨驗收，包含掃碼槍、喇叭、附件、匯出與列印；核對其他使用者／裝箱員能接手。
13. 觀察錯誤率、p95、DB 連線等待、重複／遺漏掃碼、物流與庫存寫入邊界。Render/Vercel 的停用必須在回復窗口與驗收完成後另行執行。

## 回復

- 尚未接受任何新站寫入：保持新站停寫，核對來源備份未改；恢復核准的 Render writer、舊入口。保留候選與失敗日誌供調查。
- 已接受新站寫入：先凍結新站，備份最新 Cloud SQL 和全部新增附件。以此為唯一最新來源；隔離驗證反向資料包和原始 Render schema 的相容性。只切回舊 DNS／舊 revision 會遺失切換後資料，不可直接執行。
- 2026-09-13 的本機反向演練已證明 20 個業務表、保留新管理員及模擬新增訂單／SN／掃碼可精確回填。雲端物流表須另保存在 Cloud SQL，舊 Render 版本不具備完整物流介面。
- 實際 Render writer 開關、附件回傳及現場恢復尚未完成驗收。沒有確認這些控制前，不能宣稱正式回復方案已實測。

## 作業設定

### Render 附件復原前置

先檢查現行 `moztech-wms-api` 的 Disk mount path 與既有 Shell，不重啟或重新部署。舊程式把異常附件寫到 `backend/uploads/exception_attachments`；實際絕對路徑須配合 Render Root Directory 確認。若 Disk 存在，先唯讀核對原 storage key、檔案大小與 SHA-256，保留內容副本後再討論停寫。

Render 預設檔案系統不持久，只有 persistent disk 掛載路徑內的檔案會跨重新部署／重啟保留。磁碟快照的 restore 會覆蓋整個磁碟，不能把它當成只救兩個 PDF 的唯讀操作；未備份現況前不執行 restore，也不為了救檔先新增 disk（新增會觸發部署）。參見 [Render Persistent Disks](https://render.com/docs/disks) 與 [Restore snapshot API](https://api-docs.render.com/reference/restore-snapshot)。

目前已證實的是兩個原下載端點回覆「附件檔案不存在」，尚未證實根因為 ephemeral filesystem，也尚未確認有可用的磁碟快照。

### 工作站偏好

DB 內的角色、任務分配、已讀、置頂、討論與異常紀錄包含在合併。音量／音效、語音、桌面通知、側欄寬度等儲存在各瀏覽器的 localStorage，換網域不會自動共享；個別工作站需在新站設定核對。相機／桌面通知是瀏覽器對網站的許可，不能透過資料庫搬遷冒充已授權。

庫存維持記錄模式。倉庫「核對完成」不是物流已送達；未取件只建立待追蹤退回，不自動認定已收回、銷退、退款或恢復庫存。
