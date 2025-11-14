# 緊急任務優先置頂功能

## 📋 功能概述

管理員現在可以在任務看板中將特定訂單標記為「緊急任務」，這些緊急訂單會自動置頂顯示，讓工作人員優先處理。

## 🎯 主要特性

1. **視覺化標記**
   - 緊急任務卡片有紅色邊框和脈動效果
   - 頂部有紅橙色漸變動畫條
   - 顯示火焰圖標 🔥 和「緊急」標籤

2. **自動排序**
   - 緊急任務自動排在列表最前面
   - 同樣緊急程度的任務按創建時間排序

3. **即時通知**
   - 當訂單被標記為緊急時，所有用戶即時收到通知
   - 任務列表自動重新排序

4. **權限控制**
   - 只有管理員可以設置/取消緊急標記
   - 所有角色都能看到緊急標記

## 🚀 安裝步驟

### 1. 執行資料庫遷移

```bash
cd backend/migrations
node run-004-urgent-flag.js
```

或者使用通用遷移腳本：

```bash
cd backend/migrations
node run.js
```

### 2. 重啟後端服務

```bash
cd backend
npm start
```

### 3. 重新編譯前端（如果需要）

```bash
cd frontend
npm run build
```

## 💡 使用方法

### 管理員操作

1. 登入管理員帳號
2. 進入任務看板頁面
3. 找到需要優先處理的訂單
4. 將滑鼠懸停在任務卡片上
5. 點擊右上角的 ⚠️ 警告圖標按鈕
6. 任務會立即被標記為緊急並置頂

### 取消緊急標記

- 再次點擊 ⚠️ 按鈕即可取消緊急標記
- 任務會回到正常排序位置

### 工作人員視角

- 緊急任務會自動顯示在列表頂部
- 有明顯的紅色視覺標記
- 收到即時通知提醒

## 🔧 技術實現

### 資料庫變更

- 在 `orders` 表新增 `is_urgent` 欄位（BOOLEAN，預設 FALSE）
- 新增索引以優化查詢效能

### API 端點

- `PATCH /api/orders/:orderId/urgent` - 設置/取消緊急狀態（僅管理員）
- `GET /api/tasks` - 已更新，支援緊急任務優先排序

### Socket.IO 事件

- `task_urgent_changed` - 廣播緊急狀態變更

## 📊 SQL 查詢範例

查詢所有緊急任務：

```sql
SELECT * FROM orders 
WHERE is_urgent = TRUE 
ORDER BY created_at DESC;
```

統計緊急任務數量：

```sql
SELECT 
    status,
    COUNT(*) as urgent_count
FROM orders
WHERE is_urgent = TRUE
GROUP BY status;
```

## 🎨 樣式說明

緊急任務的視覺效果：
- 紅色邊框（ring-2 ring-red-500）
- 紅色陰影（shadow-lg shadow-red-100）
- 頂部漸變動畫條（紅色→橙色→紅色）
- 火焰圖標標籤（Flame icon）
- 脈動動畫（animate-pulse）

## ⚙️ 設定檔案

### 修改的檔案清單

1. **後端**
   - `backend/migrations/004_add_urgent_flag.sql` - 資料庫遷移
   - `backend/migrations/run-004-urgent-flag.js` - 遷移執行腳本
   - `backend/index.js` - 新增 API 端點和查詢更新

2. **前端**
   - `frontend/src/components/TaskDashboard.jsx` - UI 更新

## 🐛 疑難排解

### 問題：看不到緊急按鈕

**解決方案**：
- 確認已登入管理員帳號
- 將滑鼠懸停在任務卡片上（按鈕預設隱藏）

### 問題：設置後沒有置頂

**解決方案**：
- 檢查資料庫遷移是否成功執行
- 確認後端 API 回應正常
- 重新整理頁面或重新登入

### 問題：其他用戶沒有收到通知

**解決方案**：
- 檢查 Socket.IO 連線狀態
- 確認後端 `task_urgent_changed` 事件正常發送
- 檢查前端是否正確監聽事件

## 📝 未來增強

可能的功能擴展：
- [ ] 設定緊急程度等級（高、中、低）
- [ ] 自動提醒功能（緊急任務超過 X 分鐘未處理）
- [ ] 緊急任務統計報表
- [ ] 緊急任務處理時效分析
- [ ] 批次設置緊急狀態

## 👥 相關人員

- **開發者**：GitHub Copilot
- **需求提出**：系統管理員
- **版本**：v1.0.0
- **日期**：2025-11-14

## 📄 授權

與主系統相同授權。
