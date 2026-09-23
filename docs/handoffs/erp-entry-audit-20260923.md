# ERP 統一入口與日誌修補

基底 1ee777e，獨立分支 codex/wms-entry-audit-20260923。

改動：ERP 管理員和唯讀報表入口、伺服器固定目的頁面、ERP-only 登入開關（預設關閉；本次只在 DEV 開啟）、簡化返回營運系統入口、桌面側欄尊重使用者收合；日誌僅透過權限 API 查詢、新紀錄保存當時操作者快照。

驗證：284 backend unit、272 frontend tests、frontend build、7 個 PostgreSQL 快照／rollback assertions；ERP/WMS 55 個跨系統 PostgreSQL assertions。

未完成：此提交尚未部署；全公司中央日誌與完整模組事件收集仍為後續階段，ERP docs/plans/company-operation-audit.md 有具體規劃。實體掃碼／工廠驗收不屬本次登入驗證。

## DEV 已部署

API image source `dd69666`，web image source `92f49ff`；服務 `corely-wms-dev-entry-audit2-0923` 接收 100% DEV 流量。ERP 配套 runtime source `fa04a2bd`。DEV 已套 `035_erp_portal_audit.sql`，ERP-only 模式已開；production 未改。

另修正多分頁登入狀態：憑證用 sessionStorage，handoff 完成前不建立舊身分 socket。全部 API、批次列印及操作身分檢查同步改用分頁憑證；舊揀貨分頁失效不會覆寫新裝箱分頁登入。Frontend 測試更新為 274 項通過。

驗證收據由 ERP 協調區 `artifacts/wms-entry-audit-20260923/release-receipt.json` 保存，包括实际 DEV API 43 個 assertions、4 個管理入口／書籤場景和多分頁驗證。原始 cloud config 及測試憑證未提交。

回滾須協調 ERP 配套：WMS 前一整合版本 `corely-wms-dev-account-sso-0923`；僅回退分頁修正可回 `corely-wms-dev-entry-audit-0923`。新增快照資料保留，不刪除 migration。
