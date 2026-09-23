# ERP 統一入口與日誌修補

基底 1ee777e，獨立分支 codex/wms-entry-audit-20260923。

改動：ERP 管理員和唯讀報表入口、伺服器固定目的頁面、ERP-only 登入開關（預設關閉；本次只在 DEV 開啟）、簡化返回營運系統入口、桌面側欄尊重使用者收合；日誌僅透過權限 API 查詢、新紀錄保存當時操作者快照。

驗證：284 backend unit、272 frontend tests、frontend build、7 個 PostgreSQL 快照／rollback assertions；ERP/WMS 55 個跨系統 PostgreSQL assertions。

未完成：此提交尚未部署；全公司中央日誌與完整模組事件收集仍為後續階段，ERP docs/plans/company-operation-audit.md 有具體規劃。實體掃碼／工廠驗收不屬本次登入驗證。
