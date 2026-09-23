# DEV ERP/WMS 配對與合成交運驗收操作稿

狀態：**操作稿；本文件中的 enable、secret、grant、訂單及 worker 命令尚未執行。**

## 已知基準與必須補齊的輸入

2026-09-23 再查：WMS `corely-wms-dev-handover-ab38d249-c` Ready、0%，原 `entry-audit2-0923` 100%；ERP API/web 已是 `department2-0923` 100%。不能拿先前 claw/entry-audit 的 ERP service spec 蓋回去。現有 WMS DEV DB 為 `corely_wms_dev_20260915`，036/037 已套；ERP DEV DB 為 `erp_dev_20260921`。正式不在此範圍。

WMS DEV 當時共有 28 個 revisions，只有 `handover-ab38d249-c` 配置 `WMS_HANDOVER_ENABLED`，值為 `false`；enabled sender 數為 0。這是當時快照，實際 enable 前必須再查。

WMS 固定 image：

- API `asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-backend@sha256:4c2846d190da5d895a4b3d382cdf848939719a1baed3fa7b7eee91e0dc7717e8`
- Web `asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-frontend@sha256:4d7b48ecbec5236cfb1bcf36e42b19d0eaaf9c38cf0fa21407628e60c2fffd90`
- 來源 `ab38d249875c7fdd2a239207fb74cee7e52cce94`，manifest `53bc8484eeeb1941cf08a3d45372f7a78190bcb8f21982a1b4544e70b8bbb986`。

執行者先提供並記錄：

1. 已合併最新 DEV 功能且含 handover receiver、native ticket、dispatch reservation 的 ERP API/web **image digests**；對應 migrations 已在 ERP DEV 套用、checksum 已驗證。舊 live image 不等於此候選。
2. 三個同組候選 URL：ERP API、ERP web、WMS web/API。下面預留新 tag `handover-qa-0923`，若已被他人使用必須停止並重新命名整組。
3. 合成 QA ERP dispatcher、picker、packer 的 immutable user IDs，以及核銷人員；全部 active、無 mustChangePassword。一般帳號需 `tw-entity-001` membership/employee entity，及 `wms_tasks:read` 加各站權限 `wms_orders:create`／`wms_picking:execute`／`wms_packing:execute`。核銷人員另依 ERP inventory 權限驗證。不要為方便將現有員工升為 admin。
4. 合成 ERP product IDs、warehouse ID、庫存及訂單 fixture 設計；產品 active/SIMPLE/非 SN、有 SKU/barcode、正整數數量，同單單一品牌、單一預留倉。`WMS_DISPATCH_PRODUCT_BRANDS_JSON` 必須以 product ID 明確映射，不從名稱或 SKU 推測。
5. 所有 Cloud Run revision 中只能有一組會消耗此 DEV outbox 的 worker。outbox 沒有候選環境分區，也沒有把接收 URL 固定在各 event 上；不同 revision 指向不同 ERP 時不能同時跑。

## 設定契約

| 用途 | ERP API 候選 | WMS API 候選 |
|---|---|---|
| ERP → WMS RS256 | `WMS_WORKSPACE_PRIVATE_KEY` | `ERP_WORKSPACE_PUBLIC_KEY` |
| Command issuer | `WMS_WORKSPACE_ISSUER=corely-erp-dev-handover-qa` | `ERP_WORKSPACE_ISSUER=corely-erp-dev-handover-qa` |
| Command audience | `WMS_WORKSPACE_AUDIENCE=corely-wms-dev-handover-qa` | `ERP_WORKSPACE_AUDIENCE=corely-wms-dev-handover-qa` |
| Command 開關 | `WMS_WORKSPACE_READ_ENABLED=true` 且 `WMS_WORKSPACE_COMMANDS_ENABLED=true` | `ERP_WORKSPACE_COMMANDS_ENABLED=true` |
| WMS → ERP RS256 | `WMS_HANDOVER_PUBLIC_KEY` | `WMS_HANDOVER_PRIVATE_KEY` |
| Handover issuer | 兩端 `WMS_HANDOVER_JWT_ISSUER=corely-wms-dev-handover-qa` | 同左 |
| Handover audience | 兩端 `WMS_HANDOVER_JWT_AUDIENCE=corely-erp-dev-handover-qa` | 同左 |
| Handover 開關 | receiver `WMS_HANDOVER_ENABLED=true` | sender 起初 `false`，最後才開 `true` |
| 目標 | `WMS_WORKSPACE_URL=$QA_WMS_URL`（只含 origin） | `WMS_HANDOVER_ERP_URL=$QA_ERP_API_URL/api/v1/integration/wms/events` |

