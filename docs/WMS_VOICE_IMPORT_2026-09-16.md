# 掃碼語音與條碼匯入防護（2026-09-16）

## 行為

- 每次伺服器確認掃碼成功後，播報「揀貨 3，剩 2」或「裝箱 3，剩 2」，不播報人名。
- 伺服器確認該階段狀態轉為 `picked`／`completed` 後，於返回工作台前播報「揀貨任務完成」／「裝箱任務完成」。僅剩餘數量為零不代表流程完成；HTTP 與 Socket 的同次完成事件去重。
- 保留 Web Speech、語音開關及個人掃碼音效。完成播報期間，新任務通知不會中斷它；其後掃碼僅保留最新一則，避免排隊播報過時數量。音訊裝置失敗不影響伺服器已確認的掃碼結果。
- 設定頁與掃碼區提供揀貨／裝箱各自的中文語音選擇及試聽。自動選擇女聲／男聲優先；API 無性別欄位，使用已知語音名稱偏好及人工試聽，不保證所有裝置有男女兩種聲音。只有相同聲音時使用高低音調，畫面明確說明。選擇記於此瀏覽器，保留既有靜音偏好。
- 匯入前拒絕條碼科學記號、小數、千分位、數值精度風險及公式。錯誤回傳 `IMPORT_NOT_APPLIED`、`reason=INVALID_BARCODE_FORMAT` 及工作表／列／儲存格位置。保留英數品項編碼及文字前置零，不強制套用 EAN 長度或檢查碼規則。
- 有問題的整份匯入不取得資料庫連線、不建立訂單／品項／SN、不發出新任務事件。UI 顯示異常通知與持續可讀的錯誤位置，允許修正檔案後重新選擇。
- 本次提供的 Excel 問題出於 `理貨單!A13`：底層數字完整，但 General 顯示成科學記號。攔下並提供檔案儲存值供核對，不猜碼或自動套用。原始工作簿未修改，也未寫入 Git。僅在記憶體將該格改成文字的對照測試可完整解析 8 個品項、1,040 件、1,040 筆 SN；未儲存／匯入該對照檔。

## 驗證

- 前端 116 項測試；後端 165 項單元測試；Vite production build。
- 本機隔離 PostgreSQL 35 項 HTTP／Socket／瀏覽器回歸：500 次揀貨＋500 次裝箱、SN／新品不良換碼、訂單異動與例外審核、留言與釘選、權限、報表、列印及附件等既有路徑；本次新增錯誤格式匯入前後資料表筆數不變驗證。
- 1280／390 px 瀏覽器測試：刷錯重刷、正確數量、完成播報、返回工作台、男女語音路由、選擇持久化、相同語音備援、原始 Excel 異常呈現。
- 語音合成呼叫及畫面由自動化驗證；實體裝置音量、聲線及現場辨識需在各工作站「試聽」確認。
- 首次 PostgreSQL browser harness 缺少 output 參數，補齊後首次 Vite 依賴預建造成 Analytics 動態模組載入失敗；完成預建後完整重跑 35 項通過。非正式資料庫問題。

## 發布

發版前基準：GitHub `main` 為 `32e697ad763ccf7eab26eb9d2600979e3c5b908c`；正式 `corely-wms-chat-time-20260916` 接收 100%。

- 程式提交：`66744277ca2e7a23a56b1b40bb9f0fb9b6c5ee48`；隔離分支 `codex/wms-voice-import-20260916`。
- Cloud Build：`d3392d4c-a3b9-401d-b393-afc4d4590e8e`（成功）。
- 前端 digest：`sha256:a941f2a9dc0ea6156161cfd287fd3b96ec336907ba8c6ec725cf75f717dc51b5`。
- 後端 digest：`sha256:9396397d5be2ffe27999921880b9232f2f9c6a0ff6d4eaad7facd8393f665bbd`。
- 候選 `corely-wms-voice-import-20260916` 在 0% 流量完成健康／就緒／未登入拒絕及真實前端的合成資料 UI 驗證，再切換 100% 並讀回確認。
- 正式入口：https://wms.corely.cc ；直接網址：https://corely-wms-249593319772.asia-east1.run.app 。
- GitHub 程式 CI：`35086550210`（成功）；發布紀錄另以文件提交同步 main。
- 程式回退版本：`corely-wms-chat-time-20260916`。必要時將 `corely-wms` 在 `moztech-main-db / asia-east1` 的流量切回該 revision；不回復舊資料庫 dump。舊版不具本次條碼匯入攔截，回退後應暫緩匯入有問題的 Excel。

後端只有匯入輸入驗證與錯誤回傳調整，無 migration／資料回填。正式資料庫與附件、IAM、Socket 設定及舊服務保持既有配置。共用 private validation 目前屬另一工作分支，未覆蓋；使用隔離本機完整驗收、正式 0% 候選的健康／權限邊界檢查及候選真實前端搭配攔截 API 的合成瀏覽器驗證。

參考：[Web Speech voice properties](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice)、[裝置可用語音](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices)、[Microsoft 中文語音列表](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)。
