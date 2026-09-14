# ERP 匯入批次、商城工作單與掃碼認領（2026-09-14）

ECOUNT 一筆整批銷貨／理貨匯出在 WMS 保留一個匯入批次，再依「平台＋店鋪＋商城訂單編號」拆成獨立工作單。每張工作單使用既有 `orders`、商品明細、揀貨／裝箱責任人、例外、掃碼收據及作業日誌。完成一張商城工作單，只完成該張工作單；同批其他工作單仍可由其他人獨立認領。

本文件描述 `codex/ecount-work-order-claims-20260914` 的最新設計與本機驗證。先前「一個 orders 主單下放多個商城來源、只用來源條碼篩選」的說明已被本次架構取代；已存在的舊單不自動拆單或搬移。私有 Cloud Run 發布、migration、映像 digest、revision、流量及雲端登入驗收證據由主線完成後另補，不能以本機測試或上一版的雲端 metadata 宣稱新版已發布。正式服務與正式 DB 不作本機驗收用途。

## 工作流程與資料歸屬

1. 出貨管理匯入一個 Excel／CSV。新格式整檔的 ERP 理貨單號必須相同，每列包含商城單號、SKU、國際條碼、品名、數量與可選的 S/N。
2. WMS 在同一 transaction 建立一個 `warehouse_import_batches` 批次及所有商城工作單；平台、店鋪、單號的完整組合相同才屬於同一工作單。同 SKU／條碼的來源明細列仍各自保留，不能跨單合併。
3. 匯入結果顯示批次、工作單數、商品列數、總件數、S/N 數及每張工作單連結。按「批量列印工作單」一次載入所有工作單完整快照並開啟列印，任一筆失敗時不列印部分結果。新商城工作單使用緊湊紙面，減少純簽名／備註造成的額外空白頁；舊單保留原版面。
4. 每張紙本顯示 ERP 批次、商城平台／店鋪／單號、商品／國際條碼／S/N／數量、揀貨與裝箱負責人欄。主條碼是該張工作單唯一的 `WT` 工作碼。平台原紙單沒有條碼時，可將 WMS 工作單附在原紙單上。
5. 任務看板「掃描工作單條碼即認領」明示操作人員；揀貨員固定揀貨，裝箱員固定裝箱，管理員必須明確選擇階段。掃碼即以登入者認領，成功後開啟該張工作單核對商品。原人工「開始揀貨／開始裝箱」保留。
6. 揀貨完成後，裝箱員再次掃同一張紙的工作碼認領裝箱。商品條碼或 S/N 只用於商品核對，不會替操作人員自動認領裝箱。

| 意義 | 儲存／API 欄位 | 規則 |
|---|---|---|
| ERP 理貨批次號 | `warehouse_import_batches.voucher_number`；API `batch_number` | 整檔必填且相同；重匯拒絕，不更新原工作單 |
| 批次識別 | `orders.import_batch_id` | 新商城工作單連回匯入批次；舊單為 null |
| WMS 工作單識別 | `orders.id` | 一個商城來源 tuple 一張可獨立認領的 orders |
| 工作單號 | `orders.voucher_number` | 新商城單使用 WMS 工作碼；原 ERP 號在 batch_number；舊格式仍保存原憑證 |
| 唯一認領條碼 | `orders.work_barcode` | `WT`＋18 位大寫十六進位字元；不使用可跨平台／店鋪撞號的原商城單號 |
| 商城來源 | `orders.source_order_number/source_platform/source_store` | 工作單來源；各商品的 `order_items.source_*` 同時保留 |
| 商品列識別 | `order_items.id` | 掃碼、S/N 與異動的精準目標 |
| 商城明細號 | `order_items.source_line_id` | 可空；同一來源 tuple 內若提供，不得重複 |
| SKU／國際條碼 | `product_code`／`barcode` | 各自必填；以文字保留前導零，不互相代用 |
| 品名／需求數量 | `product_name`／`quantity` | 名稱必填、正整數數量；規格可由來源端組合進名稱 |
| 每件 S/N | `order_item_instances.serial_number` | 有明確 S/N 時歸屬該商品列；不可跨列代用 |
| 責任人 | `orders.picker_id/packer_id` | 由 JWT 身分認領；GET 顯示 picker_name/packer_name |

來源欄位去除首尾空白，以文字或 null 保存，單欄最多 255 字且不可含控制字元。平台／店鋪可空，但應盡量提供；缺少識別資訊時，WMS 無法推斷同號原本屬於不同商店。商城來源的客戶名稱在同一工作單內須一致，不同工作單可不同。本次沒有建立每商城單地址、電話、運費或原銷貨單明細模型；未識別欄位不會自動保存為完整訂單資訊。

