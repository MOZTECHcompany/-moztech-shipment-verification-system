# WMS HTTP 路由索引

來源為固定版 `ab835f44ef2d9e855360aa6b01fb9216cd70afed`。路由從原始碼抽取，並與本機 Express 註冊表逐一比對。
共 138 筆註冊及 134 個不同 HTTP 方法＋路徑。實際 DEV 的 Node runtime 使用 `NODE_ENV=production`，以相同模式在本機驗證為 134 筆註冊、130 個不同方法＋路徑。開發工具的四個路由只在非 production 模式掛載。四個重複路徑保留兩筆登記，實際順序以路由檔為準。框架自動處理的 HEAD、CORS OPTIONS、靜態資產和 Socket.IO 由服務各自處理。

開發先讀 `03-WMS-API-與資料契約.md` 的轉檔、回匯與串接說明。以下的 request 欄位只列 handler 直接讀取的欄位。轉交給 service 的完整物件、間接欄位、參數驗證及 response schema 請依來源與契約章節。JSON 版本 `WMS-HTTP-路由索引.json` 另列源碼中直接可辨識的 response keys 和 HTTP status。

## 系統與檔案

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `GET /` | 見 handler | `source/backend/src/app.js:150` |
| `GET /health` | 見 handler | `source/backend/src/app.js:159` |
| `GET /ready` | 見 handler | `source/backend/src/app.js:163` |
| `GET /api/marketplace-files/:id/:kind` | 見 handler | `source/backend/src/app.js:182` |

## 身分

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `GET /api/auth/me` | 見 handler | `source/backend/src/routes/authRoutes.js:6` |
| `POST /api/auth/erp/staff` | `headers.x-erp-service-key` | `source/backend/src/routes/authRoutes.js:36`，`loginLimiter` |
| `POST /api/auth/erp/bind` | `headers.x-erp-service-key` | `source/backend/src/routes/authRoutes.js:36`，`loginLimiter` |
| `GET /api/auth/erp/config` | 見 handler | `source/backend/src/routes/authRoutes.js:44` |
| `POST /api/auth/erp/exchange` | `body.ticket, nonce` | `source/backend/src/routes/authRoutes.js:49`，`loginLimiter` |
| `POST /api/auth/erp/logout` | 見 handler | `source/backend/src/routes/authRoutes.js:55` |
| `POST /api/auth/login` | `body.username, password` | `source/backend/src/routes/authRoutes.js:66`，`loginLimiter` |
| `POST /api/auth/refresh` | `body.token` | `source/backend/src/routes/authRoutes.js:89`，`refreshLimiter` |

