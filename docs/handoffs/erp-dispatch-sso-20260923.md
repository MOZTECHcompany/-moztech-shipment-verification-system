# ERP dispatch entry DEV release

- Runtime commit: `86550cc`; branch `codex/wms-dispatch-sso-20260923`.
- DEV revision: `corely-wms-dev-account-sso-0923`, 100% traffic.
- ERP release: `/Users/moztecheason/ecom-warehouse-account-sso-20260923/docs/handoffs/warehouse-account-sso-20260923.md`.
- Verified ERP click opens `/admin` without WMS login in a fresh browser context. Dispatcher scope requires ERP work-queue and dispatch permission. Numeric identity remains stable; replay, old work session and logout revocation checked. No WMS admin role escalation.
- Existing dispatcher accounts can be explicitly linked; name/email matching is never automatic. Picker/packer flows remain.
- Full WMS tests/build passed; 18 live handoff checks and 6 ERP/WMS browser scenarios passed. QA accounts disabled afterward; no real orders imported/claimed/shipped.
- No WMS migration. No push/main merge or production deployment. Production remains `corely-wms-import-footer-20260917`.