## Excel／CSV 格式

支援 `.xlsx`、`.xls`、`.csv`。新理貨明細使用單一工作表，一列商品一筆資料；每列重複 ERP 理貨單號與其商城來源。建議直接使用以下表頭，順序不限。

實際 ECOUNT「Excel(畫面)」下載在 A1 帶公司名稱與合法日期區間、第 2 列是明細表頭，最末非空列只有 A 欄的列印日期、中文星期及時間。解析器只在此完整外框成立且日期／星期／時間合法時略過最後列印資訊；中間時間列、帶其他值的頁尾、未知尾列與小計仍拒絕。原始 Excel 列號保留於錯誤訊息。一般平面格式仍可從第一列表頭開始。

CSV 使用 SheetJS `xlsx.read(..., { raw: true })` 保留原文字，避免 `001-002`、`0001/02` 等 SKU／商城單號被自動轉成日期，前導零也保留；數量欄仍另做正整數驗證。已確認的 ECOUNT 公司／日期、表頭與末列列印時間外框亦支援 CSV。此設定不改變 XLS／XLSX 的既有儲存格型別，無法還原上游 Excel 已經轉壞的識別碼。

| 建議表頭 | 必填 | 其他接受欄名 |
|---|---|---|
| 理貨單號 | 是 | 理貨單單號、理貨單編號、`voucher_number` |
| 商城訂單編號 | 是 | 商城訂單號、平台訂單編號、`source_order_number` |
| 平台 | 否 | 來源平台、`source_platform` |
| 店鋪 | 否 | 店舖、商店、`source_store` |
| 來源明細號 | 否 | 來源明細編號、商城明細編號、`source_line_id` |
| 品項編碼 | 是 | SKU、`product_code` |
| 品項名稱 | 是 | 品項名、`product_name` |
| 國際條碼 | 是 | 條碼、`barcode` |
| 數量 | 是 | `quantity` |
| 序號/批號 | 否 | SN、SN列表、`serials` |
| 摘要 | 否 | `summary`；只檢查是否遺漏待移入明確欄位的 S/N，不保存備註 |
| 客戶名稱 | 否 | 客戶/供應商名稱、`customer_name` |

表頭比對忽略空白及英文大小寫，並接受全形斜線；同一意義出現兩個表頭會拒絕匯入。商品列缺必要值、多個 ERP 理貨單號、重複來源明細號、S/N 不合法或數量不符，都在建立訂單前拒絕。沒有來源明細號時，各列依然獨立，不合併同 SKU／條碼。

合成範例（條碼、單號與 S/N 儲存格應使用文字）：

```csv
理貨單號,商城訂單編號,平台,店鋪,來源明細號,品項編碼,品項名稱,國際條碼,數量,序號/批號
TEST-PICK-001,TEST-SHOP-001,Shopify,測試店A,LINE-001,TEST-SKU-X,測試商品X,0012345678905,2,
TEST-PICK-001,TEST-1SHOP-001,1Shop,測試店B,LINE-001,TEST-SKU-X,測試商品X,0012345678905,1,
TEST-PICK-001,TEST-1SHOP-001,1Shop,測試店B,LINE-002,TEST-SKU-Y,測試商品Y,4710000000013,1,TESTSN000001
```

此範例產生 1 個 ERP 匯入批次、2 張可獨立認領的商城工作單、3 商品列、4 件商品及 1 筆 S/N。

限制沿用：10 MiB、5,000 工作表列、100 欄、1,000 商品列、10,000 S/N、總數量 50,000。新格式拒絕多工作表，以免只讀第一張而漏掉其他理貨單。既有單憑證格式仍走原解析路徑。

### S/N、摘要與 ECOUNT 匯入分單序號

- 新明細只從明確的 `序號/批號`／SN 欄解析 S/N。接受每筆 12 或 13 碼英數字及既有多序號分隔方式，統一大寫；有 S/N 的商品列須提供與數量相同的有效且不重複序號。空白表示此列採數量核對。
- ECOUNT 銷貨匯入範本的 `序號` 是匯入分單序號，不是產品 S/N。新明細解析不以單獨的 `序號` 欄推斷 S/N。
- 舊格式為相容既有流程，仍保留從 `摘要` 辨識序號的行為。新理貨契約不自動將自由文字摘要轉成 S/N；若明確 S/N 欄為空或不存在，而摘要含有原規則可識別的序號或 `SN:`／`SN：` 標記，會拒絕整次匯入並指出列號，要求移至 `序號/批號`，避免默默以無 S/N 商品核對。普通配送備註仍可匯入；摘要本身不儲存為完整訂單詳細資訊。
- `序號/批號` 是接受的來源欄名；任意批號不因此成為可追蹤 S/N。只有符合目前 WMS 序號格式／件數規則的資料才可使用此欄。不同長度或純批次追蹤需求需另定契約。