## 商城轉檔

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `GET /api/marketplace-intakes/store-connections` | 見 handler | `source/backend/src/routes/marketplaceRoutes.js:33` |
| `POST /api/marketplace-intakes/draft-overwrite/preview` | 見 handler | `source/backend/src/routes/marketplaceRoutes.js:36` |
| `POST /api/marketplace-intakes/draft-overwrite/confirm` | 見 handler | `source/backend/src/routes/marketplaceRoutes.js:36` |
| `POST /api/marketplace-intakes/preview` | 見 handler | `source/backend/src/routes/marketplaceRoutes.js:41` |
| `POST /api/marketplace-intakes/ready-preview` | `body.rows, settings, profileId, readyScopeFingerprint` | `source/backend/src/routes/marketplaceRoutes.js:46` |
| `POST /api/marketplace-intakes/barcode-confirmations` | `body.confirmation, verificationFingerprint` | `source/backend/src/routes/marketplaceRoutes.js:88` |
| `POST /api/marketplace-intakes/:id/orders/shipping-preview` | `body.orderNumber`<br>`params.id` | `source/backend/src/routes/marketplaceRoutes.js:128` |
| `POST /api/marketplace-intakes/:id/orders/shipping-update` | `body.orderNumber`<br>`params.id` | `source/backend/src/routes/marketplaceRoutes.js:128` |
| `GET /api/marketplace-intakes` | 見 handler | `source/backend/src/routes/marketplaceRoutes.js:133` |
| `GET /api/marketplace-intakes/:id` | `params.id` | `source/backend/src/routes/marketplaceRoutes.js:136` |
| `POST /api/marketplace-intakes/:id/download-link` | `body.kind`<br>`params.id` | `source/backend/src/routes/marketplaceRoutes.js:147` |
| `PATCH /api/marketplace-intakes/:id/archive` | `params.id` | `source/backend/src/routes/marketplaceRoutes.js:160` |
| `PATCH /api/marketplace-intakes/:id/restore` | `params.id` | `source/backend/src/routes/marketplaceRoutes.js:160` |
| `DELETE /api/marketplace-intakes/:id` | `params.id` | `source/backend/src/routes/marketplaceRoutes.js:160` |
| `POST /api/marketplace-intakes` | `body.previewFingerprint` | `source/backend/src/routes/marketplaceRoutes.js:164` |
| `GET /api/marketplace-intakes/store-profiles` | 見 handler | `source/backend/src/services/marketplaceStoreProfiles.js:32` |
| `POST /api/marketplace-intakes/store-profiles` | `body.platform, settings` | `source/backend/src/services/marketplaceStoreProfiles.js:36` |
| `POST /api/marketplace-products/resolve` | `body.skus` | `source/backend/src/services/marketplaceProductCatalog.js:88` |
| `GET /api/marketplace-batch-notices` | 見 handler | `source/backend/src/routes/marketplaceBatchNoticeRoutes.js:13` |
| `POST /api/marketplace-batch-notices/:noticeId/seen` | `params.noticeId` | `source/backend/src/routes/marketplaceBatchNoticeRoutes.js:14` |

## ECOUNT 回匯與預揀

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `GET /api/warehouse-intakes` | `query.ready` | `source/backend/src/routes/warehouseReleaseRoutes.js:22` |
| `GET /api/warehouse-intakes/staff` | 見 handler | `source/backend/src/routes/warehouseReleaseRoutes.js:31` |
| `GET /api/warehouse-intakes/receipt-format` | 見 handler | `source/backend/src/routes/warehouseReleaseRoutes.js:35` |
| `GET /api/warehouse-intakes/:id` | `params.id` | `source/backend/src/routes/warehouseReleaseRoutes.js:40` |
| `POST /api/warehouse-intakes/:id/:action` | `params.id, action` | `source/backend/src/routes/warehouseReleaseRoutes.js:47` |

## 箱號與 SN

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `GET /api/cartons` | 見 handler | `source/backend/src/routes/cartonRoutes.js:19` |
| `POST /api/cartons` | 見 handler | `source/backend/src/routes/cartonRoutes.js:20` |
| `POST /api/cartons/import` | 見 handler | `source/backend/src/routes/cartonRoutes.js:21` |
| `POST /api/cartons/seal-batch` | 見 handler | `source/backend/src/routes/cartonRoutes.js:22` |
| `GET /api/cartons/lookup` | `query.scanValue, matchSerialSubset` | `source/backend/src/routes/cartonRoutes.js:23` |
| `POST /api/cartons/allocations/:allocationId/release` | `params.allocationId` | `source/backend/src/routes/cartonRoutes.js:24` |
| `GET /api/cartons/:cartonId` | `params.cartonId` | `source/backend/src/routes/cartonRoutes.js:25` |
| `PATCH /api/cartons/:cartonId` | `params.cartonId` | `source/backend/src/routes/cartonRoutes.js:26` |
| `POST /api/cartons/:cartonId/seal` | `params.cartonId` | `source/backend/src/routes/cartonRoutes.js:27` |
| `POST /api/cartons/:cartonId/void` | `params.cartonId` | `source/backend/src/routes/cartonRoutes.js:28` |
| `POST /api/orders/:orderId/carton-preview` | `params.orderId` | `source/backend/src/routes/cartonRoutes.js:33` |
| `POST /api/orders/:orderId/carton-scan` | `params.orderId` | `source/backend/src/routes/cartonRoutes.js:34` |
| `GET /api/orders/:orderId/carton-shipments` | `params.orderId` | `source/backend/src/routes/cartonRoutes.js:35` |

