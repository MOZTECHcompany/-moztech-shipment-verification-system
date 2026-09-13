# WMS 搬遷與功能驗收紀錄 — 2026-09-13

本輪仍在執行。已完成一致快照、隔離合併及公司 Cloud SQL 還原演練；正式切換尚未執行。不能把此文件當成正式驗收完成。

## 工作邊界

- 隔離 checkout：`/Users/moztecheason/Documents/moztech-wms-migration-20260913`，分支 `codex/wms-migration-parity-20260913`，基準 `9b37652`。
- 舊 GitHub main：`d4e2bff12545d9243787d52850c16f36e1db4eed`。原 cloud-run checkout 的未提交工作、另一個 ERP worktree 均未修改。
- 正式 WMS 流量實查仍 100% `corely-wms-00010-hug`；正式 `corely_wms`、Render DB 未寫入或停用。
- 私有驗證服務：`corely-wms-migration-validation`，公司 `moztech-main-db`／`asia-east1`。
- 私有驗證 DB：同一 Cloud SQL instance 中的 `corely_wms_migration_20260913`；附件使用獨立私有 bucket，JWT 亦獨立。服務沒有公開 invoker。
- 驗證服務未掛載正式綠界帳號秘密，未呼叫物流建單、退款、發票或庫存扣減。

## 資料對帳

來源快照：2026-09-13 02:52:12（台灣）。20 個原業務資料表逐表一致還原。

| 資料 | 來源筆數 |
|---|---:|
| 訂單 | 4,571 |
| 品項 | 30,607 |
| 商品 SN 實例 | 46,970 |
| 操作日誌 | 191,263 |
| 員工帳號 | 24 |
| 異常 | 273 |
| 新品不良 | 71 |
| 任務討論 | 1,125 |
| 提及 | 1,072 |
| 已讀 | 853 |
| 來源附件紀錄 | 2 |

- 來源比 09/10 舊演練多 45 筆訂單，已納入本次快照；目前沒有宣稱這就是最終停寫快照。
- 新站既有 25 個表（先前文字曾誤記 26 表，以 JSON 實查為準），訂單 0、帳號 2、物流 5 筆、物流事件 7 筆、待退回 3 筆，已另外完整備份。
- 合併保留每個來源資料列、ID、密碼雜湊、角色和外鍵。新站兩個帳號重新映射至 ID 30、31，相關日誌、bootstrap、物流 created_by 一起映射。
- 新站 `Lemon` 與來源 `lemon` 存在大小寫不分的登入衝突。演練先把新站帳號改為 `Lemon-cloud`，密碼與角色保留；這只是待確認方案，未更動正式帳號。
- 合併後公司驗證 DB 的 25 表數量／內容摘要與本機合併逐表一致。雲端合成資料測試清理後，再次對全部 25 表確認一致，之後才套用 025 登入唯一索引。
- 原附件 ID 3、4（各 47,300 bytes）再次授權下載仍 404，已查的原 checkout 也沒有副本。再以原檔名／storage key 查 Downloads、Documents，並核對其中 165 個 PDF 的檔案大小，沒有找到候選副本（attachment-local-recovery.json）。保留完整 metadata，尚未取得內容，不算遷移完成。

備份、原始資料列和密碼雜湊都在 repo 外的私人目錄，未提交 Git 或放入一般公開 artifact。

## 程式修正與證據

