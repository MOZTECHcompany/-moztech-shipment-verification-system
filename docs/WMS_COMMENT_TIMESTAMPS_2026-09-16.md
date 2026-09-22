# 對話完整日期與時間（2026-09-16）

浮動對話原先只顯示時分，且同一人連續留言會隱藏後續訊息時間；訂單內討論頁則顯示相對時間，跨日不易核對。

## 修改

- 每則浮動對話都顯示 `YYYY/MM/DD HH:mm`，包含同一人連續留言、緊急／系統通知及自己的回覆。
- 訂單內實際使用的 `TaskComments-modern`、釘選留言、提及收件匣、任務卡最新留言、通知摘要與公告留言使用同一元件。
- 固定 `Asia/Taipei`、24 小時制；午夜顯示 `00:00`，不因作業電腦時區不同而換日錯誤。
- 使用每則原有 `created_at`（提及則優先 `comment_created_at`）；不補造日期、不改資料庫。缺失或無效時間顯示「時間未知」。
- 日期時間不依賴 hover；窄版標頭可換行，保留留言內容、分組、釘選、已讀與回覆行為。

## 驗證與正式發布

- 程式提交：`00f24db7a85e579105d710ec8350a59833b5525c`。
- 本機前端測試 106/106、Vite build 通過；GitHub Node.js 22 CI 後端 155/155、前端 106/106 與編譯通過。
- 隔離瀏覽器檢查 1280px / America/Los_Angeles、390px / UTC：浮動對話、連續同作者、緊急、自有回覆、跨日、完整討論、釘選及公告留言。另確認午夜、跨年與無效時間。
- 以正式零流量候選的實際前端映像重跑上述兩種尺寸，通過 6 組畫面檢查；測試 API／Socket 皆使用合成 fixture，未向正式資料庫新增留言或已讀紀錄。這是前端日期顯示驗證，不宣稱重跑全部業務流程驗收。
- 共用私有驗收服務當時正在使用另一項 `corely-wms-migration-validation-claim-49f3725-0915` 候選，因此本次沒有修改或覆蓋該服務。
- Cloud Build：`a0994724-b1f9-44a0-b023-ffc9b58d146b`，SUCCESS。
- 正式 revision：`corely-wms-chat-time-20260916`，100% 流量，已透過服務 describe 讀回確認。
- 正式入口 https://wms.corely.cc 與 https://corely-wms-249593319772.asia-east1.run.app 的登入頁、health、ready 及匿名業務 API 拒絕檢查通過。
- 只更新 web container 映像；API 映像、資料庫、附件、Secret Manager 引用、IAM 與其他 container 設定比對一致；沒有 migration 或業務資料回灌。
- 前端映像：`asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-frontend@sha256:e2b96c7c5999f2afc052ad0a4a097c7b3e374e4bf65a6574155c479a763a334e`。
- 程式回復 revision：`corely-wms-scan-sound-20260914`，保留現在資料庫。舊 Render／Vercel 不在本次發布範圍。

使用者完成手上操作後重新整理頁面即可載入新版。

本機發布與畫面證據：`/Users/moztecheason/Documents/ChatGPT/AI 儲運管理系統/artifacts/wms-comment-timestamps-20260916/`。正式環境與資源說明見 `WMS_ENVIRONMENT_HANDOFF_2026-09-14.md`；其中日期較早的 revision／映像為歷史快照，接手仍須即時查核。