## 綠界物流

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `GET /api/logistics/accounts` | 見 handler | `source/backend/src/routes/logisticsRoutes.js:22` |
| `POST /api/logistics/accounts/:accountId/query` | `params.accountId` | `source/backend/src/routes/logisticsRoutes.js:23` |
| `POST /api/logistics/accounts/:accountId/import` | `body.query, orderId`<br>`params.accountId` | `source/backend/src/routes/logisticsRoutes.js:28` |
| `GET /api/logistics/shipments` | `query.offset` | `source/backend/src/routes/logisticsRoutes.js:36` |
| `POST /api/logistics/shipments/print-form` | `body.shipmentIds` | `source/backend/src/routes/logisticsRoutes.js:43` |
| `POST /api/logistics/shipments/:id/sync` | `params.id` | `source/backend/src/routes/logisticsRoutes.js:51` |
| `POST /api/logistics-callbacks/ecpay/:accountId` | `params.accountId` | `source/backend/src/routes/logisticsRoutes.js:66` |

## 工作單、理貨匯入與掃碼

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `GET /api/order-change-notices` | 見 handler | `source/backend/src/routes/orderRoutes.js:27` |
| `POST /api/order-change-notices/:noticeId/acknowledge` | `params.noticeId` | `source/backend/src/routes/orderRoutes.js:38` |
| `GET /api/order-reviews` | 見 handler | `source/backend/src/routes/orderRoutes.js:49` |
| `GET /api/orders/:orderId/work-snapshot` | 見 handler | `source/backend/src/routes/orderRoutes.js:63` |
| `GET /api/order-import-batches/:batchId` | 見 handler | `source/backend/src/routes/orderRoutes.js:64` |
| `POST /api/orders/claim-by-barcode` | 見 handler | `source/backend/src/routes/orderRoutes.js:66` |
| `GET /api/orders/claim-commands/:commandId` | 見 handler | `source/backend/src/routes/orderRoutes.js:67` |
| `POST /api/orders/:orderId/reconcile-picking` | 見 handler | `source/backend/src/routes/orderRoutes.js:69`，`warehouseOnly`、`authorizeAdmin` |
| `POST /api/orders/batch-claim` | 見 handler | `source/backend/src/routes/orderRoutes.js:279`，`warehouseOnly` |
| `POST /api/orders/batch/claim` | 見 handler | `source/backend/src/routes/orderRoutes.js:280`，`warehouseOnly` |
| `POST /api/orders/:orderId/claim` | `params.orderId` | `source/backend/src/routes/orderRoutes.js:283`，`warehouseOnly` |
| `GET /api/orders/:orderId` | `params.orderId` | `source/backend/src/routes/orderRoutes.js:294` |
| `PATCH /api/orders/:orderId/void` | `body.reason`<br>`params.orderId` | `source/backend/src/routes/orderRoutes.js:379`，`warehouseOnly`、`authorizeAdmin` |
| `PATCH /api/orders/:orderId/urgent` | `body.isUrgent`<br>`params.orderId` | `source/backend/src/routes/orderRoutes.js:408`，`authorizeRoles('admin', 'dispatcher')` |
| `DELETE /api/orders/:orderId` | 見 handler | `source/backend/src/routes/orderRoutes.js:472`，`authorizeRoles('admin','dispatcher')` |
| `POST /api/orders/:orderId/deletion-requests` | 見 handler | `source/backend/src/routes/orderRoutes.js:473`，`authorizeRoles('admin','dispatcher')` |
| `POST /api/orders/import` | `body.marketplaceIntakeId`<br>`file.buffer` | `source/backend/src/routes/orderRoutes.js:477`，`authorizeRoles('admin', 'dispatcher')`、`importLimiter`、`uploadImport` |
| `POST /api/orders/update_item` | `body.orderId, scanValue, type, amount, orderItemId, expectedState` | `source/backend/src/routes/orderRoutes.js:609`，`warehouseOnly` |
| `POST /api/orders/batch/delete` | `body.orderIds, reason` | `source/backend/src/routes/orderRoutes.js:1082`，`authorizeAdmin` |
| `POST /api/orders/:orderId/defect` | `body.oldSn, newSn, reason`<br>`params.orderId` | `source/backend/src/routes/orderRoutes.js:1097`，`warehouseOnly`、`authorizeRoles('admin', 'dispatcher')` |
| `GET /api/admin/defects/stats` | 見 handler | `source/backend/src/routes/orderRoutes.js:1149`，`authorizeAdmin` |

