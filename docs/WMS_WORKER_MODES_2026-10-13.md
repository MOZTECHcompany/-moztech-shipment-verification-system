# 同帳號揀貨／裝箱與責任追溯（2026-10-13）

## 現場操作

同一帳號可選揀貨或裝箱；現有帳號、密碼、users.role、管理員分工及歷史資料沒有合併、改名或停用。使用者會另行通知人員未來統一用揀貨帳號；本次不自動合併兩個user ID的歷史責任。

- 工作台首次顯示「今天做什麼？」；選擇揀貨或裝箱後，認領、批次及掃碼使用該工序。
- 倉儲／系統管理員可在「設定 → 成員管理」安排「今日預設」。這是新登入的推薦工序；本人可另選，不會默默改掉已開工的訂單或其他分頁。
- 每個分頁獨立記住本帳號、台灣工作日的選擇。訂單網址以 `?stage=pick/pack` 固定工序，刷新後仍是同工序。
- 作業中按「切換作業」，自己認領的任務先「暫停並切換」；數量、SN、狀態及認領人保留。回到原任務按「繼續作業」。管理員協助別人的單時，切換自己的工作不會自動暫停對方。
- 換人按「交接任務」，選接手人及可選備註。保留進度，記真實舊負責人、接手人、執行交接者、台灣時間及交接時已揀／已裝數量，並通知交接雙方。
- 完成揀貨維持原本自動回工作台；裝箱需明確「開始裝箱」認領，下一槍不會自動被算成裝箱。
- 送出中／未知結果尚未確認時不允許切換工序；不自動重試掃碼、交接或批次變更。

## 權限與紀錄

`users.can_pick/can_pack` 是 nullable override，未設定時 picker／packer／admin／superadmin 可執行兩工序，dispatcher 預設無作業權限；不改原role／密碼資料。管理員既有審核、成員管理、通知分工仍由 `role/management_scope` 決定，工作模式本身不授權。

認領、掃碼、批次、暫停／繼續、交接皆驗證真實帳號能力、訂單工序與責任人。管理員可協助同工序，掃碼事件記實際操作者與 `assistance`，不把其操作歸到原owner；接手須明確交接。

新增migration `031_worker_modes.sql`：

- users作業能力兩欄；orders兩工序暫停時間。
- operation_logs的 `actor_snapshot/work_type`；新紀錄保留當時人員／角色／管理分工、品項／SN、前後數量／狀態及command ID。
- task_assignments的 `performed_by`、三方snapshot及進度snapshot。既有from/to紀錄不回填或改寫。
- warehouse_daily_modes保存本人當日選擇與主管預設，各自分開；索引支援訂單工序紀錄查詢。

舊事件沒有當時身分快照的，不推測或回填歷史角色。姓名、角色修改後不影響新事件快照；有作業／交接／掃碼憑證／新品不良歷史的帳號不得硬刪，以保留追溯；未使用帳號仍可刪除。此次未停用任何帳號。

主要API：GET/PUT `/api/warehouse/work-mode`；GET `/api/warehouse/operators`；PUT `/api/warehouse/operators/:id/today`；POST `/api/orders/:id/work-pause`／`work-resume`；GET `/api/orders/:id/handoffs`；原claim／batch／scan／`tasks/:id/transfer`保留，工序參數明確驗證。

## 驗證與回復界線

- 後端unit 224／224（25 suites）；前端169／169及Vite build通過。
- 完整真HTTP／PostgreSQL＋Chrome85／85，含原有及新增24項瀏覽器流程；後續純後端刪除保護及交接audit failure追加驗證後HTTP62／62、migration2／2。
- 原留言／釘選、異常審核、刪除送審、新品不良與SN更換、批次、聲音、列印、報表與正負理貨單驗證保留。覆蓋同帳號兩工序、分頁不串工序、暫停續作、真實主管協助、交接回滾、歷史身分快照及掃碼重播／撤回。
- 本機使用獨立PostgreSQL18.5，正式為17；正式schema／readonly與ready另行查核。不使用正式秘密或真實訂單測試流程。
- 手機390px定點真PG＋Chrome驗證：快捷列文字佔可用寬度90.5%，沒有橫向溢出。

保留原revision及新增schema。新同帳號已執行裝箱、暫停或交接後，不可直接退回忽略雙工序／暫停狀態的舊程式繼續作業，須使用支援031的修正映像；不得還原舊dump、刪欄位或改寫人員／進度。遷移不在app啟動執行，僅用明確指向 `corely_wms` 的release程序。

目前程式與本機驗證完成；候選／正式revision、image digest及GitHub同步證據於實際發布後補記。正式現場原始ERP檔、實體條碼槍與耳機聽感仍須使用者於日常作業確認，不把合成fixture宣稱為實物驗收。