商品主檔若沒有國際條碼，需先由有權限的營運人員補齊或提供明確對照；不能假設 SKU 等於條碼。新匯入不以 SKU 補條碼，也不以條碼補 SKU。原商品新增異動 API 尚無獨立 SKU 欄，保留原有以條碼建立新增商品的行為；不要將此舊 API 當作完整的商品主檔同步介面。

## 掃碼認領、權限與結果恢復

### 精確認領 API

`POST /api/orders/claim-by-barcode`：

```json
{
  "barcode": "WT001122334455667788",
  "stage": "pick",
  "commandId": "00000000-0000-4000-8000-000000000001",
  "expectedActorId": 7
}
```

- `stage` 僅 pick／pack；`commandId` 為 UUID v4。`expectedActorId` 是畫面操作人員的前置條件，必須等於 JWT 使用者，並非指定負責人。若跨分頁換帳號造成不一致，回覆 `CLAIM_NOT_APPLIED / SESSION_CHANGED`，不認領、不改數量。真正 owner 始終來自 JWT。
- 條碼採精確比對 `work_barcode` 或既有 `voucher_number`。不使用任務搜尋的模糊結果，不用 raw 商城單號猜測平台／店鋪。若工作碼與舊憑證撞出多筆候選則拒絕，要求核對及重印。
- 回覆包含 `commandId/orderId/voucherNumber/workBarcode/stage/outcome/owner/order`。`outcome` 為 claimed 或 continued；同本人、同階段且仍在作業才可 continued，不重複寫認領日誌、不改商品數量。階段完成或其他人持有時拒絕，不自動切到下一階段。
- 已知未套用回覆 `CLAIM_NOT_APPLIED`，reason 包含 INVALID_INPUT、NOT_FOUND、AMBIGUOUS、FORBIDDEN、OWNED_BY_OTHER、STAGE_COMPLETE、INVALID_STAGE、BLOCKED、COMMAND_REUSED、SESSION_CHANGED；鎖／statement timeout 可回 BUSY。提交結果不明時回 `503 CLAIM_RESULT_UNKNOWN`。

前端在送出前保存原 barcode、stage、commandId、expectedActorId 到使用者專屬 sessionStorage，且以同步 gate 阻止另一張掃碼、人工領單、批次領單重疊；不排隊自動補送。載入同一使用者的未確認請求後，只能先查詢原結果：

`GET /api/orders/claim-commands/:commandId?expectedActorId=7`

成功收據以 JWT 使用者與 commandId 查詢。`404 CLAIM_RECEIPT_NOT_FOUND` 不代表原請求沒有提交，可能仍在處理；保持鎖定，可再次查詢，或按「以相同識別碼重送原認領」重送完全相同的原 body。不得換 UUID／條碼／階段。未知結果後的重送即使遇到 CLAIM_NOT_APPLIED，也保留原未確認命令：例如 BUSY 可能是原請求仍持有鎖且稍後提交，SESSION_CHANGED 也不能證明原帳號請求未提交。原命令需由收據確認，不能以本次重送失敗解鎖改掃下一張。

已持久化的拒絕結果亦可形成收據：`outcome: rejected`、`definitive: true`、`code: CLAIM_NOT_APPLIED`，包含 `commandId/stage/expectedActorId/reason/message/httpStatus`。GET 回 200 與此 body；POST 首次及重送以原 4xx status 回相同 body。只有核對 commandId、stage、expectedActorId 均符合原命令的 definitive 拒絕，前端才清除原命令與 gate，顯示原因並允許下一張工作單。負面收據在同 command 鎖內保存，晚到或重送的原 UUID 仍回覆原拒絕，不會再認領。BUSY、解析失敗及身分不一致沒有 definitive 標記，不能當作未確認原命令的終局證據。

收據是歷史結果，不代表目前仍擁有工作單。前端只用收據取得目的工作單 id，再從 `work-snapshot` 重新讀取目前 owner、status 與商品，不能用 receipt.order 開放商品掃碼。離開／切換看板後的遲到成功不搶導頁；帳號／角色切換重新建立工作台狀態，避免沿用舊人的認領 controller 或商品快照。跨分頁儲存帳號不一致時，前端先阻止提交／恢復並要求確認原操作人員；server 的 expectedActorId 比對仍是最後的身分前置條件。

