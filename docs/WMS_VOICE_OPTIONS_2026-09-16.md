# 恢復揀貨／裝箱語音選項（2026-09-16）

## 更正

前一版 `aa82ab3` 把「問題音色」處理成只有台灣中文可選，並把同名台灣音色一併排除，造成使用者只剩「美佳」。這是程式篩選造成的退化，不能解讀為裝置只安裝一種語音。使用者要求恢復其他選項，本版取代 `WMS_VOICE_PRONUNCIATION_2026-09-16.md` 的音色限制。

- 恢復裝置提供的所有 `zh-*`／`cmn-*` 中文音色，台灣中文排序優先。同名的台灣音色不受中國大陸音色的回報影響。
- 揀貨、裝箱各自選擇，試聽及真實播報都使用所選音色，選擇重新整理後保留；先前暫不可用的儲存選擇會恢復。
- 使用者截圖中的九種 zh-CN 音色：Eddy、Flo、Grandma、Grandpa、Reed、Rocko、Sandy、Shelley、婷婷，只加註「發音待確認」，可手動選擇及試聽。自動模式跳過這些特定名稱與語系組合；沒有擴大成封鎖所有 CN 或同名 TW 音色。
- 自動模式依已知男女聲名稱優先，未找到時儘量選不同音色。這是選擇偏好，不是對未知音色性別或實際發音品質的保證。
- 保留語音開關、原聲音調、短數量、揀貨同音字播報、完成提示優先、掃碼錯誤恢復。沒有可自動選用的音色時明示需手動選擇，不假裝播報成功。

## 驗證與界線

- 隔離 checkout：`/Users/moztecheason/Documents/moztech-wms-voice-options-20260916`；分支 `codex/wms-voice-options-20260916`；基準 `8d1a000a208c6599b14882d45379d4c436872af3`。
- 前端 122 項測試及 production build 通過，涵蓋完整音色清單、僅標記指定 CN 音色、TW/CN/HK 手動播報、兩階段不同音色、自動迴避回報音色、缺少音色、靜音與完成提示等。
- 1280／390 px 揀貨／裝箱合成流程共 20 個瀏覽器檢查通過：刷錯重刷、數量／完成提示、18 種測試裝置音色可選、9 種 CN 標記、不同 TW 試聽、重新整理保留、手動選擇已回報音色與自動模式分聲。所有業務 API、Socket 都攔截，沒有使用正式訂單驗收。
- 自動化驗證合成引擎收到的文字與音色參數；真實發音是否清楚仍由工作站試聽確認。
- 此次只更新前端；後端、資料庫、附件、角色與操作流程不變。共用驗收服務屬其他工作分支，使用隔離本機與 0% 候選驗證，不覆蓋共用服務。

## 部署

- 程式提交：`5a8a06f8813845bb93aca9f16ecb6ebbd448b765`。
- GitHub 程式 CI：`35095681770` 成功（前後端測試及 production build）。
- Cloud Build：`4a4cc015-8c9f-4647-b329-5f405b9cf60c` 成功。
- 前端 image：`asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-frontend@sha256:b813fd92e667c99798f336e06c0d1981e1ce034410398d8ab4861299a906235d`。
- 正式 revision：`corely-wms-voice-options-20260916`。先以 `voice-options-candidate` 0% 完成健康／就緒／未登入權限邊界及 20 個候選前端合成流程檢查，再切換 100% 並讀回確認。
- https://wms.corely.cc 與 https://corely-wms-249593319772.asia-east1.run.app 的健康／就緒／登入／未登入 API 邊界通過，entry、VoiceControls、OrderWorkView 資源雜湊與候選一致。
- 使用者已登入設定頁重新載入後，兩個選單各有 18 種中文音色（加自動選項）；9 種 CN 音色標示「發音待確認」。當時揀貨保留手動「美佳」，裝箱保留自動偏好並選到「Eddy（台灣）」，語音關閉偏好不變。此為 UI／配置確認，不是實體發音驗收。
- 只有前端 image 改變；後端仍為 `sha256:9396397d5be2ffe27999921880b9232f2f9c6a0ff6d4eaad7facd8393f665bbd`，其餘容器配置、IAM 及共用驗收服務 spec／traffic 均保持相同。
- 回退基準為 `corely-wms-voice-clear-20260916`，但該版本會再次限制語音選項，不應為一般語音偏好問題回退。若需程式回退，只切 `moztech-main-db / asia-east1 / corely-wms` 流量，不回復舊資料庫。

本機發布證據位於協作目錄 `artifacts/wms-voice-options-20260916/`；發布紀錄另以純文件提交同步 GitHub main，前後端程式與上述建置提交一致。