Command JWT path 是 router suffix `/orders/:id/dispatch`；handover path 是完整 `/api/v1/integration/wms/events`。兩者不得混用。Handover raw wire body/hash 已持久化；所有 retry 原字串重送。ERP ACK 只代表待核銷收件。

現有 `corely-erp-wms-dev-workspace-20260923:1` 是 **SSO 共用字串**，目前掛 `WMS_PORTAL_SHARED_SECRET`／`ERP_PORTAL_SHARED_SECRET`，不是 RSA PEM。保留現有 SSO secret reference，另外建立兩組 RSA pairs。

## RSA 準備（尚未執行）

以明確 DEV secret 名称及固定 version 1；若名稱已存在，先檢查 ownership，不能盲目新增版本或覆寫。不要使用 `latest`，不要輸出私鑰、把私鑰放 repo 或 shell command argument。

```sh
set -eu
umask 077
QA_KEY_DIR=$(mktemp -d)
trap 'rm -f "$QA_KEY_DIR/command-private.pem" "$QA_KEY_DIR/command-public.pem" "$QA_KEY_DIR/handover-private.pem" "$QA_KEY_DIR/handover-public.pem"; rmdir "$QA_KEY_DIR"' EXIT
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$QA_KEY_DIR/command-private.pem"
openssl pkey -in "$QA_KEY_DIR/command-private.pem" -pubout -out "$QA_KEY_DIR/command-public.pem"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$QA_KEY_DIR/handover-private.pem"
openssl pkey -in "$QA_KEY_DIR/handover-private.pem" -pubout -out "$QA_KEY_DIR/handover-public.pem"
for QA_KEY in command-private command-public handover-private handover-public; do
  gcloud secrets create "corely-dev-qa-$QA_KEY-20260923" --project=moztech-main-db \
    --replication-policy=automatic --data-file="$QA_KEY_DIR/$QA_KEY.pem"
done
```

只輸出公鑰指紋作交接：`openssl pkey -pubin -in "$QA_KEY_DIR/command-public.pem" -outform DER | openssl dgst -sha256`（handover 也做）。比對 private 導出的 public 指紋相同；不要列印 PEM。成功注入／核對後刪除這四個明確檔案及空的暫存目錄。

```sh
for QA_KEY in command-private handover-public; do
  gcloud secrets add-iam-policy-binding "corely-dev-qa-$QA_KEY-20260923" \
    --project=moztech-main-db --member=serviceAccount:corely-erp-dev-rt@moztech-main-db.iam.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor
done
for QA_KEY in command-public handover-private; do
  gcloud secrets add-iam-policy-binding "corely-dev-qa-$QA_KEY-20260923" \
    --project=moztech-main-db --member=serviceAccount:corely-wms-dev-runtime@moztech-main-db.iam.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor
done
```

## 候選設定順序

每次 deploy 前重新核對 live traffic、revision、image、完整 spec hash、其他工作窗；使用 `--update-env-vars` / `--update-secrets`，不可使用重置全部設定的 `--set-env-vars` / `--set-secrets`。CLI 多容器更新必須明確保留 web `--port=8080`。所有候選 `--no-traffic`，原 DEV 100% 不變。以下变量未設定就不得執行：

