# 資料保留清理 - Cron / PM2 示例

以下提供兩種排程方式：

## 1) Linux Cron（建議簡單穩定）

每日 03:00（本機時區）執行一次：

```
0 3 * * * cd /path/to/-moztech-shipment-verification-system && NODE_ENV=production DATABASE_URL="postgres://..." npm --prefix backend run retention
```

說明：
- 使用 `NODE_ENV=production` 讓 `pg` 以 SSL 連線雲端 DB。
- 也可改為 `npm --prefix backend run retention:prod`（等效）。
- 建議將 `DATABASE_URL` 放在 `/etc/environment` 或以 `systemd` EnvironmentFile 管理。

## 2) PM2（以 cron_restart 觸發）

建立一份 PM2 設定（見 `ecosystem.retention.example.cjs`），重點為：
- 腳本：`src/maintenance/retention.js`
- `autorestart: false`（避免常駐）
- `cron_restart: '0 3 * * *'`（每日 03:00 觸發一次重啟即執行）

啟用：

```
pm2 start backend/ops/ecosystem.retention.example.cjs --only wms-retention
pm2 save
pm2 list
```

查看輸出：

```
pm2 logs wms-retention --lines 200
```
