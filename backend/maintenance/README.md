# 資料保留維運指南

本指南提供三種觸發資料清理的方式：

1) GitHub Actions 夜間排程（雲端 Runner 執行）
- 位置：`.github/workflows/db-retention.yml`
- 需求：在 Repository 設定 `secrets.DATABASE_URL`；若資料庫有 IP 白名單限制，需允許 GitHub Runner 出口 IP 或改用伺服器端排程。
- 調整排程：目前為每日台北時間 03:00（UTC 19:00），可修改 cron。

2) 伺服器端 PM2/Cron
- PM2 範例：`backend/maintenance/ecosystem.config.js`
- 啟動指令（於 server 上）：
  ```bash
  cd /path/to/repo/backend
  # 設定環境變數（建議使用更安全的方式，例如系統層或 dotenv 管理）
  export DATABASE_URL="postgres://user:pass@host:5432/db"
  pm2 start maintenance/ecosystem.config.js --only wms-retention
  ```
- 系統 Cron 每日執行一次（推薦）：
  ```bash
  # 每日 03:00 執行
  0 3 * * * cd /path/to/repo && DATABASE_URL="postgres://..." npm --prefix backend run retention:prod >> /var/log/wms-retention.log 2>&1
  ```

3) Admin-only API 手動觸發
- 端點：`POST /api/admin/maintenance/retention`
- 權限：需 Bearer JWT，且使用者 `role=admin`
- 可選參數（JSON body）：
  - `logsDays`、`mentionsDays`、`readsDays`、`idleMinutes`（覆寫預設保留期間）
- 範例：
  ```bash
  curl -X POST https://<api-host>/api/admin/maintenance/retention \
    -H "Authorization: Bearer <JWT>" \
    -H "Content-Type: application/json" \
    -d '{"logsDays":180,"mentionsDays":30,"readsDays":90,"idleMinutes":10}'
  ```

## 預設保留期間（可透過環境變數調整）
- `RETENTION_LOGS_DAYS`（預設 180）
- `RETENTION_MENTIONS_DAYS`（預設 30）
- `RETENTION_READS_DAYS`（預設 90）
- `RETENTION_IDLE_MINUTES`（預設 10）

> 安全性注意：
> - 不要把真實 `DATABASE_URL` 寫入 repo；請用 secrets 或主機環境變數設定。
> - 若採用 GitHub Actions 連雲端資料庫，需確認允許外部連線與 SSL。
