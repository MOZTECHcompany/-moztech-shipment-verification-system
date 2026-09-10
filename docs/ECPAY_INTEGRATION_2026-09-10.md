# 綠界 B2C 串接交接 — 2026-09-10

## 已完成範圍

- 隔離 checkout：`/Users/moztecheason/Documents/moztech-wms-ecpay`，分支 `codex/wms-ecpay-b2c`。
- 基準 `3d12a4d3d392607981d230b7a7d5966a759b1edf`：依前次正式部署 manifest 驗證並複製 141 個來源檔案；原始 WMS 與 ERP checkout 未改動。
- 雙帳號配置、管理員即時權限查核、指定帳號查詢、MAC 簽章與回應驗證、逾時與回應大小限制。
- 既有物流單加入追蹤、貨態查詢更新、事件紀錄、未取件預期退回記錄、託運單列印表單。
- 正向物流回呼：驗章、去重、先持久化再 ACK；回呼只要求重新查詢，不直接覆寫貨態。部署仍關閉回呼。
- 新增 migration `020_ecpay_tracking.sql`。只新增物流表，不寫入原有訂單、庫存、發票、退款或銷貨退回。
- 物流介面位於「設定 → 物流串接」，目前限 admin / superadmin。

## 帳號實查

| 商店 | 狀態 | 範圍 |
| --- | --- | --- |
| 3150241 | 已由 Chrome 後台確認並成功查詢正式單 | 7-ELEVEN 常溫、全家、萊爾富 B2C；列印測試已通過的通路 |
| 3290494 | 未驗證、停用 | 待登入第二帳號查核物流權限與專用金鑰 |

3150241 後台另顯示宅配與退貨通／退貨便服務；本次程式僅開通上述三種 B2C 超商查詢與追蹤。C2C 未啟用，冷凍未完成列印測試。本次核對付款與物流金鑰相等後，才由既有 ERP 秘密建立 WMS 專用 Secret；不能將此結果推廣到第二帳號或發票金鑰。

ERP 將 3150241 標示為 1Shop／團購，但物流後台販售網址為 bonson.cc。不可依帳號名稱直接推斷訂單品牌；必須用来源訂單與物流識別建立關聯。

## 測試與候選部署

- `node --test backend/tests/ecpay*.test.cjs`：17 項通過，含 PGlite 真實 PostgreSQL 語法／交易、重複匯入、帳號隔離、回呼重送與先後順序、角色降權、MAC 官方固定向量。
- `npm run build --prefix frontend`：通過；既有大型 chunk／Browserslist 提示仍在。
- Cloud Build：`efeb0d09-ee0f-4238-8669-75d94d5ccddb` 成功。
- 新增表 migration job：`corely-wms-ecpay-migrate-kgvz8` 成功；1 applied、20 skipped。
- 候選 revision：`corely-wms-00008-5sb`，tag `ecpay-preview`。
- 候選：<https://ecpay-preview---corely-wms-sp5g377smq-de.a.run.app/settings/logistics>。
- 正式仍為 `corely-wms-00010-hug`，100% 流量；候選沒有正式流量。
- 候選驗證：health、ready、SPA 入口、真實管理員登入、既有 tasks API、未登入 401、第一帳號可查／第二帳號停用、正式物流查詢與保存、列印表單簽章欄位、回呼維持關閉，全部通過。
- 已追蹤一筆真實既有物流單 `50078719`，回應 `2031`／等待賣家出貨；未關聯 WMS 訂單、未建立新綠界物流單。
- Chrome 控制中途回報 `Debugger unattached`。實際畫面操作、列印版面與印表機尚未驗收，不能視為完整上線驗收。
- 舊 bootstrap Secret v1 已無法登入；候選改以使用者本次對話已提供之管理員帳密驗證成功。沒有重設帳密，也未保存新密碼於來源或驗收文件。

## 尚未完成，不能當作已上線能力

1. 第二帳號服務／秘密核對，以及兩帳號來源訂單對照。
2. 1Shop／ERP 訂單來源接入、既有物流識別批次匯入與全量對帳。綠界 V5 API 需要已知物流編號或廠商單號，不能當作商店全部訂單清單 API。
3. 新建正向物流單：需來源訂單、收件門市、金額、溫層等驗證，持久化冪等建單流程、查詢補償、人工確認與正式驗收；尚無建單 endpoint。
4. 逆物流：新建退貨通／退貨便、逆向回呼、維修品歸屬、倉庫掃碼實收、檢驗及 ERP 銷貨退回交接，尚未實作。未取件回流與顧客主動退貨必須分開。
5. 自動追蹤尚未啟用。`scripts/ecpay-poll.js` 只有手動維護入口；排程前必須補 lease、失敗退避與公平輪詢，避免失敗單佔滿每批 30 筆，並完成告警與負載測試。
6. 原綠界 callback 位置尚未釐清；未改寫任何既有 callback。啟用前先確認原 1Shop／ERP 接收責任、轉送及補帳方案。
7. 實際託運單列印、瀏覽器 UI、現場收退貨流程及第二帳號驗收。
8. 新竹物流直連、順豐直連尚未建置；本帳號由新竹承運超商退回不等於已有新竹 API 契約。

## 回復與保護

- 本次尚未切換正式流量。若移除候選，先移除 `ecpay-preview` tag；不要刪除既有正式 revisions。
- 後續切換前再次核對即時 traffic、其他工作者與資料庫狀態。發生問題時把 100% 流量回復本次確認的原正式 revision；執行前須確認是否已有後续發版。
- 新增物流表保留，避免丟失追蹤證據。舊應用 readiness 可容忍新增 ledger 列，原業務表未變更。
- 不要以舊 migration image 重跑：舊 migration runner 遇到新增 ledger 名称會拒絕執行。採新 migration job／新映像。
- `corely-wms-ecpay-accounts:1` 只授予 WMS runtime 讀取；未改動 ERP Secret、網路、來源商店設定或其他資料庫。
- callbacks 關閉，scheduler 未建立，無新建物流單／逆物流單／退款／庫存自動扣補。

## 官方依據

- 查詢：<https://developers.ecpay.com.tw/7418/>
- MAC：<https://developers.ecpay.com.tw/7424/>
- 列印：<https://developers.ecpay.com.tw/8875/>
- 正向回呼：<https://developers.ecpay.com.tw/7420/>
- 正向建單：<https://developers.ecpay.com.tw/8809/>
- 逆物流流程：<https://developers.ecpay.com.tw/10429/>

部署與檢查紀錄：`/Users/moztecheason/Documents/ChatGPT/AI 儲運管理系統/artifacts/wms-ecpay-20260910/`。其中 service JSON 僅含 Secret 引用，不含金鑰值。
