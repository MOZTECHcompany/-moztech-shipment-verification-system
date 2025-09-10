### Moztech WMS - 開發啟動與登入說明

此專案包含：
- 前端：Vite + React（根目錄）
- 核心後端 API：Node.js + Express + PostgreSQL（`backend/`）
- 簡易日誌伺服器：Node.js + Express（`server/`）

#### 1) 前端開發
- 建立環境變數檔：在專案根目錄建立 `.env.local`
```
VITE_API_BASE_URL=https://moztech-wms-api.onrender.com
```
- 啟動：
```
npm ci
npm run dev
```

如果你有本機後端（預設 3001），可以改成：
```
VITE_API_BASE_URL=http://localhost:3001
```

#### 2) 後端（可選，若需雲端登入）
- 建立 `backend/.env`：
```
DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require
JWT_SECRET=change-me
```
- 啟動：
```
cd backend
npm ci
npm start
```

雲端（Render）常見問題：
- 500 登入失敗多半是缺少 `DATABASE_URL` 或 `JWT_SECRET`，或資料庫尚未建立 `users` 資料表。
- 至 Render 儀表板設定環境變數，並建立資料表與管理員帳號。

建立 `users` 資料表（示例）：
```
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL
);
```

#### 3) 登入方式
- 線上模式：使用後端 `/api/auth/login`（推薦）。
- 離線回退：若後端不可用，登入會自動使用本機帳號清單 `src/users.js`。
  - 範例：帳號 `admin`，密碼 `adminpass`；或使用預設的 picker/packer 帳密。

#### 4) 匯入與作業
- 匯入 Excel 會先嘗試呼叫後端 `/api/orders/import`；若失敗，前端會切換為離線模式，但仍可完成揀貨/裝箱流程。
- 儀表板統計在離線模式會顯示占位資料。

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
