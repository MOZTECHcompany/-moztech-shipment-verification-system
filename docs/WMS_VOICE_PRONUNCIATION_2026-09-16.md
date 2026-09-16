# 揀貨／裝箱語音修正（2026-09-16）

## 問題與修正

使用者回報「揀貨」漏字／唸錯、「裝箱」聽似其他字。當時設定頁選擇 Shelley（zh-TW）與 Sandy（zh-CN）；原程式只依中文語言標籤列出聲音，未排除使用者指出的角色音色。播報文字本身未寫成「理箱」。本次處理音色選擇、發音用字及節奏，不將自動化合成呼叫測試視為真人聽音驗收。

- 只提供台灣中文 `zh-TW`／`cmn-TW`（含底線格式），排除回報有問題的 Eddy、Flo、Grandma、Grandpa、Reed、Rocko、Sandy、Shelley；不再提供 zh-CN、zh-HK 音色。
- 舊選擇不可用時，實際播報改用可用台灣中文原聲；支援辨識本機名稱「美佳」。保留原儲存值與語音開關，不擅自解除靜音。
- 自動揀貨優先已知女聲，裝箱優先已知男聲。只有一種聲音時兩階段使用同一原聲，UI 明確說明；不把未知第二種聲音當作男聲，不以高低變調代替男女聲。
- 語速恢復 1、音調固定 1。數量句增加短停頓；揀貨播報使用同音字「撿貨」，畫面仍顯示「揀貨」。短句為「撿貨，3，剩 2」／「裝箱，3，剩 2」，完成句為「撿貨任務完成」／「裝箱任務完成」。無人名。
- 沒有台灣中文聲音時不回退到未知系統語音。設定頁明示需安裝語音並停用試聽；掃碼區摘要顯示缺少台灣中文語音。個人掃碼音效仍獨立運作。
- 保留確認後播報、完成提示優先、快速掃碼僅保留最新待播數量、靜音、延遲載入聲音清單及錯誤不影響掃碼存檔的機制。

此版本優先於 `WMS_VOICE_IMPORT_2026-09-16.md` 的聲音清單與同聲變調描述。科學記號匯入攔截及其他 WMS 功能沿用已部署版本；本次無後端修改、migration 或業務資料寫入。

## 驗證

- 前端 120 項測試通過、production build 通過。首次全套測試因新 checkout 尚未安裝 backend 的 Socket 依賴失敗，安裝鎖定依賴後重跑全數通過。
- 本機真實前端 1280／390 px、揀貨／裝箱共 16 個瀏覽器檢查：刷錯重刷、確認數量、完成播報、返回工作台、男女語音路由、儲存選擇、舊 Shelley／Sandy 改用美佳、禁止問題選項、靜音下試聽、無可用聲音及響應式排版。
- 瀏覽器測試使用合成訂單；全部 API 及 Socket 攔截，未操作正式訂單。測試驗證合成文字、音色參數與流程，無法取代實體工作站的發音／聲線試聽。
- 本次 checkout：`/Users/moztecheason/Documents/moztech-wms-voice-pronunciation-20260916`，分支 `codex/wms-voice-pronunciation-20260916`，基準 `a957002496811846657bf4708227a185015509c3`。

## 部署

- 程式提交：`aa82ab30cba9181371f5e677174b51053089817e`。
- GitHub 程式 CI：`35093518749` 成功（包含後端 165 項、前端 120 項及 production build）。
- Cloud Build：`e3d13eb9-7bd3-41ad-bce5-7da82948fee7` 成功，只重建前端。
- 前端 image：`asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-frontend@sha256:90d518ed2749d6419f390f8eaa99e0e94c6c883ab91f24d71f248c2ab137480a`。
- 後端保留 `sha256:9396397d5be2ffe27999921880b9232f2f9c6a0ff6d4eaad7facd8393f665bbd`。
- 新 revision：`corely-wms-voice-clear-20260916`，先以 `voice-clear-candidate` 0% 標籤確認健康、就緒、未登入 API 拒絕及候選前端 16 個合成資料瀏覽器檢查，再切換 100% 並讀回確認。
- 正式 https://wms.corely.cc 及 https://corely-wms-249593319772.asia-east1.run.app 的健康、就緒、登入、未登入 API 邊界通過；entry、VoiceControls、OrderWorkView 資源雜湊與候選一致。
- 使用者已登入的正式設定頁重新載入後，兩階段均顯示舊語音不可用、改用「美佳」，候選清單僅有台灣中文原聲；既有語音關閉偏好保留。實體聽音驗收仍待使用者試聽，不能把畫面／合成參數檢查當作發音已被人工確認。
- 程式回退 revision：`corely-wms-voice-import-20260916`；需要時將 `moztech-main-db / asia-east1 / corely-wms` 的流量切回此版本，不還原資料庫。前一版本會恢復問題音色選項與變調行為。

正式服務僅前端 image 改變，後端、IAM、資料庫／附件連線及設定保持相同。共用 `corely-wms-migration-validation` 屬另一工作分支，spec 與 traffic 均未變；本次使用隔離本機與正式 0% 候選的合成 UI 驗證，未覆蓋共用驗收服務。

本機完整驗證與發布證據位於協作目錄 `artifacts/wms-voice-pronunciation-20260916/`（不含正式憑證／資料庫資料，不是 Git 原始碼的一部分）。此文件的發布結果將另以純文件提交同步 GitHub main，程式碼與上述已建置提交一致。