## 工作單異常

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `POST /api/orders/:orderId/exceptions` | `body.type, reasonText, snapshot`<br>`params.orderId` | `source/backend/src/routes/exceptionRoutes.js:18` |
| `PATCH /api/orders/:orderId/exceptions/:exceptionId/ack` | 見 handler | `source/backend/src/routes/exceptionRoutes.js:26`，`warehouseOnly`、`authorizeAdmin`、`deletionReviewMiddleware(pool,'approve')` |
| `PATCH /api/orders/:orderId/exceptions/:exceptionId/reject` | 見 handler | `source/backend/src/routes/exceptionRoutes.js:27`，`warehouseOnly`、`authorizeAdmin`、`deletionReviewMiddleware(pool,'reject')` |
| `PATCH /api/orders/:orderId/exceptions/:exceptionId/propose` | 見 handler | `source/backend/src/routes/exceptionRoutes.js:28`，`deletionReviewMiddleware(pool)` |
| `GET /api/orders/:orderId/exceptions` | `query.status`<br>`params.orderId` | `source/backend/src/routes/exceptionRoutes.js:103` |
| `PATCH /api/orders/:orderId/exceptions/:exceptionId/reject` | `body.note`<br>`params.orderId, exceptionId` | `source/backend/src/routes/exceptionRoutes.js:164`，`warehouseOnly`、`authorizeAdmin` |
| `POST /api/orders/:orderId/exceptions` | `body.type, reasonCode, reasonText, orderItemId, instanceId, snapshot`<br>`params.orderId` | `source/backend/src/routes/exceptionRoutes.js:241` |
| `PATCH /api/orders/:orderId/exceptions/:exceptionId/propose` | `body.resolutionAction, note, newSn, correctBarcode`<br>`params.orderId, exceptionId` | `source/backend/src/routes/exceptionRoutes.js:442`，`authorizeRoles('admin', 'dispatcher')` |
| `PATCH /api/orders/:orderId/exceptions/:exceptionId/ack` | `body.note`<br>`params.orderId, exceptionId` | `source/backend/src/routes/exceptionRoutes.js:554`，`warehouseOnly`、`authorizeAdmin` |
| `PATCH /api/orders/:orderId/exceptions/:exceptionId/resolve` | `body.note, resolutionAction`<br>`params.orderId, exceptionId` | `source/backend/src/routes/exceptionRoutes.js:691`，`warehouseOnly`、`authorizeAdmin` |
| `GET /api/orders/:orderId/exceptions/:exceptionId/attachments` | `params.orderId, exceptionId` | `source/backend/src/routes/exceptionRoutes.js:717` |
| `GET /api/orders/:orderId/exceptions/:exceptionId/attachments/:attachmentId/download` | `query.inline`<br>`params.orderId, exceptionId, attachmentId` | `source/backend/src/routes/exceptionRoutes.js:745` |
| `POST /api/orders/:orderId/exceptions/:exceptionId/attachments` | `params.orderId, exceptionId` | `source/backend/src/routes/exceptionRoutes.js:773`，`attachmentUpload.array('files', 5)` |
| `GET /api/admin/exceptions` | `query.status, q, overdue, createdBy, ackBy, resolvedBy, type, orderStatus, page, limit` | `source/backend/src/routes/adminExceptionRoutes.js:26` |