### 商品核對與既有功能

`POST /api/orders/update_item` 保留 `orderId/scanValue/type/amount/commandId/expectedState/responseMode`，可另傳正整數 `orderItemId`。所有角色（包含管理員）核對揀貨時必須是 picker_id 且狀態為 picking，裝箱時必須是 packer_id 且狀態為 packing。picked 狀態不能靠第一筆商品掃碼自動認領。管理員若要接替作業，先走原有轉交給自己，再核對商品；管理／例外核可能力保留。

商品碼相同但多列來源明細可作業時，未指定商品列會回 `409 SCAN_NOT_APPLIED / SOURCE_ITEM_REQUIRED`；操作員需用該商品列的數量按鈕或可唯一識別的 S/N。S/N 受 orderItemId 限制，不能掃另一列序號代用。沒有來源欄位的舊單保留原同條碼分配邏輯。

商品異動使用 `orderItemId` 指定既有列，保留原來源，不允許改派或清空。新工作單新增商品必須符合該工作單來源，不另建混入其他商城的明細。原異動 API 尚無獨立 SKU 欄，沿用原建立方式，不能當作商品主檔同步介面。

舊單仍可顯示原來源分組、定位和完整主單件數。舊來源條碼標為「商城訂單定位條碼（不可認領）」；新商城工作單紙面只印唯一工作單認領條碼。舊單沒有 work_barcode 時列印原憑證 CODE128；不符合可編碼範圍時保留單號及手動輸入提示。

原掃碼 UUID／stateToken／收據、未知商品掃碼恢復、八種個人音效、SN 更換後才能完成、新品不良、例外阻擋與主管核可保留。一般 GET、snapshot、delta、異動紀錄保留商品來源；父工作單統計與完成判定使用該工作單全部商品。不同 ERP 批次出現同商城單號仍可存在，系統不據此自動判定分批出貨或重複出貨。

既有 Socket 主要在工作單狀態變更時通知，並非每筆商品掃碼都向第二個瀏覽器即時推送 item delta。第二人可能要重新載入；不能宣稱逐筆共同揀貨。Cloud Run 保留最多 1 instance。

## Migration 與回復界線

- `028_order_item_source_identity.sql` 增加四個 nullable order_items 來源欄位與 CHECK／索引。
- `029_warehouse_batches_and_claim_receipts.sql` 新增 warehouse_import_batches、orders 的 batch/source/work_barcode，以及 wms_claim_commands。batch/source tuple 有唯一索引；work_barcode 唯一且限制格式；claim command 主鍵為 user_id＋command_id，保存 request_hash 與成功／確定拒絕的 response。order_id 可為 null，刪單時 SET NULL 保留收據，避免同 UUID 失去終局紀錄。
- 既有 orders／items 不回填、不拆單、不搬移、不重新認領；029 舊單新欄位為 null。新舊匯入與重複批次保護在 transaction 內處理。
- migrationManifest 自動載入編號 SQL、驗 checksum。schema readiness 要求新表與欄位；先以新版映像的獨立 release job 執行 migration，明確指定相同 PGDATABASE 與 WMS_TARGET_DATABASE。應用啟動只檢查 schema，不自動修改。
- 回退映像時保留 database、批次、工作單、收據與新增欄位，不能還原舊 dump、DROP 新欄位或使用舊 runner 覆寫較新 ledger。舊映像不理解批次與來源責任規則；若必須回退，先暫停本次新格式匯入與相關工作單作業，核對現有任務，再採取經 review 的相容方案。

## 驗證狀態

以下只列本次「批次→商城工作單→掃碼認領」模型的證據，不沿用先前 one-parent 實作的通過數作為新版驗收。

| 層級 | 最新狀態 |
|---|---|
| Frontend unit | 包含帳號隔離、expectedActorId、未知 retry BUSY race、definitive 負面收據及緊湊列印，完整 145/145 與 Vite build 通過 |
| Backend unit | 含 expectedActorId、definitive 負面收據、ECOUNT 報表外框、CSV 文字識別碼及全合成 S/N fixture，最終 22 suites／223 tests 通過（backend owner 回報） |
| PostgreSQL 批次／claim | 含 expectedActorId、definitive 負面收據及全合成 S/N fixture，最終 14/14 通過（backend owner 回報） |
| 既有 PostgreSQL parity | 本次既有流程 22/22 通過 |
| 真瀏覽器 | 新工作單／認領流程 16/16、既有 legacy browser 12/12 通過；含交付 XLSX、獨立揀貨／裝箱、搶單、跨帳號、成功／拒絕收據、BUSY 恢復與手機。批量 PDF 3 工作單共 3 頁，三頁工作碼均可解碼，pageErrors 為空 |
| ECOUNT 報表外框 | 另以公司／日期標題、第 2 列來源表頭、末列列印時間的合成檔完成瀏覽器匯入驗證；不併入上列 16＋12。原歷史匯出缺少商城來源，仍在第 3 列拒絕，未建立 DB 資料；CSV 識別碼保留另由最後 223 unit 與 14 PG 驗證 |
| 私有 Cloud Run | 發布與雲端驗收證據由主線另補；本機通過不等於私有或正式發布 |

