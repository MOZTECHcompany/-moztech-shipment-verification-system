# WMS：另一個 Codex 接手入口

## 任務與最新方向

使用者要交接 WMS 程式碼給另一個 Codex 修改與維護，未來把 Render 停用，部署全部換到公司 Cloud Run。此次交接只含程式碼與文件，不含正式資料／憑證，不代表雲端搬遷已完成。持續服務不能先停；不要把這個程式與公司售後系統混淆。

## 立即閱讀

1. [完整架構](docs/WMS_ARCHITECTURE.md)：入口、模組、流程、權限、依賴與目標架構。
2. [API 與 Socket 索引](docs/WMS_API_INDEX.md)：由當前程式擷取，附檔案與行號。
3. [資料表欄位索引](docs/WMS_DATA_MODEL.md)：由 2026-09-05 備份 schema 離線擷取，沒有資料列。
4. [Cloud Run 改造與驗收順序](docs/WMS_CLOUD_RUN_PLAN.md)。
5. [歷史部署盤點](docs/MIGRATION_AUDIT_2026-09-05.md)：2026-09-05 的觀察，不能當作現在狀態。

## 本機與版本

- 工作目錄：`/Users/moztecheason/Documents/moztech-shipment-verification-system`。
- 上一個 Codex 的 cwd `/Users/moztecheason/Documents/ChatGPT/corely AI` 是其他產品，不要在那裡修改 WMS。
- origin：`https://github.com/MOZTECHcompany/-moztech-shipment-verification-system.git`。
- 基準 main：`d4e2bff12545d9243787d52850c16f36e1db4eed`；2026-09-09 已核對遠端 main 同 SHA。
- 本次只新增交接文件；文件尚未 commit／push；應保留後續使用者變更。
- 未建立新 Codex 任務、未轉移 repo 所有權、未部署。原庫 push 權限需重新查核；09-05 時 gh 使用 MOZTECH-Main，對原庫只有 pull。

## 接手後的安全開發順序

先 `git status --short`、確認 remote 與實際啟動入口，再建立自己的 codex/ 分支。若從 ZIP 開始，先讀 MANIFEST.json；ZIP 不含 .git，不能把它當作已有 Git 歷史的 checkout。需要歷史時從 origin clone，再帶入交接文件。

先把本機 Axios、Socket URL 與 Vite proxy 同時改為隔離開發來源，並建立隔離 DB／附件目錄，之後才開頁面操作。現有前端 npm run dev 可能直接打正式 Render。

前後端分別執行 npm ci；不要把 vendor node_modules 當可信 build 產物。不要把正式 env 複製進專案。後端 npm start 自動跑 migration，未建立隔離 DB 前不要啟動。

在確認環境隔離後，可用下列作為候選驗證指令；本次文件整理沒有執行或宣称通過這些測試：

```sh
# frontend 目錄
npm ci
npm run build
npm run lint

# backend 目錄；僅使用測試值及隔離 DB
npm ci
NODE_ENV=test JWT_SECRET=local-test-only npm test -- --runInBand --coverage=false
```

目前 src/__tests__ 有 auth、user、orderChangeService.untrackedDecrease、serialNumberScanNormalization、snParsingImport 五個測試檔；先審查 mock 與環境設定再跑。根目錄 test-api.js 指向正式 API，不當作本機 smoke。

## 未完成項目與必要決策

- Render、Vercel、AI Studio Cloud Run 前端不是同一 build；使用者尚未確認同事主用入口。原 GitHub frontend 對应 Render 維護線，不能宣稱它等同 AI Studio 舊前端。先確認保留哪個介面；若是 AI Studio 版，還需取得對應原始碼。
- 獨立網域與公司 repo 最終位置未確認；不可覆蓋 moztechCEE/moztech-after-sales-system。
- 正式資料、實體附件、增量同步、還原演練、登入後完整驗收都不在本次程式碼包內。
- 09-05 曾建立基準 DB 備份，未做 restore rehearsal／之後的增量同步，不可直接拿它切正式主庫。
- 如仍需要原主機上的私人備份／設定，由同機授權環境另行安全取得；不要把它們加進 ZIP、Git、對話或 PR。

## 程式碼包內容

提供原始碼快照、package-lock、migration、現有測試與交接文件。排除 .git、node_modules、coverage、dist、uploads、正式 env、DB dump。另排除未被引用且含舊密碼欄位的 frontend/src/users.js；原 checkout 保留未動，ZIP 的 MANIFEST.json 記錄此排除。

ZIP 不包含 AI Studio 版對應原始碼；只含本 repo 的 Render 維護線。既有程式中的 Render URL 保留供接手者有依據地改造，不能把此包當成已完成 Cloud Run 適配版本。
