# FloatingChatPanel 修復報告

## 問題描述
用戶點擊「待揀貨任務」下的留言訊息時，出現以下錯誤：
```
TypeError: Cannot read properties of undefined (reading 'length')
```

## 根本原因
FloatingChatPanel.jsx 的實現方式與實際的 `useComments` hook 不匹配：

1. **錯誤的 Hook 使用方式**：
   - FloatingChatPanel 期望從 `useComments` 獲取：`{ comments, loading, sendComment, deleteComment, markAsRead }`
   - 但實際的 `useComments` 只返回 React Query 的結果：`{ data, isLoading, fetchNextPage, hasNextPage, invalidate }`

2. **缺少 Null 安全檢查**：
   - `comments.length` 在 comments 為 undefined 時會崩潰
   - `users.filter()` 在 users 為 undefined 時會崩潰

## 解決方案

### 1. 修正 useComments Hook 的使用方式
**修改前**：
```javascript
const { comments, loading, sendComment, deleteComment, markAsRead } = useComments(orderId);
```

**修改後**：
```javascript
// 使用 useComments hook 獲取評論數據
const { data, isLoading, invalidate } = useComments(orderId);
const comments = (data?.pages || []).flatMap(p => p.items ?? []);
const loading = isLoading;
```

### 2. 直接使用 apiClient 處理 CRUD 操作
參考 TaskComments.jsx 的實現模式，直接使用 apiClient：

**發送評論**：
```javascript
const handleSend = async () => {
    if (!message.trim()) return;
    
    try {
        // 直接使用 apiClient 發送評論
        await apiClient.post(`/api/tasks/${orderId}/comments`, {
            content: message,
            priority: priority,
            parent_id: null
        });
        
        setMessage('');
        setPriority('normal');
        
        // 重新獲取評論列表
        await invalidate();
        
        toast.success('消息已發送');
    } catch (error) {
        toast.error('發送失敗', {
            description: error.response?.data?.message || error.message
        });
    }
};
```

### 3. 添加 Null 安全檢查

**users 陣列**：
```javascript
const filteredUsers = (users || []).filter(u => 
    u.username?.toLowerCase().includes(mentionSearch.toLowerCase()) ||
    u.name?.toLowerCase().includes(mentionSearch.toLowerCase())
).slice(0, 5);
```

**comments 陣列** - 多處修改：
```javascript
// 1. useEffect 中
if (!isMinimized && comments && comments.length > 0) {
    markAllAsRead();
}

// 2. 最小化視圖
{comments && comments.length > 0 && (
    <div className="text-xs text-gray-500">
        {comments.length} 則對話
    </div>
)}

// 3. 消息列表渲染
{!comments || comments.length === 0 ? (
    <div className="text-center text-gray-400 py-8">
        <MessageSquare size={48} className="mx-auto mb-2 opacity-50" />
        <p>還沒有對話，開始第一則留言吧！</p>
    </div>
) : (
    comments.map((comment) => (
        // ... 渲染評論
    ))
)}
```

## 技術要點

### useComments Hook 的正確用法
```javascript
// useComments 返回 React Query 的 useInfiniteQuery 結果
const { 
    data,           // 分頁數據 { pages: [{ items: [], nextCursor: ... }] }
    isLoading,      // 載入狀態
    fetchNextPage,  // 載入下一頁
    hasNextPage,    // 是否有下一頁
    invalidate      // 重新獲取數據
} = useComments(orderId);

// 需要手動展平分頁數據
const comments = (data?.pages || []).flatMap(p => p.items ?? []);
```

### 為什麼不在 Hook 中實現 CRUD？
查看 TaskComments.jsx 的實現可以發現，它也是直接使用 apiClient 處理 CRUD 操作，而不是從 hook 獲取方法。這樣的設計有以下好處：
1. **關注點分離**：Hook 專注於數據獲取和快取
2. **靈活性**：組件可以根據需要自定義 CRUD 邏輯
3. **錯誤處理**：每個組件可以有自己的錯誤處理策略

## 驗證
- ✅ 無編譯錯誤
- ✅ 所有 Null 安全檢查已添加
- ✅ CRUD 操作使用 apiClient
- ✅ 與 TaskComments.jsx 的實現模式一致

## 相關文件
- `/workspaces/-moztech-shipment-verification-system/frontend/src/components/FloatingChatPanel.jsx` - 已修復
- `/workspaces/-moztech-shipment-verification-system/frontend/src/components/TaskComments.jsx` - 參考實現
- `/workspaces/-moztech-shipment-verification-system/frontend/src/api/useComments.js` - Hook 定義

## 測試建議
1. 點擊待揀貨任務的留言圖標，確認面板正常打開
2. 發送一則新評論，確認能成功發送並顯示
3. 切換優先級（一般/重要/緊急），確認標籤正確顯示
4. 使用 @ 提及功能，確認用戶列表正常顯示
5. 最小化/最大化面板，確認功能正常
6. 拖曳面板，確認位置調整正常
