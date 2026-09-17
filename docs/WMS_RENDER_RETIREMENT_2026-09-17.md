# Render WMS 停用紀錄（2026-09-17）

使用者授權停止舊 WMS API 與資料庫以取消持續費用。2026-09-17 約 15:44–15:46（台灣）在原帳號 Render Dashboard 完成以下操作：

| 資源 | ID | 結果 |
|---|---|---|
| moztech-wms-api | srv-d13f02re5dus73emj2ag | Suspended by you |
| shipment-verification-db | dpg-d35ci40dl3ps738iagn0-a | Suspended by you |

兩個資源頁都明確顯示 **You are not billed for suspended services.** 帳務頁也標記兩者 Suspended。這是可恢復的暫停，未永久刪除資料、服務、帳號或移除付款方式；恢復服務將重新產生費用。

## 停用前後查核

- 正式 `corely-wms` 維持 `corely-wms-order-complete-20260917` 100% 流量，連到公司 Cloud SQL `moztech-main-db / corely_wms`，附件為私有 GCS `moztech-main-db-corely-wms-attachments`。未更動新站設定或資料。
- 35 個公司 Cloud Run 服務的可見設定沒有舊 WMS API／Render DB 位址。此範圍不包含其他系統資料表中的設定、秘密內容或使用者書籤。
- Render 舊 DB 停用前仍回覆 PostgreSQL `55000`，確認切換後的新連線封鎖仍有效；沒有解除停寫。
- 原始停寫備份 `frozen-source-20260913/frozen.dump` 仍在私有備份目錄，4,865,368 bytes，SHA-256 `f72e6effd534b5572bf27f23ad4c517b8e1037ed30b28ce599a7cb7a1d4c5d87`，本次實際重新校驗一致。
- 公司 Cloud SQL 自動備份與 PITR 啟用、保留 15 份備份與 7 日交易日誌、刪除保護啟用；最近三份每日備份均成功。
- 兩筆歷史缺檔附件 ID 3、4 在 Render Shell 以原始檔名、uploads 路徑及 47,300 bytes 大小搜尋，專案目錄與 `/tmp` 未找到檔案。沿用既有缺失紀錄，不能宣稱原檔已找回。
- 停用後舊 API `/health` 回應 503；新站 `https://wms.corely.cc/login`、`/health`、`/ready` 均為 200。

## 費用與範圍

本月停用前已累積的費用仍需結算，不會因暫停而抹除。Render 帳務頁另有 `consent-backend`、`moztech-consent-db` 計费；它們不是本次指定的 WMS 資源，未操作。工作區仍為 Hobby。不能把本次結果說成整個 Render 帳號已零費用。

舊靜態前端、Vercel、其他系統與付款資料均未變更。舊前端的 API 現在已不可用；正式 WMS 唯一入口是 `https://wms.corely.cc`。

## 後續維護

不要因排查而自行 Resume 舊服務或開啟舊 DB 寫入，以免重新計費或造成兩邊資料分歧。正式資料以 Cloud SQL 為準，程式回復採 Cloud Run revision 回退；不能用 9/13 舊 dump 覆蓋新站後續作業。

本機查核收據：`/Users/moztecheason/Documents/ChatGPT/AI 儲運管理系統/artifacts/wms-render-retirement-20260917/`。帳密與資料備份未放入 Git。
