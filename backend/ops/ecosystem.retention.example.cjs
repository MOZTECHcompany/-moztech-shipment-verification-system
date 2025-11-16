module.exports = {
  apps: [
    {
      name: 'wms-retention',
      script: 'src/maintenance/retention.js',
      cwd: __dirname + '/../',
      node_args: '',
      autorestart: false, // 單次任務，不需常駐
      watch: false,
      env: {
        NODE_ENV: 'production',
        // 建議在伺服器系統層設定 DATABASE_URL 環境變數
        // DATABASE_URL: 'postgres://...'
        RETENTION_LOGS_DAYS: '180',
        RETENTION_MENTIONS_DAYS: '30',
        RETENTION_READS_DAYS: '90',
        RETENTION_IDLE_MINUTES: '10'
      },
      cron_restart: '0 3 * * *', // 每日 03:00 觸發一次
      time: true,
      max_memory_restart: '200M'
    }
  ]
};