```sh
QA_WMS_URL=https://handover-qa-0923---corely-wms-dev-sp5g377smq-de.a.run.app
QA_ERP_API_URL=https://handover-qa-0923---corely-erp-api-dev-sp5g377smq-de.a.run.app
QA_ERP_WEB_URL=https://handover-qa-0923---corely-erp-dev-sp5g377smq-de.a.run.app
: "${QA_ERP_API_IMAGE:?Set reviewed ERP API digest}"
: "${QA_ERP_WEB_IMAGE:?Set reviewed ERP web digest}"
: "${QA_WMS_API_IMAGE:?Set pinned WMS API digest above}"
: "${QA_WMS_WEB_IMAGE:?Set pinned WMS web digest above}"
: "${QA_PRODUCT_BRANDS_JSON:?Set reviewed entity/product-id to brand mapping}"
: "${QA_ERP_CORS_ORIGINS:?Preserve current ERP CORS_ORIGIN and append QA ERP web origin}"
: "${QA_WMS_CORS_ORIGINS:?Preserve current WMS CORS_ORIGINS and append QA WMS origin}"
python3 - "$QA_ERP_API_IMAGE" "$QA_ERP_WEB_IMAGE" "$QA_WMS_API_IMAGE" "$QA_WMS_WEB_IMAGE" "$QA_PRODUCT_BRANDS_JSON" "$QA_ERP_CORS_ORIGINS" "$QA_WMS_CORS_ORIGINS" <<'PY'
import json,re,sys
for image in sys.argv[1:5]:
    assert re.fullmatch(r'asia-east1-docker\.pkg\.dev/moztech-main-db/cloud-run/[a-z0-9-]+@sha256:[a-f0-9]{64}',image)
assert all('|' not in value for value in sys.argv[1:])
mapping=json.loads(sys.argv[5]);assert set(mapping)=={'tw-entity-001'} and mapping['tw-entity-001']
for product,brand in mapping['tw-entity-001'].items():
    assert re.fullmatch(r'[A-Za-z0-9_-]{1,128}',product) and product!='ACTUAL_SYNTHETIC_PRODUCT_ID'
    assert isinstance(brand,str) and brand.strip() and len(brand)<=128
PY
```

`QA_PRODUCT_BRANDS_JSON` 形狀為 `{"tw-entity-001":{"ACTUAL_SYNTHETIC_PRODUCT_ID":"QA-CORELY"}}`，同品牌字串也用於 grant。以上值均不可含 `|`，下列 gcloud 使用 `^|^` 分隔。所有 image 必須為 `@sha256:`，占位 ID 不可進入執行。ERP `CORS_ORIGIN`（單數）與 WMS `CORS_ORIGINS`（複數）不同；追加 exact origin、不用 wildcard、不丟掉原 allowlist。WMS 本身同源請求不靠跨域標頭，但配對瀏覽器／socket allowlist 仍應明確。

1. 建 ERP API 候選：固定來源與 migrations 已先驗證；receiver 可先啟用，WMS sender 仍關閉。

```sh
gcloud run deploy corely-erp-api-dev --project=moztech-main-db --region=asia-east1 \
  --image="$QA_ERP_API_IMAGE" --revision-suffix=handover-qa-0923 \
  --tag=handover-qa-0923 --no-traffic \
  --update-env-vars="^|^WMS_WORKSPACE_URL=$QA_WMS_URL|WMS_WORKSPACE_READ_ENABLED=true|WMS_WORKSPACE_COMMANDS_ENABLED=true|WMS_WORKSPACE_ISSUER=corely-erp-dev-handover-qa|WMS_WORKSPACE_AUDIENCE=corely-wms-dev-handover-qa|WMS_DISPATCH_PRODUCT_BRANDS_JSON=$QA_PRODUCT_BRANDS_JSON|WMS_HANDOVER_ENABLED=true|WMS_HANDOVER_JWT_ISSUER=corely-wms-dev-handover-qa|WMS_HANDOVER_JWT_AUDIENCE=corely-erp-dev-handover-qa|WMS_PORTAL_SERVICE_URL=$QA_WMS_URL|CORS_ORIGIN=$QA_ERP_CORS_ORIGINS" \
  --update-secrets=WMS_WORKSPACE_PRIVATE_KEY=corely-dev-qa-command-private-20260923:1,WMS_HANDOVER_PUBLIC_KEY=corely-dev-qa-handover-public-20260923:1
```

2. 建 WMS 配對候選但不啟動 sender；保留 SSO enabled/entity/shared-secret/ERP-only 設定。

