# 🔧 評論系統 500 錯誤修復指南

## ❌ 問題描述

當您嘗試在任務討論中發送評論時，系統顯示以下錯誤：

```
輸入錯誤 - Request failed with status code 500
name: 'AxiosError', code: 'ERR_BAD_RESPONSE'
```

## 🔍 錯誤原因

**資料庫缺少 `priority` 欄位**

新版任務討論系統添加了優先級功能，需要在 `task_comments` 表中添加 `priority` 欄位。

後端 API 嘗試執行以下 SQL：
```sql
INSERT INTO task_comments (order_id, user_id, content, parent_id, priority)
VALUES (...)
```

但資料庫表結構中沒有 `priority` 欄位，導致 SQL 執行失敗。

---

## ✅ 解決方案

### 方法 1：使用遷移工具頁面（推薦）⭐

這是最簡單的方法，只需點擊按鈕即可完成。

#### 步驟：

1. **登入管理員帳號**
   - 訪問您的系統網址（例如：https://your-app.onrender.com）
   - 使用管理員帳號登入（role 為 'admin' 的帳號）

2. **訪問遷移工具頁面**
   - 在瀏覽器地址欄輸入：`https://your-app.onrender.com/migrate.html`
   - 或直接訪問：`/migrate.html`

3. **執行遷移**
   - 點擊「執行資料庫遷移」按鈕
   - 等待幾秒鐘
   - 看到「✅ 遷移完成」訊息

4. **測試功能**
   - 返回任務詳情頁面
   - 嘗試發送評論
   - 應該可以正常使用了！

---

### 方法 2：使用 API 手動執行

如果您熟悉 API 操作，可以直接調用遷移 API。

#### 使用 curl：

```bash
curl -X POST https://your-app.onrender.com/api/admin/migrate/add-priority \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

#### 使用 Postman 或瀏覽器開發者工具：

1. 打開開發者工具（F12）
2. 切換到 Console 分頁
3. 執行以下代碼：

```javascript
fetch('/api/admin/migrate/add-priority', {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
    }
})
.then(res => res.json())
.then(data => console.log(data))
.catch(err => console.error(err));
```

---

### 方法 3：直接修改資料庫（進階）

如果您有資料庫直接訪問權限，可以手動執行 SQL。

#### SQL 語句：

```sql
-- 添加 priority 欄位
ALTER TABLE task_comments 
ADD COLUMN priority VARCHAR(20) DEFAULT 'normal';

-- 添加檢查約束
ALTER TABLE task_comments 
ADD CONSTRAINT check_priority 
CHECK (priority IN ('normal', 'important', 'urgent'));

