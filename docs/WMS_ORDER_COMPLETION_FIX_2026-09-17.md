# 訂單異動後揀貨完成判定修復（2026-09-17）

## 問題與修正

核可訂單異動時，原程式一律將訂單設為 `picking`。若最後未揀的品項被核可刪除，剩餘品項雖已全數揀完，唯讀 `/work-snapshot` 仍顯示揀貨中；重掃已揀 SN 會被正確拒絕，不能推動狀態。

`applyOrderChangeProposal` 現在在原 transaction／order row lock 內，重新讀取異動後品項與 SN，以共用 `getOrderCompletion` 判定：全部揀完為 `picked`（待裝箱），否則 `picking`。一般審核與管理員自拋單直接核可共用此流程及既有協作通知。核可異動本身不直接宣告出貨完成。

## 既存訂單的修復指令

`POST /api/orders/:orderId/reconcile-picking`，限已登入 admin／superadmin。Body：

```json
{ "expectedState": "work-snapshot 回傳的 64 位 stateToken", "reason": "修復原因" }
```

- 使用 row lock 與目前狀態 token 核對；狀態已改變、未完成數量、SN 缺漏、空單或未核可異常均拒絕。
- 只允許 `picking → picked`；已 `picked` 且 token 相符時不重複寫入。不能改寫 `packing`、`completed`、`voided` 或未認領訂單。
- 只更新訂單狀態／更新時間，不修改品項數量、掃碼紀錄、SN、揀貨員或裝箱員。
- `picking_completion_reconcile` 操作日誌和狀態在同一 transaction 寫入；稽核失敗則全部 rollback。提交成功後才廣播狀態及操作日誌。
- 此指令不會批次修復其他訂單，GET `/work-snapshot` 保持唯讀。

## 驗證與發布邊界

- 後端單元測試：20 suites／165 tests 通過。
- 隔離 PostgreSQL、真實 HTTP 與 Socket：30 tests 通過，含 1040 筆已揀 SN 加 300 張未揀保固卡的完整重現、管理員直接核可、未完成／缺 SN／空單／終態防護、重複與並行指令、稽核失敗 rollback、裝箱認領與掃碼。
- 既有 500 次揀貨＋500 次裝箱流程及舊版功能 API 覆蓋通過。這些是本機隔離驗證，不等同現場掃描槍或物流列印驗收。
- 此次無 schema migration、前端或語音修改。發布僅替換正式服務的 backend image，保留 frontend、IAM、Cloud SQL、附件及其他服務設定。
- 程式回復：將流量轉回前版 `corely-wms-voice-options-20260916`。已確認完成揀貨的訂單不應因程式回復而被退回揀貨中；不要還原整庫覆蓋新作業紀錄。

正式部署與單筆修復結果於執行後補記。
