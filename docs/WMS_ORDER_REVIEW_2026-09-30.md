# 管理員分工、異動通知與 SN 異動修復

## 行為

- `users.management_scope` 保留既有五種 `role` API 契約，admin 再分 `orders`（訂單管理員）、`warehouse`（倉儲管理員）、`all`（既有管理員）。舊帳號預設 all，不會批次降權。
- 只有 superadmin 可調整管理員角色或分工。訂單管理員保有拋單、檢視、提出異動功能；不能核可／駁回／結案、掃碼、認領、作廢、SN 直接更換或管理成員。HTTP 每次查詢 DB 的有效權限，Socket 定期重新驗證；舊 JWT 不可繞過。
- 本次使用者指定 lemon 為 orders、mozwen（陳怡玟）為 warehouse。帳號分配是經核對的獨立正式資料操作，不寫死在 migration；其他人不變。
- DELETE 訂單與批次刪除端點改為建立刪除申請，必填原因，回傳 202。批次回應為 requested/failed。核准將訂單標成 voided，保留品項、SN、留言與操作紀錄；不再永久刪除。已完成／已作廢訂單不可送刪除申請。
- 數量異動包含管理員自己的拋單一律待審核，移除舊自動放行。既有已核可案件不會重新套用。
- 同一訂單只能有一筆 open 的 order_change（刪除也是此類）。申請鎖定訂單再建立提案，與掃碼使用相同鎖順序；待審時擋掃碼、認領、直接作廢及 SN 更換。駁回保留進度並恢復原作業。
- 通知以 urgent 留言及 mentions 與異動交易共同提交，再發 Socket。通知倉儲／all 管理員、superadmin、拋單者、申請者、該單揀貨員與裝箱員。申請、核准、駁回、結案、直接作廢、SN 更換均有通知。一般例外回報及提案也通知上述責任人，保留其原本只限制裝箱的規則。
- 全站 `/api/order-reviews` 提醒未決訂單異動，依責任人篩選，30 秒重新讀取及 Socket 更新；已讀留言不會清除待審案件。數量異動與刪除申請均有工作台標記及作業頁提示。

## 同條碼多列的修復

減少指定 SN 時，扣除該 SN 真正所屬品項列的數量，不再從最後一列依次扣除。減少未配 SN 的數量也逐列保護既有 SN 數量。拒絕移除已刷過的 SN 及已有數量／SN 矛盾的資料。一般條碼合併同碼列時保留各列掃碼進度總和。

歷史異動用保存的 applyResult 顯示前後數量；待審案件保存 baselineItems 並依提案順序算數量。避免將歷史 `+1` 再加到現在總數，導致減一加一顯示為三。

## 驗證與發布

- 單元測試：backend `npm run test:unit`、frontend `npm test`、frontend `npm run build`。
- 固定 loopback PostgreSQL 的 `WMS_PARITY_PG_TEST=1 npm run test:workflow` 包含所有既有 HTTP 業務路徑、新審核及分工限制、通知失敗 rollback、併發送審、SN 同碼多列減一加一、500 pick + 500 pack。
- 設定 `WMS_PARITY_BROWSER=1`、`WMS_PLAYWRIGHT_MODULE`、`WMS_CHROME_EXECUTABLE`、`WMS_PARITY_BROWSER_OUTPUT` 可跑 15 個瀏覽器流程，其中包含訂單管理員送刪除申請、已開作業頁的揀貨員即時停工、倉儲主管收到待審提醒及核准。
- `node --test backend/src/__tests__/taskPagination.pg.test.cjs` 檢查大量任務的分頁與權限範圍。
- `028_admin_management_scope.sql` 僅加欄位與限制；由明確 migration runner 執行，不由伺服器啟動自動更動 DB。
- 先保留原 Cloud Run 流量，部署 0% candidate，確認 schema、登入、readiness、真實唯讀 API 與未變動的 IAM／資料庫／附件設定，再發布。

## 正式資料與回復界線

`2026/09/30 -25`（5111）的既有兩列 35437／35438 數量為 2／0，但各有一筆已揀 SN。已核可提案 341 的實際異動總數為 2→1→2。資料修復工具只在訂單、品項、SN、提案均吻合稽核快照且沒有待審異動時，調整這兩列為 1／1，總數不變，所有原 SN 與掃碼紀錄不變。只有重新計算全部已揀完成才推進到 picked，並留存操作日誌與通知。條件變更時中止，不能強制覆蓋。

新角色分工生效後，不能直接切回忽略 management_scope／刪除審核的舊映像，否則會恢復舊權限與硬刪除行為。優先向前修復，或使用同樣維持審核與 scope 檢查的回復映像。schema 欄位、已核准紀錄與真實後續作業資料保留，不能整庫回復覆蓋新作業。

發布證據及受控資料操作結果存於協作工作區 `artifacts/wms-order-review-20260930`；不把正式資料、帳密或 token 放進 Git。

## 已完成發布（2026-09-30 17:28 台灣時間）

- 程式提交 `366ce36d116d0913f50853c9ae85bbcada0919af`；GitHub CI run `36695921270` 成功。Cloud Build `129005f3-6006-4436-966e-2d51dfe62a85` 成功。
- 正式 `corely-wms-order-review-20260930` 接收 100% 流量；`wms.corely.cc` 與新 run.app 入口健康、readiness、未登入拒絕及已登入唯讀 API 均通過。IAM、Cloud SQL 連線、附件及共享驗收服務保持不變。
- 映像 digest：backend `sha256:e4dfcb2ff2ea2c4a54d36689d0da0470a911cc42080441c4ca2780d6d24f8b87`；frontend `sha256:092c1b498e7dfc1108876370c6b24ba899b0e6a252964bceb6e1c17bdccd606d`。
- 新增 migration 028 成功，其他 migration checksum 一致。獨立設定 lemon / id 5 為 orders、mozwen / id 19 為 warehouse；其他帳號不變。正式 API 確認前者不可審核或讀成員管理，後者可以。角色異動日誌 254142、254143。
- 訂單 5111 條件式修復成功：35437／35438 為 1／1，總數 2，SN 不變；全部揀貨完成，status=picked（待裝箱），留存日誌 254144。活動訂單的 SN 超過所屬列數量唯讀盤點只發現此一筆。
- 9 個舊候選 tag 已移除且逐一確認 HTTP 404，避免舊入口繞過新的分工及審核規則；舊 revision 保留歷史證據，不可直接恢復流量。
- 驗證結果：185 backend 單元、138 frontend 測試、53 PostgreSQL/HTTP/Socket/瀏覽器流程測試（含 15 瀏覽器情境）、分頁整合測試及前端 build 全通過。正式資料只執行上述角色分配與已授權的訂單修復，沒有在正式庫建立測試訂單。現場人員實際作業驗收仍應使用新版本確認。
- 受影響帳號請重新登入；其餘操作站重新整理，以載入新按鈕與提示。
