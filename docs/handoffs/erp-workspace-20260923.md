# ERP employee work sessions / 2026-09-23

- Based on the currently deployed WMS `16d7668`; implementation `eca381b` in isolated `codex/wms-workspace-20260923`. Original unified-return checkout unchanged.
- ERP entry supports picking/packing scoped sessions without a second login. Every HTTP request rechecks ERP account/company/current permission, Socket sessions recheck every 60 seconds. No browser URL contains credentials or tickets.
- Staff identity table migration `034_erp_staff_identity.sql` applied only to DEV. Explicit legacy picker/packer binding preserves numeric IDs, rejects conflicting rebinds and disables old password/token login for bound accounts. Unbound WMS accounts keep existing authentication.
- Announcements embedded in TaskDashboard, personal self-service/role-switch links return to ERP, and leaving work revokes the WMS work session. Existing warehouse order/scan/claim/batch logic retained.
- DEV `corely-wms-dev-workspace-0923` Ready / 100% traffic. Build `d46440c2-dc7d-4714-a03e-99444156af84`. 280 backend / 272 frontend tests, full frontend build, live API and isolated-browser picking/packing handoffs passed.
- All QA ERP accounts disabled and sessions revoked. No real order claims/scans/imports or existing employee permission changes. Production unchanged. No GitHub push/merge.
- Full cross-repository handoff and receipt: `/Users/moztecheason/ecom-warehouse-workspace-20260923/docs/handoffs/warehouse-workspace-20260923.md` and `warehouse-workspace-release-20260923.json`.
- Before real staff use, assign ERP role/company and explicitly link old WMS identities through ERP account administration. Management-report SSO and a fine-grained supervisor role are outside this employee-session release; physical warehouse acceptance remains separate.
