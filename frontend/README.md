# MOZTECH WMS Frontend (React + Vite)

本專案使用 React 18 + Vite，並以一套 Apple / iOS 設定頁風格的設計系統統一介面。以下文件提供設計代幣、共用元件與頁面模式使用方式，協助快速擴充。`-old` / `-modern` 歷史版本已移除，僅保留統一版。 

## ✨ 設計系統核心理念
- 一致：排版、間距、顏色、狀態呈現保持統一。
- 清晰：資訊分組以 Card 呈現，使用 PageHeader 作為入口敘述與操作區。
- 速度：Skeleton 於載入時提供清晰骨架；EmptyState 用於無資料情境。
- 無阻斷：錯誤 / 空 / 載入狀態皆內嵌於卡片，不強制覆蓋整頁。

## 🎨 設計代幣 (Tailwind)
Tailwind 已在 `tailwind.config.js` 中擴充：
- 色彩：以灰階 + 藍 / 綠 / 橙 / 紅為主（語意層）
- 陰影：`shadow-apple-sm`、`shadow-apple-lg` 用於細緻浮起效果
- 圓角：`rounded-xl` / `rounded-2xl` 為主要容器風格
- 動畫：`animate-fade-in`、`animate-slide-up`、`animate-scale-in` 用於進場

間距原則：
- 區塊外距：`mb-6` / `mb-8`
- 內距：卡片 `p-5` 或 `p-6`；Header `py-4`；表格列 `px-4 py-2`

## 🧱 共用 UI 元件 (位於 `src/ui`)
| 元件 | 用途 | 要點 |
|------|------|------|
| `Button` | 操作按鈕 | `variant` (`primary`,`secondary`,`subtle`,`ghost`,`destructive`)，`size` (`sm`,`md`,`lg`)，可 `leadingIcon`/`trailingIcon` |
| `Card` / `CardHeader` / `CardTitle` / `CardContent` | 資訊分組容器 | Header 放 icon + 標題；內容保持 16px 文字；允許嵌入表格或操作列 |
| `Badge` | 狀態顯示 | 對應任務 / 訂單等狀態；色彩語意化 |
| `Modal` | 對話框 | 用於新增 / 編輯 / 確認操作；放置表單或警示文字 |
| `Table` | 一致表格骨架 | 使用 `Table`, `THead`, `TR`, `TH`, `TD`，避免自製樣式漂移 |
| `PageHeader` | 頁面頂部導引 | `title` / `description` / `actions` slot |
| `FilterBar` | 篩選區域 | 放搜尋、篩選器、統計摘要 |
| `EmptyState` | 無資料視圖 | 提供 `icon`, `title`, `description`, `action` |
| `Skeleton` / `SkeletonText` | 載入骨架 | 列表與卡片載入前的視覺佔位 |
| `Input` | 表單輸入欄位 | 內建 label, error 顯示與 icon slot |
| `AppLayout` | 全域框架 | 提供固定最大寬度、背景與可擴充導航區 |

使用範例：
```jsx
import { Card, CardHeader, CardTitle, CardContent, Button, EmptyState } from '@/ui';

function ExamplePanel({ data, loading, onRefresh }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>最近異常紀錄</CardTitle>
			</CardHeader>
			<CardContent>
				{loading && <SkeletonText lines={4} />}
				{!loading && data.length === 0 && (
					<EmptyState title="目前無異常" description="系統運作正常" action="重新整理" onAction={onRefresh} />
				)}
				{!loading && data.length > 0 && (
					<ul className="space-y-2">
						{data.map(row => <li key={row.id} className="text-sm">{row.message}</li>)}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
```

## 🧪 狀態處理模式
| 狀態 | 呈現方式 | 範例 |
|------|----------|------|
| Loading | Skeleton / SkeletonText | 載入列表、卡片統計、表格列骨架 |
| Empty | EmptyState | 無資料時顯示 icon + 說明 + 可行動 |
| Error | 內嵌紅色卡片或 toast | `toast.error('載入失敗')` 以及卡片內錯誤區塊 |
| Updating | Disabled 按鈕 + spinner icon | `leadingIcon={Loader2}` 並加 `disabled` |

避免：
- 全頁遮罩阻斷操作（除非關鍵流程）
- 不一致的自製「載入中...」文字
- 重複程式碼的錯誤處理分支

## 📦 新增頁面流程
1. 建立檔案：`src/components/NewFeature.jsx`
2. 以 `PageHeader` 開頭提供標題與操作。
3. 主要內容以 `Card` 分段；載入使用 Skeleton；無資料用 EmptyState。
4. 操作按鈕：使用 `Button`，若有狀態改變加上 disabled 與 spinner。
5. 資料取得：使用現有 `apiClient` 或 React Query（若已有 hook 模式）。
6. 加入路由：在 `App.jsx` 或相關路由設定處新增。
7. 若需要表格：使用 `Table` primitives，不直接寫 `<table>` 樣式。

## 🔄 即時 / 通知整合
工具：`socket.io`、`soundNotification`、`voiceNotification`、`desktopNotification`。
- 新事件：先在後端推播，前端 `socket.on('event_name', handler)`。
- 通知互斥：聲音 + 語音 + toast 不同層次（僅關鍵操作使用語音）。

## 🗑 Legacy 清理紀錄
已移除：`*-old.jsx`, `*-modern.jsx` 版本（LoginPage, TaskDashboard, OrderWorkView, AdminDashboard, UserManagement, Analytics, OperationLogs）。保留：`TaskDashboard-with-batch.jsx`（特殊批次模式）。
目的：減少重複與混淆，統一維護點。

## 🧩 一致的載入 / 空 / 錯誤模式
撰寫列表時：
```jsx
{loading && <SkeletonText lines={5} />}
{!loading && rows.length === 0 && <EmptyState icon={Package} title="尚無資料" description="稍後再試或調整篩選" />}
{!loading && rows.length > 0 && <Table>...</Table>}
```

## 🚀 快速執行
```bash
npm install
npm run dev
```

## 🛠 ESLint / 格式化
已採用專案預設規則；若需擴充，新增對 hook / accessibility 的檢查即可。TypeScript 可後續漸進導入。

## 🤝 貢獻規範（簡易）
- 新元件置於 `src/ui` 並加入 `index.js`。
- 保持無侵入：勿修改外部 API 介面回傳結構。
- Commit message：`feat(ui): ...` / `fix(order): ...` / `refactor(core): ...`。
- 若新增狀態顏色，請統一更新與使用 `Badge` 或相應語意色。

## ✅ 待後續優化建議
- 抽離掃描 / 聲音通知為可測試 hook（ex: `useScanner`）。
- 將語音／桌面通知開關加入使用者偏好設定。
- 可視化揀貨 / 裝箱時間曲線的 Analytics 深化。

---
任何頁面擴充請遵循「PageHeader + Card 分組 + Skeleton/EmptyState」三原則，以確保一致 UX。歡迎在 PR 中附上截圖。 
