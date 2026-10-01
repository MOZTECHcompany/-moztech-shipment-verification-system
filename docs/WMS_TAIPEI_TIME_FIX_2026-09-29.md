# WMS 留言台灣時間修正（2026-09-29）

## 問題與修正

訂單卡片「最新留言」將 UTC 時間當成使用者本機時間。正式資料中的 comment 1347、order 5079，資料庫原值為 2026-09-29 05:53:59.263438；應顯示台灣時間 2026/09/29 13:53，舊卡片卻顯示 05:53。

原因是 task_comments.created_at / updated_at 與 task_mentions.created_at 為不含時區的 timestamp，現行正式寫入使用 UTC；工作台 JSON 摘要未帶時區。一般留言 API 的 node-postgres Date 解析也可能依主機時區而不同。

- 留言、任務摘要、釘選、提及及未讀摘要查詢明確將舊欄位解讀為 UTC instant，輸出有時區的時間。
- 前端所有留言共用 Asia/Taipei 顯示；相容舊 API 不帶時區的 UTC 字串，並保留明確 offset。
- HTML time 的 dateTime 與畫面、混合格式留言排序保持一致。
- 微秒游標、排序和歷史原值保留，不更新歷史時間、不改資料庫全域時區、無 schema migration。

## 驗證

- 後端單元測試 185、前端 136，全部通過；前端正式 build 成功。
- 隔離 PostgreSQL + HTTP + 瀏覽器整合共 47 項通過，其中瀏覽器流程 14 項；額外 PostgreSQL 任務分頁 10 項通過。
- 用 05:53:59.263438 UTC fixture，確認卡片、浮動對話窗與訂單留言都顯示 13:53；瀏覽器 Asia/Taipei / America/Los_Angeles 結果一致。
- API 整合覆蓋 DB session UTC / Asia/Taipei 的明確 instant、POST 回應、釘選、提及、未讀摘要及精確微秒翻頁；未修改原始資料。
- 正式驗證只讀取既有資料；沒有建立測試留言或變更訂單。

## 發布

- 正式網址：https://wms.corely.cc；run.app：https://corely-wms-249593319772.asia-east1.run.app。
- 公司專案 moztech-main-db，asia-east1 / corely-wms；revision `corely-wms-taipei-time-20260929` 已接收 100% 流量。
- 程式提交：`4b8694a67aace46e81c15eb27bdb4b58ae3e9a91`；文件後續提交不改建置輸入。
- GitHub 程式 CI #36530586148 通過。Cloud Build `b77e4bc3-78d9-4d1d-8a34-25e3e3dd6015` 成功。
- 0% 候選與正式站均通過 login、health、ready、未登入 API 401 檢查。
- 正式既有 comment 1347 API 回傳 `2026-09-29T05:53:59.263Z`，前端顯示 `2026/09/29 13:53`；最新卡片 comment 1348 回傳帶 +00:00 的時間，顯示 `13:54`。驗證前後原始儲存時間一致。
- 正式 frontend main-CZZxJQNw.js / MessageTimestamp-ClWTiu4W.js 已確認包含台灣時區與舊格式 UTC 相容處理。
- 只更新前後端映像；Cloud Run IAM、runtime 設定及共用私有驗收服務保持原狀。

- web: `asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-frontend@sha256:d70c3574d6ee4491bd83b3d7bed6cf37bf222c5528ad317067948879ddd7d590`
- api: `asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-backend@sha256:ceac1164c9791e61d08ad23834e52a876d7b8f98616ab70b44961c6281f2b62f`

本機證據：`artifacts/wms-taipei-time-20260929/`（協作工作區），含測試、Asia/Taipei / America/Los_Angeles 瀏覽器截圖、source-manifest、candidate / production smoke、唯讀查核與 traffic 讀回。

## 回復

前一版 corely-wms-import-footer-20260917 保留。若需程式回復，可將 corely-wms 流量切回該 revision；不需回復或重寫資料庫。