```sh
gcloud run deploy corely-wms-dev --project=moztech-main-db --region=asia-east1 \
  --revision-suffix=handover-qa-config-0923 --tag=handover-qa-0923 --no-traffic \
  --container=api --image="$QA_WMS_API_IMAGE" \
  --update-env-vars="^|^ERP_WORKSPACE_COMMANDS_ENABLED=true|ERP_WORKSPACE_ISSUER=corely-erp-dev-handover-qa|ERP_WORKSPACE_AUDIENCE=corely-wms-dev-handover-qa|WMS_HANDOVER_ENABLED=false|WMS_HANDOVER_ERP_URL=$QA_ERP_API_URL/api/v1/integration/wms/events|WMS_HANDOVER_JWT_ISSUER=corely-wms-dev-handover-qa|WMS_HANDOVER_JWT_AUDIENCE=corely-erp-dev-handover-qa|ERP_PORTAL_API_URL=$QA_ERP_API_URL/api/v1|ERP_PORTAL_ORIGIN=$QA_ERP_WEB_URL|CORS_ORIGINS=$QA_WMS_CORS_ORIGINS" \
  --update-secrets=ERP_WORKSPACE_PUBLIC_KEY=corely-dev-qa-command-public-20260923:1,WMS_HANDOVER_PRIVATE_KEY=corely-dev-qa-handover-private-20260923:1 \
  --container=web --image="$QA_WMS_WEB_IMAGE" --port=8080
```

3. 建 ERP web 候選，runtime `/config.js` 的 API、WS、WMS 三者一起固定，避免 UI 打回 default DEV。

```sh
gcloud run deploy corely-erp-dev --project=moztech-main-db --region=asia-east1 \
  --image="$QA_ERP_WEB_IMAGE" --revision-suffix=handover-qa-0923 \
  --tag=handover-qa-0923 --no-traffic \
  --update-env-vars="^|^API_URL=$QA_ERP_API_URL/api/v1|WS_URL=$QA_ERP_API_URL|WMS_PORTAL_URL=$QA_WMS_URL"
```

讀回每個 service/revision 確認只有審核過的 key、image、tag 改變；production 與三個 default DEV traffic 不變。驗證 config.js、ERP health、WMS ready、CORS preflight、SSO nonce/origin。使用 ERP 候選登入；不從 WMS numeric ID 猜票證。Native ticket 只能在 acknowledged dispatch intent 之後申請。

## 身分映射與最小授權

先讓 QA dispatcher/picker/packer 分別從配對 ERP 工作台進入 WMS；`erpSession.exchange` 以 immutable ERP ID 建／找 `erp_staff_identities`，不以名稱或 email 綁定。其 WMS role 會隨目前票證角色同步，所以使用獨立 QA actors，避免同一 actor 切換站別把 grant 所需 dispatcher role 改掉。

grant 不是 SSO mapping，也不是 ERP permission。唯讀核對：

```sql
BEGIN READ ONLY;
SELECT current_database(),current_user;
SELECT e.erp_user_id,e.entity_id,e.wms_user_id,u.role
FROM erp_staff_identities e JOIN users u ON u.id=e.wms_user_id
WHERE e.erp_user_id=:'qa_actor_id' AND e.entity_id='tw-entity-001';
SELECT entity_id,erp_actor_id,brand,wms_user_id,revoked_at
FROM corely_dispatch_grants WHERE erp_actor_id=:'qa_actor_id';
ROLLBACK;
```

確認 ERP actor 的 entity/permissions、品牌映射與 WMS dispatcher/admin/superadmin role 相符後，才使用已核准的 DEV connection 執行以下 psql。`qa_actor_id`/`qa_brand` 用 psql variables 傳入；不直接串 SQL 字串。沒有 mapping 或 existing grant 不相符時不猜測、不覆寫、不解除 revoked。

```sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
SELECT current_database()='corely_wms_dev_20260915' AND current_user='corely_wms_dev_20260915' AS dev_ok \gset
\if :dev_ok
SELECT e.wms_user_id FROM erp_staff_identities e JOIN users u ON u.id=e.wms_user_id
 WHERE e.erp_user_id=:'qa_actor_id' AND e.entity_id='tw-entity-001'
 AND u.role IN ('dispatcher','admin','superadmin') FOR SHARE OF e,u;
INSERT INTO corely_dispatch_grants(entity_id,erp_actor_id,brand,wms_user_id)
 SELECT e.entity_id,e.erp_user_id,:'qa_brand',e.wms_user_id
 FROM erp_staff_identities e JOIN users u ON u.id=e.wms_user_id
 WHERE e.erp_user_id=:'qa_actor_id' AND e.entity_id='tw-entity-001'
 AND u.role IN ('dispatcher','admin','superadmin')
 ON CONFLICT (entity_id,erp_actor_id,brand) DO NOTHING;
SELECT count(*)=1 AS grant_ok FROM corely_dispatch_grants g
 JOIN erp_staff_identities e ON e.erp_user_id=g.erp_actor_id AND e.entity_id=g.entity_id AND e.wms_user_id=g.wms_user_id
 JOIN users u ON u.id=e.wms_user_id
 WHERE g.entity_id='tw-entity-001' AND g.erp_actor_id=:'qa_actor_id' AND g.brand=:'qa_brand'
 AND g.revoked_at IS NULL AND u.role IN ('dispatcher','admin','superadmin') \gset
\if :grant_ok
COMMIT;
\else
ROLLBACK;
\quit 3
\endif
\else
ROLLBACK;
\quit 3
\endif
```

