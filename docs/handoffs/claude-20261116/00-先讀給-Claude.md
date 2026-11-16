# Corely WMS 銷貨單轉檔接手包

交付基準為 DEV 版本 `ab835f44ef2d9e855360aa6b01fb9216cd70afed`。
工程接手環境必須先確認當下的版本與授權範圍。此版本在 2026 年 11 月 16 日 17:27（台灣時間）的 DEV 讀回為 `corely-wms-dev-histreview-ab835f44`，承接 100% 流量。

## 解壓後的內容

- `source/` 包含該 commit 的全部 510 個 Git 追蹤檔，包括前後端、原始資產、資料庫 migration、測試、CI、文件和建置工具。
- `source/.git/` 是可離線使用的單版 Git 工作區。原 commit SHA、tree SHA、工作樹內容與檔案模式可驗證。需要比較祖先或合併其他分支時，再接公司的授權 Git 來源。
- `WMS 銷貨單轉檔技術交接.docx` 說明完整作業、例外、API、資料與驗收。
- [`01-DEV-設定與驗收.md`](01-DEV-設定與驗收.md) 說明本機、雲端、店鋪與驗收設定。
- [`02-GitHub-與-GCP-部署位置.md`](02-GitHub-與-GCP-部署位置.md) 列 GitHub repo、分支、CI，及 GCP Cloud Build、映像、Cloud Run、Cloud SQL、ERP 掛載與 Secret Manager 參照。
- [`03-WMS-API-與資料契約.md`](03-WMS-API-與資料契約.md) 列方法、URL、權限、請求、回應、錯誤、實際寫入及 ERP／Shopify／SHOPLINE／1Shop／ECOUNT／物流整合。
- [`04-WMS-HTTP-路由索引.md`](04-WMS-HTTP-路由索引.md) 與 [`WMS-HTTP-路由索引.json`](WMS-HTTP-路由索引.json) 可依完整路徑、HTTP 方法與原始碼行號搜尋。
- `artifacts/` 保存已篩選的發布、原檔預覽及 DEV 設定讀回證據。
- `SOURCE-VERIFICATION.json` 記載固定來源及壓縮檔測試方法。`SHA256SUMS.txt` 供解壓後檢查每一個包內檔案。

從壓縮包根目錄執行

```bash
shasum -a 256 -c SHA256SUMS.txt
git -C source rev-parse HEAD 'HEAD^{tree}'
git -C source status --short
git -C source ls-files | wc -l
```

應依序讀到 commit `ab835f44ef2d9e855360aa6b01fb9216cd70afed`、tree `88c5307c14c52dee8e1e514b8d48bd33fb19e99e`、乾淨的工作樹及 510 個追蹤檔。若介面只顯示單一檔案而沒有 `source/.git`，請先以一般 ZIP 解壓工具完整解壓。使用可保留 Git 檔案模式的檔案系統。

## 可貼給 Claude 的工作指令

請先在此包中確認本機 source checkout、commit、工作樹和現有環境存取，先看《GitHub 與 GCP 部署位置》和《WMS API 與資料契約》，確認 GitHub main 和 DEV 的差別，再按《DEV 設定與驗收》開立一條獨立開發分支。用合成或經授權的測試資料在隔離環境執行驗收矩陣，從商城讀單核對至 ECOUNT 銷貨檔預覽、原單理貨回匯、列印與掃碼。依實際權限核對 Cloud Run、ERP 入口、店鋪 profile、秘密參照、資料庫和 ECOUNT 商品主檔。需我補上的存取權與樣本請具體列出適用環境和用途。

這次接手工作基準是 DEV。遠端 main、線上 DEV 和正式站各自核對。官方憑證及營運資料由公司授權來源取得。正式 ERP 交易、正式庫存及實體設備由各自的作業窗口驗收。

請回報「程式與設定」、「候選版本與 DEV 流量」、「登入後原檔預覽」、「保存及產出銷貨檔」、「ECOUNT 回匯」、「實體列印掃碼」各自的驗收進度。若要求重試，先查現有操作結果與原批次。已經存在 ECOUNT 原銷貨的單據，由原銷貨續辦。資料歸屬與庫存只依核准流程調整。

## 最優先需補驗的樣本

- 墨超七 CSV 的歷史促銷條碼 11 筆。先確認 ERP 管理員藉原生拋單入口可操作，再按本次實物與來源逐行核對。
- 萬魔獨立 Shopify 店鋪的待出貨樣本。既有原檔讀到的 3 筆已出貨，請用另一筆合格測試單驗證實際銷貨與回匯。
- 原銷貨續辦及兩種 ECOUNT 回傳。測試資料請包含正確運費行、錯批或重複列，以及倉庫列印與實際掃碼的驗收證據。
