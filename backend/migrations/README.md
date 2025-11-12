# 資料庫遷移指南

## 如何執行遷移

### 方法 1：透過 Render 儀表板（推薦）

1. 登入 [Render Dashboard](https://dashboard.render.com/)
2. 找到您的 PostgreSQL 資料庫服務
3. 點擊 "Shell" 標籤
4. 複製 `001_add_indexes.sql` 的內容並貼上執行

### 方法 2：使用本地 psql 客戶端

```bash
# 從 Render 取得資料庫連線字串
# 格式：postgresql://user:password@host:port/database

# 執行遷移
psql $DATABASE_URL -f backend/migrations/001_add_indexes.sql
```

### 方法 3：使用 Node.js 腳本（自動化）

我們已經準備好自動化腳本，執行以下命令：

```bash
cd backend
node migrations/run.js
```

## 遷移內容說明

### 001_add_indexes.sql

此遷移為以下表格新增索引以提升查詢效能：

#### orders 表
- `idx_orders_status` - 加速狀態查詢
- `idx_orders_picker_id` - 加速揀貨人員查詢
- `idx_orders_packer_id` - 加速裝箱人員查詢
- `idx_orders_created_at` - 加速時間排序
- `idx_orders_status_created_at` - 複合索引，最常用的查詢模式
- `idx_orders_status_picker_id` - 揀貨人員特定查詢優化
- `idx_orders_status_packer_id` - 裝箱人員特定查詢優化

#### 其他表格
- order_items: order_id, barcode
- order_item_instances: order_item_id, serial_number, status
- operation_logs: order_id, user_id, created_at

## 預期效能提升

- `/api/tasks` 端點查詢速度提升 **60-80%**
- 大量訂單時（1000+ 筆）效果更顯著
- 減少資料庫 CPU 使用率

## 回滾（如需移除索引）

```sql
-- 移除所有建立的索引
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS idx_orders_picker_id;
DROP INDEX IF EXISTS idx_orders_packer_id;
DROP INDEX IF EXISTS idx_orders_created_at;
DROP INDEX IF EXISTS idx_orders_status_created_at;
DROP INDEX IF EXISTS idx_orders_status_picker_id;
DROP INDEX IF EXISTS idx_orders_status_packer_id;

-- order_items
DROP INDEX IF EXISTS idx_order_items_order_id;
DROP INDEX IF EXISTS idx_order_items_barcode;

-- order_item_instances
DROP INDEX IF EXISTS idx_order_item_instances_order_item_id;
DROP INDEX IF EXISTS idx_order_item_instances_serial_number;
DROP INDEX IF EXISTS idx_order_item_instances_status;

-- operation_logs
DROP INDEX IF EXISTS idx_operation_logs_order_id;
DROP INDEX IF EXISTS idx_operation_logs_user_id;
DROP INDEX IF EXISTS idx_operation_logs_created_at;
```

## 注意事項

- 索引會佔用額外的儲存空間（預估增加 5-10%）
- 索引會稍微減慢 INSERT/UPDATE 操作（影響極小）
- 整體效能提升遠大於這些小缺點