-- 創建索引（提升查詢效能）
CREATE INDEX idx_task_comments_priority ON task_comments(priority);
CREATE INDEX idx_task_comments_order_priority ON task_comments(order_id, priority);
```

---

## 🎯 遷移內容詳情

此遷移會對 `task_comments` 表進行以下修改：

| 操作 | 說明 |
|------|------|
| **添加欄位** | `priority VARCHAR(20) DEFAULT 'normal'` |
| **約束條件** | 只允許 'normal', 'important', 'urgent' 三個值 |
| **索引1** | `idx_task_comments_priority` - 優先級索引 |
| **索引2** | `idx_task_comments_order_priority` - 複合索引 |

**對現有資料的影響：**
- ✅ 現有評論不會丟失
- ✅ 現有評論的 priority 自動設為 'normal'
- ✅ 不會影響其他功能

---

## 🔐 權限要求

執行遷移需要**管理員權限**：

- 您的帳號 `role` 必須為 `'admin'`
- 或在資料庫中執行：
  ```sql
  UPDATE users SET role = 'admin' WHERE username = 'your_username';
  ```

---

## 📊 驗證遷移成功

遷移成功後，您會看到以下訊息之一：

### ✅ 成功訊息（首次執行）
```
遷移完成
評論總數: XX
您現在可以使用任務討論的優先級功能了！
```

### ℹ️ 已存在訊息（重複執行）
```
priority 欄位已存在，無需添加
系統已具備優先級功能，無需再次執行遷移。
```

---

## 🧪 測試評論功能

遷移完成後，測試以下功能：

1. **發送一般評論** 💬
   - 選擇「一般」優先級
   - 輸入評論內容
   - 點擊發送
   - ✅ 應該成功發送

2. **發送重要評論** ⭐
   - 選擇「重要」優先級
   - 輸入評論內容
   - 點擊發送
   - ✅ 評論應帶有黃色標記

3. **發送緊急評論** 🔴
   - 選擇「緊急」優先級
   - 輸入評論內容
   - 點擊發送
   - ✅ 評論應帶有紅色標記和邊框

4. **使用其他功能**
   - ✅ @ 提及同事
   - ✅ 回覆評論
   - ✅ 置頂評論
   - ✅ 搜尋評論
   - ✅ 快速回覆

---

## ❗ 常見問題

### Q1: 執行遷移後仍然報 500 錯誤？

**A:** 可能的原因：
1. 遷移未成功執行 → 檢查 result 區域的訊息
2. 瀏覽器緩存 → 清除緩存並重新載入頁面（Ctrl + Shift + R）
3. 後端未重啟 → 等待 Render 自動重新部署

### Q2: 顯示「未登入」錯誤？

**A:** 解決方法：
1. 先前往系統首頁登入
2. 確保使用管理員帳號
3. 登入成功後再訪問 `/migrate.html`

### Q3: 顯示「403 Forbidden」錯誤？

**A:** 您的帳號不是管理員，請聯繫系統管理員：
1. 將您的帳號設為管理員
2. 或請管理員執行遷移

### Q4: 能否多次執行遷移？

**A:** 可以，系統會自動檢測：
- 如果欄位已存在 → 跳過，不會重複添加
- 如果欄位不存在 → 執行遷移

### Q5: 遷移會影響正在使用的用戶嗎？

**A:** 不會，遷移操作：
- ✅ 不會鎖定表格
- ✅ 不會影響現有資料
- ✅ 執行時間極短（< 1秒）
- ✅ 不需要停機

---

## 🚀 部署後自動執行

如果您希望在每次部署後自動執行遷移，可以：

### Render.com 設定：

在 Render Dashboard 中設定 Build Command：

```bash
cd backend && npm install && node migrations/run.js
```

**注意：** 目前的 migration runner 可能有 trigger 衝突問題，建議暫時使用手動遷移方式。

---

## 📞 需要幫助？

如果以上方法都無法解決問題，請提供以下資訊：

1. **錯誤截圖**
   - 包含完整的錯誤訊息
   - 瀏覽器開發者工具的 Console 和 Network 分頁

2. **系統資訊**
   - 您的帳號名稱
   - 您的帳號角色（admin/user）
   - 瀏覽器版本

3. **操作步驟**
   - 您做了什麼操作
   - 預期結果是什麼
   - 實際發生了什麼

---

## 📝 技術細節

### 資料庫架構變更

**變更前：**
```sql
CREATE TABLE task_comments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    parent_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**變更後：**
```sql
CREATE TABLE task_comments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    parent_id INTEGER,
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),  -- 新增
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### API 端點

**POST /api/admin/migrate/add-priority**

需要管理員權限，執行資料庫遷移。

**Request:**
```http
POST /api/admin/migrate/add-priority
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Response (Success):**
```json
{
    "success": true,
    "message": "資料庫遷移成功",
    "totalComments": 42,
    "alreadyExists": false
}
```

**Response (Already Exists):**
```json
{
    "success": true,
    "message": "priority 欄位已存在，無需添加",
    "alreadyExists": true
}
```

---

## ✨ 功能恢復確認

遷移完成後，您應該能夠：

- ✅ 發送評論（無 500 錯誤）
- ✅ 選擇優先級（一般/重要/緊急）
- ✅ 使用快速回覆
- ✅ @ 提及同事
- ✅ 回覆評論
- ✅ 置頂評論
- ✅ 搜尋和篩選評論
- ✅ 查看未讀評論

---

**祝修復順利！如有任何問題，歡迎隨時回報。** 💪
