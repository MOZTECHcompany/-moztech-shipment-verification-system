# 變更紀錄（2025-12-15）

本文件整理本次工作階段的主要功能/修正變更，聚焦於：資安加固、最高管理員（superadmin）治理、以及前端 UI/UX 一致性。

## 覆蓋範圍（commits）

此紀錄以以下 commit 區間為主（由舊到新）：

- cfd9b75 加強資安2
- 6a6927f 資安加強3
- 4ab7999 新增資安
- fed846a UIUX
- 0043d18 最高管理員
- a9e2047 SUPERADMIN
- e23c459 12344

> 備註：上述 commits 亦包含部分自動產生的檔案（coverage report）與依賴檔案變動（node_modules/package-lock）。本文件會優先記錄「實際影響功能/行為」的改動。

---

## Backend（API）

### 1) 啟動/部署安全性

- **Production 啟用 trust proxy**：在反向代理（如 Render）環境下，讓 `req.ip` 等資訊能正確取用 client IP。
- **強制要求 JWT_SECRET**：非 `test` 環境若缺少 `JWT_SECRET` 會拒絕啟動，避免 Token 驗證/簽發行為落入不安全狀態。

涉及檔案：
- `backend/src/app.js`

### 2) RBAC 權限模型：新增 superadmin 並視同 admin（管理能力）

- `authorizeAdmin`：允許 `admin` 或 `superadmin`。
- `authorizeRoles`：`superadmin` 直接放行 role-based 端點（細部的 superadmin-only 仍由各路由再限制）。
- 新增 `authorizeSuperAdmin`：提供「只有最高管理員才可用」的中介層。

涉及檔案：
- `backend/src/middleware/auth.js`

### 3) Superadmin 初始化（bootstrap）端點

新增管理端初始化流程：

- `POST /api/admin/bootstrap/superadmin`
  - 需要登入（由 `authenticateToken` 提供 `req.user`）。
  - 需要提供 `SUPERADMIN_BOOTSTRAP_SECRET`（可由 header 或 body 傳入）。
  - 限制：資料庫目前不可已有 `superadmin`（避免二次初始化）。
  - 會把「呼叫者本人」升級為 `superadmin`，並回傳新的 `accessToken`（避免使用者還要重新登入）。

CORS 同步允許 bootstrap 相關 header：
- `X-Superadmin-Bootstrap`
- `X-Superadmin-Bootstrap-Secret`

涉及檔案：
- `backend/src/routes/adminRoutes.js`
- `backend/src/app.js`

### 4) 使用者治理：只有 superadmin 可建立/指派 admin；admin 不可動 superadmin

- 建立使用者：當 `role` 是 `admin/superadmin` 時，只有 `superadmin` 可建立。
- 更新使用者：
  - admin 不可編輯 `superadmin` 帳號。
  - 只有 superadmin 可把別人升/降為 `admin/superadmin`。
- 刪除使用者：admin 不可刪除 `superadmin`。

涉及檔案：
- `backend/src/routes/userRoutes.js`
- `backend/src/routes/adminRoutes.js`（legacy create-user 的兼容端點也套用相同規則）

### 5) 任務/訂單資料層：superadmin 視同 admin，避免看不到資料

- `/api/tasks`、`/api/tasks/completed`：以 `effectiveRole = (role === 'superadmin' ? 'admin' : role)` 查詢，確保 superadmin 可看到完整任務清單（避免 UI 全 0）。
- 訂單端點：使用 `isAdminLike = role === 'admin' || role === 'superadmin'` 放行批次認領/更新等管理操作。

涉及檔案：
- `backend/src/routes/taskRoutes.js`
- `backend/src/routes/orderRoutes.js`

### 6) xlsx 高風險套件：縮小攻擊面（無檔案大小限制）

由於上游套件弱點沒有可直接升級的修補版，本次採「降低攻擊面」：

- 匯入上傳白名單：只允許 `.xlsx/.xls/.csv`（並比對常見 MIME type）。
- 匯入端點限流：以登入使用者為 key（優先 userId）做 rate limit，避免同 IP 互相影響。
- 不加檔案大小限制（依需求保留），僅限制一次 1 個檔案。

涉及檔案：
- `backend/src/routes/orderRoutes.js`

---

## Frontend（Web）

### 1) superadmin 視同 admin：路由與 UI 放行

- 登入後導向：`admin/superadmin` 進管理區。
- 管理中心/任務/訂單/留言等多處 UI 判斷，將 `role === 'admin'` 擴為 `role === 'admin' || role === 'superadmin'`。

涉及檔案：
- `frontend/src/App.jsx`
- `frontend/src/components/LoginPage.jsx`
- `frontend/src/components/TaskDashboard.jsx`
- `frontend/src/components/TaskDashboard-with-batch.jsx`
- `frontend/src/components/OrderWorkView.jsx`
- `frontend/src/components/TaskComments.jsx`
- `frontend/src/components/TaskComments-modern.jsx`

### 2) 使用者管理：UI 也同步套用治理規則 + 角色顏色區分

- 非 superadmin：不顯示/不可建立或指派 `admin`。
- admin 不可編輯/刪除 `superadmin`。
- Badge 顏色區隔（依設計系統 variants）：
  - superadmin：danger（紅）
  - admin：warning（琥珀）
  - dispatcher：info（藍）
  - picker：purple（紫）
  - packer：success（綠）

涉及檔案：
- `frontend/src/components/admin/UserManagement.jsx`

### 3) UI/UX 一致性：Analytics 風格對齊

- 調整「數據分析」頁版型、Header actions、loading skeleton、卡片視覺，使其更接近「刷錯分析」的頁面風格與結構。

涉及檔案：
- `frontend/src/components/admin/Analytics.jsx`

### 4) 通知/音效初始化：避免瀏覽器自動播放限制警告

- 音效 AudioContext 改為「使用者互動後」才初始化/恢復，降低瀏覽器自動播放政策導致的警告與失效風險。

涉及檔案：
- `frontend/src/utils/soundNotification.js`

---

## 非功能性變更（注意事項）

本次 commits 中包含大量以下類型檔案變動：

- `backend/coverage/**`（測試覆蓋率報告）
- `backend/node_modules/**`（依賴安裝產物）

若你希望 repo 更乾淨、減少 PR 噪音，通常會建議：
- coverage 與 node_modules 不要提交到版本庫（改由 `.gitignore` 忽略）

（本文件僅負責記錄現況變更，未在此額外調整版控策略。）

---

## 部署/操作提醒

- 需要環境變數：
  - `JWT_SECRET`：非 test 必填
  - `SUPERADMIN_BOOTSTRAP_SECRET`：只在初始化 superadmin 時需要（建議用完移除或輪替）
- API 與前端是不同網域：
  - 前端：`moztech-shipment-verification-system.onrender.com`
  - API：`moztech-wms-api.onrender.com`

