# 理貨單日期時間頁尾匯入修正（2026-09-17）

## 問題與修正

使用者提供的截圖為理貨單：第 5 列表頭、第 6 列商品、第 7 列總計、第 8 列列印時間「2026/09/17 (四) 17:45:26」。原解析器將 A8 視為品項編碼，因缺少名稱與數量而拒絕整份匯入。

現在僅當最後一個非空白列只含一個合法日期時間儲存格，且前面已有有效品項，將該列視為列印頁尾略過。支援斜線／連字號日期、可有中文星期與全形括號、時分或時分秒，以及符合此顯示格式的 Excel 日期儲存格／合併儲存格。日期與時間範圍會驗證。

頁尾時間不建立品項，也不增加數量、SN 或工作任務。中間列的時間、還有其他內容的列、缺商品欄位與科學記號條碼仍走既有檢查。空白頁尾、原始列號與錯誤位置仍保留。沒有資料庫 migration、資料回填或正式訂單重新匯入。

## 測試

- 185 個後端單元測試通過；新增 20 個案例覆蓋 XLSX / XLS / CSV、截圖版型第 8 列、日期／文字／合併儲存格、空白尾列與不可略過的異常商品列。
- 45 個隔離 PostgreSQL / HTTP / Socket / 瀏覽器測試通過，包含 13 個瀏覽器流程。
- 使用與截圖版型相同的合成測試檔，實際匯入 API 只建立 1 品項／1 件、保留匯入者與稽核，再以一般揀貨員／裝箱員完成掃碼。
- 原匯入頁面測試也加入列印時間頁尾，含 SN 的訂單匯入、備註、釘選、不良異動及後續掃碼均通過。
- 既有批次揀貨／裝箱與連續 500 次揀貨／500 次裝箱回歸通過。
- 首次新增 PG 測試對 details 使用物件存取，但欄位實際為 JSON 文字；改為 details::jsonb 讀取後完整重跑通過，應用程式無對應缺陷。
- 使用者此次提供的是截圖；未取得或匯入原始理貨 Excel，測試不宣稱驗證未提供檔案的其他內容。

## 發布與驗證

- 程式 commit：`754807494602b3eccf8bf607aac65151b1706f9c`
- Cloud Build：`b877f717-0028-4680-af3f-78288f867576` 成功。
- GitHub 程式 CI：`35211824711` 成功；前端測試與 build 由 CI 驗證。
- 專案 `moztech-main-db`；服務 `corely-wms`；區域 `asia-east1`。
- revision `corely-wms-import-footer-20260917`：先 0% 候選驗證，再 100% 正式切換並讀回確認。
- API 映像：`asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-backend@sha256:66df66c1bd2624f77a9bb532af4813625b83e7e0de9083c44a93c19d241bc26f`
- https://wms.corely.cc 與 https://corely-wms-249593319772.asia-east1.run.app 的 login / health / ready 200，未登入 API 401。
- 已登入的兩階段任務清單與既有批次階段驗證仍正常。正式驗證不提交實際匯入，不新增或更動業務資料。
- 只更新 API 映像；web 映像、IAM、秘密、runtime SA、Cloud SQL、GCS、scaling 不變。未更動共用驗收服務或已暫停的 Render。

## 使用方式與回復

使用者可在匯入畫面重新選擇原本的理貨單；符合上述格式的日期時間頁尾不必刪除。若其他商品欄位有誤，仍會明確回報該列。

前一 revision `corely-wms-batch-stages-20260917` 保留，可切回 100% traffic；回退程式不回復資料庫，且會恢復此頁尾匯入限制。

原始碼工作區：`/Users/moztecheason/Documents/moztech-wms-import-footer-20260917`；分支 `codex/wms-import-footer-20260917`。GitHub main 以非強制 fast-forward 同步；發布證據位於協調工作區 `artifacts/wms-import-footer-20260917/`。