## 帳號與管理

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `POST /api/admin/users` | `body.username, password, name, role, management_scope` | `source/backend/src/routes/userRoutes.js:17` |
| `GET /api/admin/users` | 見 handler | `source/backend/src/routes/userRoutes.js:52` |
| `GET /api/admin/users/:userId` | `params.userId` | `source/backend/src/routes/userRoutes.js:65` |
| `PUT /api/admin/users/:userId` | `body.name, role, password, management_scope`<br>`params.userId` | `source/backend/src/routes/userRoutes.js:81` |
| `DELETE /api/admin/users/:userId` | `params.userId` | `source/backend/src/routes/userRoutes.js:126` |
| `POST /api/admin/bootstrap/superadmin` | `body.secret, bootstrapSecret`<br>`headers.x-superadmin-bootstrap, x-superadmin-bootstrap-secret` | `source/backend/src/routes/adminRoutes.js:19`，`localMaintenanceOnly` |
| `POST /api/admin/create-user` | `body.username, password, name, role, management_scope` | `source/backend/src/routes/adminRoutes.js:75` |
| `POST /api/admin/maintenance/retention/run` | `body.logsDays, mentionsDays, readsDays, idleMinutes` | `source/backend/src/routes/adminRoutes.js:107`，`localMaintenanceOnly` |

## 任務與留言

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `GET /api/tasks` | `query.pagination` | `source/backend/src/routes/taskRoutes.js:12` |
| `GET /api/users/basic` | 見 handler | `source/backend/src/routes/taskRoutes.js:101` |
| `GET /api/tasks/completed` | `query.pagination, limit, date` | `source/backend/src/routes/taskRoutes.js:113` |
| `GET /api/tasks/:orderId/comments` | `query.after, before, latest, limit`<br>`params.orderId`<br>`headers.if-none-match` | `source/backend/src/routes/commentRoutes.js:31` |
| `POST /api/tasks/:orderId/comments/mark-read` | `body.commentIds`<br>`params.orderId` | `source/backend/src/routes/commentRoutes.js:115` |
| `POST /api/tasks/:orderId/comments` | `body.content, parent_id, priority`<br>`params.orderId` | `source/backend/src/routes/commentRoutes.js:143` |
| `PATCH /api/tasks/:orderId/comments/:commentId/retract` | `params.orderId, commentId` | `source/backend/src/routes/commentRoutes.js:247` |
| `PATCH /api/tasks/:orderId/mentions/:commentId/read` | `params.orderId, commentId` | `source/backend/src/routes/commentRoutes.js:272` |
| `POST /api/tasks/:orderId/comments/:commentId/read` | `params.orderId, commentId` | `source/backend/src/routes/commentRoutes.js:290` |
| `POST /api/tasks/:orderId/comments/mark-all-read` | `params.orderId` | `source/backend/src/routes/commentRoutes.js:314` |
| `GET /api/comments/unread-summary` | 見 handler | `source/backend/src/routes/commentRoutes.js:351` |
| `GET /api/tasks/:orderId/mentions` | `query.status, limit`<br>`params.orderId` | `source/backend/src/routes/commentRoutes.js:392` |
| `GET /api/tasks/pins` | 見 handler | `source/backend/src/routes/commentRoutes.js:437` |
| `PUT /api/tasks/pins/:orderId` | `body.pinned`<br>`params.orderId` | `source/backend/src/routes/commentRoutes.js:452`，`authorizeRoles('admin', 'dispatcher')` |
| `GET /api/tasks/:orderId/pins` | `params.orderId` | `source/backend/src/routes/commentRoutes.js:493` |
| `PUT /api/tasks/:orderId/pins/:commentId` | `body.pinned`<br>`params.orderId, commentId` | `source/backend/src/routes/commentRoutes.js:515` |
| `DELETE /api/tasks/:orderId/comments/:commentId` | `params.orderId, commentId` | `source/backend/src/routes/commentRoutes.js:534` |
| `POST /api/tasks/:orderId/session` | `body.session_type`<br>`params.orderId` | `source/backend/src/routes/commentRoutes.js:559` |
| `GET /api/tasks/:orderId/sessions` | `params.orderId` | `source/backend/src/routes/commentRoutes.js:598` |
| `POST /api/tasks/:orderId/transfer` | `params.orderId` | `source/backend/src/routes/commentRoutes.js:623`，`warehouseOnly` |

