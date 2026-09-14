# Corely AI 儲運管理系統

公司使用中的 WMS，涵蓋出貨單匯入、揀貨、裝箱、條碼／SN 核對、例外、新品不良異動、訂單協作與管理報表。

- 正式入口：https://wms.corely.cc
- **接手先讀：[CODEX_HANDOFF.md](CODEX_HANDOFF.md)**
- [雲端資源、登入與部署指引](docs/WMS_ENVIRONMENT_HANDOFF_2026-09-14.md)
- [GitHub 同步與原始碼版本說明](docs/WMS_GITHUB_SYNC_2026-09-14.md)
- [完整舊 WMS 功能比對](docs/WMS_FULL_PARITY_2026-09-14.md)
- [最新掃碼錯誤恢復與個人音效](docs/WMS_SCAN_RECOVERY_2026-09-14.md)

`main` 已接回 Cloud Run 維護線。舊版 `d4e2bff` 保留為歷史功能基準，不能拿來覆蓋現在的正式站。CI 只驗證測試與編譯；推送不會部署到公司 Cloud Run。

正式資料、附件、帳密與雲端金鑰不在本儲存庫。請用公司授權的 Google Cloud 身分取得必要權限，開發及驗收使用隔離資料庫。保留既有工作流程與權限；庫存目前只記錄，未啟用自動扣帳。