| 功能／問題 | 實作與驗證 |
|---|---|
| 舊功能入口 | 69 個原 router 路徑均有對應，見 route-inventory.json；路徑盤點不等同所有情境驗收。正式環境的舊 debug/線上 migration 入口刻意受限，由離線 migration runner 取代。 |
| 五角色與登入 | 真實 PostgreSQL＋HTTP 測試五角色登入、管理權限、舊 token 降權／刪除、refresh、管理員保護。HTTP 使用目前 DB 身分與角色。 |
| 帳號大小寫 | 登入與建立帳號都使用 LOWER(username)，025 unique index 防止並發建立重複身分。既有衝突必須先處理，不會自動覆蓋密碼。 |
| 單筆／批次認領 | 共用同一個交易與狀態檢查；鎖定訂單、禁止未核可異動、禁止未完成揀貨就批次裝箱。兩個舊 batch API 保留回應格式與逐筆結果。 |
| 揀貨／裝箱 | 單一連線池連線完成 500 pick＋500 pack，逐次檢查數量及最後狀態。非法類型、分數數量、重複 SN、錯單、裝箱早於揀貨均拒絕。 |
| 卡頓 | 掃碼、異常回報、SN 更換、轉交避免持有連線再等待第二條連線；派單員歷史查詢補最新匯入／留言索引。 |
| 錯掃紀錄 | 錯誤掃碼先回滾商品數量，再單獨保存 scan_error；不可發送成功事件。分析 API 實測可查到。 |
| 異常與異動 | open 阻擋裝箱、admin ack/resolve/reject、數量異動僅核可一次。原始紀錄完整保留。 |
| SN 更換 | 訂單鎖與檢查重複 SN；SN、不良紀錄、異常和日誌一起提交。模擬異常資料表／日誌失敗，驗證回滾。 |
| 作廢／轉交 | 作廢保存 void_reason 並與日誌一起提交；禁止作廢後掃碼。轉交確認操作者、階段及目標角色。 |
| 團隊協作 | 真實 Socket 授權／匿名拒絕，討論、提及、已讀、置頂、公告及留言 API；前端另測分頁、已讀可視範圍、斷線後更新與清理事件。 |
| 匯入／匯出 | XLSX 匯入、重複匯入、大小／SN 限制、權限；公司 Cloud Run CSV 報表、分析、日誌端點實測。 |
| 附件 | 本機安全路徑／回滾／GCS adapter 測試；公司 Cloud Run 實際 GCS 上傳、授權下載位元組一致、匿名入口拒絕，合成檔案已清理。 |
| 工作區 UI | 本機瀏覽器走通：picker 登入 → 開始揀貨 → 3 次掃碼 → packer 接手 → 3 次掃碼 → 完成列表。追加 Chrome v3 管理員：兩單批次認領、錯掃不增量、揀貨、裝箱卡片篩選、裝箱與完成列表。設定含物流／成員／日誌，側欄鍵盤與滑鼠拖曳、重載保留、還原及收合均通過。倉儲員看不到成員管理。 |
| 提示與列印 | 不同 pick/pack 音型、失敗不播成功、相機回呼、條碼可解碼等前端測試通過。實體掃碼槍、喇叭、印表機尚待現場確認。 |

測試紀錄：`backend-tests-final3.log`（147）、`frontend-tests-expanded.log`（91）、`pg-tests-final3.log`（70）、`warehouse-audit-integrity.log`、`frontend-build-final2.log`。之後如有改版，以最新驗證映像與對應報告為準。

## 雲端與效能驗收

- 最終私有候選 `corely-wms-migration-validation-00003-wxb` 的真實 API：一般單 100 pick＋100 pack，p95 為 128/166 ms，第 50 次之後 p95 為 135/148 ms，未重現 50 次卡住。這是合成單及當時網路的結果，不是所有尖峰時段的保證。
- 大單 78 品項／2,269 SN：100 pick＋100 pack，p95 為 630/520 ms，第 50 次之後 p95 為 553/503 ms；單次最慢 1.25 秒。回應最大約 384 KB，仍回傳完整訂單；若未來再擴大，應以版本化增量回應降低網路負載，並另做前端效能驗收。裝箱負載的剩餘揀貨狀態由 fixture 預置，不能宣稱整張 2,269 件都經人工掃過。
- 最新來源資料本機歷史查詢，dispatcher 由約 337–386 ms 降至 11–14 ms；這是本機 PostgreSQL 回放，不是雲端網路時間。
- 保持 Cloud Run max instances=1；多實例前必須完成共用 Socket adapter／跨實例事件與連線池預算驗收。
- `cloud-acceptance.json`／`cloud-acceptance-v3.log` 的 8 組雲端檢查全部通過，合成資料與 GCS 測試附件已清理；`final-staging-verification.json` 再確認 25 表與本機合併一致，migration ledger 僅排除分開執行的 applied_at，其名稱與 checksum 相同。
- v3 Cloud Build `140b1a76-5100-464d-8ad4-6f66d4989d26` 成功；來源 manifest SHA-256 `50137a6f6ec8ea5573eacd5fc23af39a1ec050393974665cf5c927bfada0d058`。backend digest `04f408eca4bf792344bdfb9ee1be2f5d83b4c63e2e9fdf46c4db8b6e59a9b763`、frontend digest `c2d40d2e2469de2e69b1d0dd5cb67a608babc0486ffb9df03761501f35c63b31`。
- 含 025 的新合併備份為 `merged-through-025-20260913.dump`（私人目錄，4,879,768 bytes，SHA-256 `1220f3df10034763182637beea37eb85913daa915e8a853746df412ab68616f7`），不是最終停寫快照。舊 merged-candidate.dump 僅到 024，勿當最新版。
- 映像、來源 manifest、部署 config 和各次結果皆獨立保存；無候選驗證結果冒充正式搬遷完成。