## 團隊看板

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `GET /api/team/channels` | 見 handler | `source/backend/src/routes/teamBoardRoutes.js:80` |
| `GET /api/team/posts` | `query.q, status, type, limit, page, channelId` | `source/backend/src/routes/teamBoardRoutes.js:91` |
| `POST /api/team/posts` | `body.postType, title, content, priority, dueAt, assigneeUserIds, channelId` | `source/backend/src/routes/teamBoardRoutes.js:165`，`authorizeRoles('admin', 'dispatcher')` |
| `GET /api/team/posts/:postId` | `params.postId` | `source/backend/src/routes/teamBoardRoutes.js:225` |
| `PATCH /api/team/posts/:postId/status` | `body.status`<br>`params.postId` | `source/backend/src/routes/teamBoardRoutes.js:297` |
| `POST /api/team/posts/:postId/comments` | `body.content`<br>`params.postId` | `source/backend/src/routes/teamBoardRoutes.js:330` |
| `GET /api/team/posts/:postId/attachments` | `params.postId` | `source/backend/src/routes/teamBoardRoutes.js:361` |
| `GET /api/team/posts/:postId/attachments/:attachmentId/download` | `query.inline`<br>`params.postId, attachmentId` | `source/backend/src/routes/teamBoardRoutes.js:382` |
| `POST /api/team/posts/:postId/attachments` | `params.postId` | `source/backend/src/routes/teamBoardRoutes.js:413`，`attachmentUpload.array('files', 5)` |

## 監控與報表

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `GET /api/operation-logs` | `query.orderId, userId, startDate, endDate, actionType, limit` | `source/backend/src/routes/analyticsRoutes.js:22`，`authorizeAdmin` |
| `GET /api/operation-logs/stats` | `query.startDate, endDate` | `source/backend/src/routes/analyticsRoutes.js:113`，`authorizeAdmin` |
| `GET /api/reports/export` | 見 handler | `source/backend/src/routes/analyticsRoutes.js:166`，`authorizeAdmin` |
| `GET /api/analytics` | `query.range` | `source/backend/src/routes/analyticsRoutes.js:169`，`authorizeAdmin` |
| `GET /api/scan-errors` | `query.startDate, endDate, limit` | `source/backend/src/routes/analyticsRoutes.js:256`，`authorizeAdmin` |

## 開發工具

| 方法與完整路徑 | 直接讀取的 request 欄位 | 註冊位置及額外授權 |
| --- | --- | --- |
| `POST /api/migrate/add-priority-test` | 見 handler | `source/backend/src/routes/maintenanceRoutes.js:11` |
| `POST /api/admin/migrate/add-priority` | 見 handler | `source/backend/src/routes/maintenanceRoutes.js:90`，`authorizeAdmin` |
| `GET /api/debug/tables` | 見 handler | `source/backend/src/routes/maintenanceRoutes.js:169` |
| `GET /api/debug/check-comment-reads` | 見 handler | `source/backend/src/routes/maintenanceRoutes.js:187` |