## Sender 與 CPU

現有版本只有常駐 timer，沒有獨立 drain CLI／按 event ID 限定的 drain API。`retry` 只重新排隊；不能用打 `/health` 當作背景重試保障。此版本 QA 選擇 revision-level `--min-instances=1 --no-cpu-throttling`，不是 service-level `--min`。先查全 DEV outbox 為空，或每一待傳 event 都在本次合成 fixture 名單中，且沒有另一個 enabled sender。不要直接呼叫不限定事件的 `deliverOne` 去處理未知 DEV 資料。

在 SSO、grant、receiver、fixture範圍已確認後，新建同 tag 的 worker revision（不變更 API/web digests）：

```sh
gcloud run deploy corely-wms-dev --project=moztech-main-db --region=asia-east1 \
  --revision-suffix=handover-qa-worker-0923 --tag=handover-qa-0923 --no-traffic \
  --min-instances=1 --no-cpu-throttling \
  --container=api --image="$QA_WMS_API_IMAGE" --update-env-vars=WMS_HANDOVER_ENABLED=true \
  --container=web --image="$QA_WMS_WEB_IMAGE" --port=8080
```

保持唯一 worker。0% tagged revision 仍可執行背景傳送及寫共享 DEV DB；這就是必須先審核全部 due events 的原因。保留 source order/line/product/warehouse/event IDs 於 QA receipt。

## 驗收、停止與留證

合成流程：ERP 單倉預留 100 → native dispatch/同 request 重試 → SSO 開原生預揀 → 指派/掃碼/放行 → picker/packer 完成 → 實交 60 與 40 使用不同箱號 → ERP inbox pending_review → reviewer 逐行過帳。每步保留 IDs 與前後數量；確認 reserve 不等於 OUT、收件不扣庫、部分過帳正確、相同 event/body 重送不重複扣庫、異 body 409、超出已裝箱拒絕、已交運不可 undo/void。不可呼叫真實物流建單或送實際會計/ECOUNT 過帳。

結束時先停止產生 QA 交運，核對 outbox terminal/retry/rejected 狀態並保存明細。建立新 disabled revision（同 tag、`WMS_HANDOVER_ENABLED=false`、`ERP_WORKSPACE_COMMANDS_ENABLED=false`、`--min-instances=0 --cpu-throttling`），確認 Ready、原 live 100% 不變。**新 revision 關 flag 不會改掉舊 revision 的 immutable env/minScale**：確認 `handover-qa-worker-0923` 已無 tag／0% 後，在明確的 QA 資源清理授權下刪除該 worker revision，或依已驗證的 instance 停止程序確認它不再執行；不能只宣稱 flag 已關就完成停機。保留資料表、shipment/outbox/inbox/stock posting 事實，不以 dump 還原或 DELETE 當測試清理。

QA 後的 rollback 是停用 worker／授權並切回程式，不是撤銷已發生的庫存過帳。業務修正須走可追溯的補償流程。保存 secret **名稱/版本/公鑰指紋**、允許的 IDs、所有 image digests、revision/tag/traffic、migration checksums、ACK 與逐行過帳回執，絕不保存私鑰/密碼/session token。

若本次 QA grant 不再使用，僅在同樣的 DEV database/user 防護下，對本次已記錄的 `(entity_id,erp_actor_id,brand,wms_user_id)` 設 `revoked_at=NOW()`，核對影響列數 1；不要刪除 grant 或更動其他 actors。保留 fixture 身分與所有過帳／交運事實，交給後續補償流程處理。