## 尚待條件

1. 確認舊系統實際主用網址及已停止作業的時段，並驗證 Render API/Socket、背景任務與新站均真正停止寫入。
2. 使用者已完成 Render 登入；Chrome 原生介面確認 `moztech-wms-api` 控制台可見，Live commit 為 `d4e2bff`。後續瀏覽器控制連線失敗（native pipe startup failed；重設後 CUA_REPL_ENABLED_SURFACES is required），尚無法核對 live env、Disk／Shell 與停寫控制。此處是工具連線障礙，不應再次要求使用者重新登入。
3. 確认 `lemon`／`Lemon` 帳號衝突處理。
4. 找回兩筆舊附件，或取得使用者對保留缺失紀錄、之後補回的明確決定。
5. 最終同步必須重新備份來源／目標、比對差異。新舊 source ID 衝突代表切換時必須換 JWT 並全員重登，不能沿用新站舊 token。
6. v3 管理員瀏覽器驗收已改用 Chrome 完成，見 `chrome-ui-acceptance.json`。Mac／in-app 操作阻礙未當作系統通過證據；實體掃碼槍、喇叭、印表機仍需現場驗收。
7. 瀏覽器本機音效／音量／語音／通知及側欄偏好不在 Render DB，換網域不會自動轉移。作業站需對照設定；通知／相機等瀏覽器權限須在新網域重新授予。

## 回復演練

`rollback-rehearsal.json`：本機兩個獨立副本，以最新來源 20 表結構測試反向回填，包含模擬切換後新增訂單、品項、SN、掃碼和新增管理員；逐表摘要一致。新站物流 5/7/3 筆保留在 Cloud SQL 副本。尚未演練 Render 實際停寫／恢復或附件實體回傳，不能直接把 DNS 指回舊快照。

## 登入後重新盤點 — 2026-09-13 08:21（台灣）

- `source-resume-audit-2026-09-13T00-21-47.309Z.json`：使用獨立唯讀交易查核來源 20 表，筆數及完整資料列摘要均與 02:52 備份相同。訂單 4,571、員工 24，五種角色皆保留。
- 此次連線的 read-only 設定由盤點腳本自行指定，只代表本次查詢唯讀，不代表 Render 服務已停寫。當下沒有其他資料庫連線，也不能推論之後不會有新作業。
- 附件 ID 3、4 的既有授權下載端點均為 HTTP 404，內容明確為「附件檔案不存在」。不是登入拒絕或找不到附件 metadata；仍須查服務磁碟／備份。
- GitHub `DB Retention Nightly` 實查為 `disabled_inactivity`；Render dashboard 內其他排程或外部 writer 尚未核對，不把單一 workflow 停用當成全面停寫。
- 公司 `corely-wms` 實查仍 100% `corely-wms-00010-hug`。正式 DB、Render DB、DNS、服務流量均未變更。
- 再次請使用者提供實際舊站網址、舊／新站一起暫停操作的起訖時間，以及新站 `Lemon` 是否保留並改名為 `Lemon-cloud`。尚未取得答覆。
