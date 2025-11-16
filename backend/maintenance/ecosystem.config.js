// backend/maintenance/ecosystem.config.js
// PM2 例項設定：每日排程可由系統 cron 觸發此進程，或直接長駐亦可

module.exports = {
  apps: [
    {
      name: 'wms-retention',
      cwd: __dirname + '/../',
      script: 'npm',
      args: 'run retention:prod',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production'
        // 建議在系統環境或 PM2 ecosystem 外部設定 DATABASE_URL，以免洩漏
        // DATABASE_URL: 'postgres://user:pass@host:5432/db' 
      },
      time: true,
      max_memory_restart: '200M'
    }
  ]
};