本機使用 Node.js 22.19.0。PG 僅連 `127.0.0.1:55441`，建立隨機隔離 database，清理只作用於自己的資料。既有展示 runtime 未在前端實作過程中停止。合成 workbook 的來源平台使用 Shopify／1Shop，僅測試資料；不視為真實 ECOUNT 匯出已驗收。

```sh
npm run test:unit --prefix backend
WMS_PARITY_PG_TEST=1 node --test backend/tests/warehouse-parity.pg.test.cjs
npm test --prefix frontend
npm run build --prefix frontend
```

仍需核對真實 ECOUNT 匯出是否包含每列商城來源、獨立 SKU／國際條碼與明確 S/N；私有雲端登入、實體掃碼槍、印表機和使用者試操作亦由相應證據另行確認。

相關程式：`backend/src/services/orderImportParser.js`、`warehouseBatch.js`、`orderClaimService.js`、`orderChangeService.js`、`scanSnapshot.js`、`backend/src/routes/orderRoutes.js`；`frontend/src/utils/claimScan.js`、`workOrders.js`、`sourceOrders.js`、`orderWorkProgress.js`；`frontend/src/components/ScanToClaim.jsx`、`TaskDashboard.jsx`、`OrderWorkView.jsx`、`LabelPrinter.jsx`、`admin/AdminDashboard.jsx`。

## 重新開啟理貨批次（2026-09-15）

最新確認的作業流程仍是商城子訂單認領揀貨、裝箱二次核對。現場可先集中商品，但此功能不增加批次認領、總揀責任人或第三階段，也不會因為查看商品合計而改變子單狀態。

- 新增 `/batches/:batchId` 唯讀頁，從匯入結果、任務的 ERP 批次及子單表頭進入。重新整理後仍可讀取既有批次。
- `GET /api/order-import-batches/:batchId` 沿用已登入的訂單讀取權限，預設子單每頁 30 筆，最大 100，使用批次範圍游標。
- 回傳全批商品及進度合計、各狀態子單數、當頁子單與負責人；商品按 SKU 與國際條碼共同彙總。沒有倉位資料時不宣稱規劃倉內路線。
- 有 SN 的品項依實際序號狀態計算進度，先彙總序號再接商品，避免需求數量被序號筆數倍增。作廢子單仍可追查，但與有效商品需求分開呈現。
- 查詢使用單一 repeatable-read、read-only transaction，不修復資料、不認領、不寫入日誌或變更進度。可列印子單 ID 與整批 ID 分開回傳；列印仍走既有完整工作單快照流程。
- 批次只是來源及進度的管理單位；每筆商城子訂單仍各自使用唯一工作條碼認領及核對，`completed` 只表示倉內裝箱核對完成。

封箱後立即列印的標籤種類及硬體尚待確認。現有 `ShippingLabel` 是 WMS 內部摘要，不能當成承運商面單；既有綠界官方表單需已有且正確關聯的物流單。此批次頁變更不新增封箱、已列印、已交物流狀態，也不修改現有列印或核對完成行為。

此版驗證：backend unit 23 suites／237 tests、frontend unit 156/156、Vite build、來源訂單 PostgreSQL 15/15、批次瀏覽器 10/10 均通過。批次瀏覽器涵蓋 31 張子單翻頁、作廢獨立統計、從第 2 頁列印全批有效工作單、更新失敗保留舊資料並禁印、單張完成後其他子單狀態不變。列印在開啟實際對話框之前再次檢查帳號與頁面生命週期，防止離頁或換帳號後的延遲列印。另以最終列印實作驗證合成 Excel 與三張紙本工作碼 2/2，無瀏覽器例外。

保留的本機展示資料仍為原 3 張待揀貨工作單、5 商品列、7 件、3 個合成 SN；新版 API／前端啟動與查看批次沒有 migration、seed、認領或資料異動。私有更新、正式流量及真實 ECOUNT 鏈路需分別查核，不能以本機驗證代替。
