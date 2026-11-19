import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from "antd";
import dayjs from "dayjs";
import { useSearchParams } from "react-router-dom";
import { ConfigProvider } from "antd";
import zhTW from "antd/locale/zh_TW";
import { canManageCartons } from "../utils/cartonEditor";
import { productService } from "../features/sn-labels/products";
import type { Product } from "../features/sn-labels/products";
import LabelDesigner from "../features/sn-labels/LabelDesigner";
import CartonPreview from "../features/sn-labels/CartonPreview";
import BatchReviewControls, { type BatchAction } from "../features/sn-labels/BatchReviewControls";
import {
  CONFIRMED_RULES,
  draftStorageKey,
  newDraft,
  isNoSerial,
  parseDrafts,
  sampleSerial,
} from "../features/sn-labels/model";
import type { SnDraft } from "../features/sn-labels/model";
import { errorText, productDefaults, reviewStateText, snApi } from "../features/sn-labels/api";
import type { Detail, Entry } from "../features/sn-labels/api";
import "./SnLabelsPage.css";

export default function SnLabelsPage({ user }: {user: {id:number;role:string}}) {
  return <ConfigProvider locale={zhTW}><Workspace key={user.id} entityId="wms-trial"
    storageKey={draftStorageKey("wms-trial", String(user.id))} canWrite={canManageCartons(user)} /></ConfigProvider>;
}
function Workspace({
  entityId,
  storageKey,
  canWrite,
}: {
  entityId: string;
  storageKey: string;
  canWrite: boolean;
}) {
  const [query, setQuery] = useSearchParams();
  const pendingReviewRequested = query.get("status") === "pending-review";
  const batchListHeading = useRef<HTMLHeadingElement>(null);
  const api = useMemo(() => snApi(entityId), [entityId]);
  const [draft, setDraft] = useState(() => newDraft(crypto.randomUUID())),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false);
  const noSerial = isNoSerial(draft);
  const [active, setActive] = useState<Detail | null>(null),
    [batchAction, setBatchAction] = useState<{ key: string; action: BatchAction } | null>(null),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("batch"),
    [products, setProducts] = useState<Product[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(pendingReviewRequested ? "pending-review" : ""),
    [sort, setSort] = useState("desc"),
    [dates, setDates] = useState<string[]>([]),
    [manufactureDates, setManufactureDates] = useState<string[]>([]),
    [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(""),
    [productError, setProductError] = useState(""),
    [cartonPage, setCartonPage] = useState(1);
  const [from, setFrom] = useState(1),
    [to, setTo] = useState(100),
    [warehouseFrom, setWarehouseFrom] = useState(1),
    [warehouseTo, setWarehouseTo] = useState(1),
    [reason, setReason] = useState("initial");
  const [columns, setColumns] = useState([
    "一般序號",
    "國際條碼",
    "箱號",
    "箱內順序",
    "產品名稱",
    "型號",
    "款式",
    "顏色",
    "下單日期",
    "製造日期",
  ]);
  const [masterOpen, setMasterOpen] = useState(false),
    [newProduct, setNewProduct] = useState(false),
    [masterForm] = Form.useForm();
  const [msg, context] = message.useMessage(),
    [modal, modalContext] = Modal.useModal();
  const [localDrafts] = useState(() => {
    try {
      return parseDrafts(localStorage.getItem(storageKey));
    } catch {
      return [];
    }
  });
  const showPendingReviews = useCallback(() => {
    setStatus("pending-review");
    setSearch("");
    setDates([]);
    setManufactureDates([]);
    setSort("desc");
    setPage(1);
    batchListHeading.current?.scrollIntoView({ block: "start" });
    batchListHeading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (pendingReviewRequested) showPendingReviews();
  }, [pendingReviewRequested, showPendingReviews]);
  useEffect(() => {
    let live = true;
    productService
      .findAll()
      .then((p) => {
        if (live) {
          setProducts(p.filter((p) => p.type !== "SERVICE"));
          setProductError("");
        }
      })
      .catch((e) => {
        if (live) setProductError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api
        .list({
          page,
          search,
          status,
          sort,
          start: dates[0],
          end: dates[1],
          manufactureStart: manufactureDates[0],
          manufactureEnd: manufactureDates[1],
        })
        .then((v) => {
          if (live) {
            setEntries(v.rows);
            setTotal(v.total);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(errorText(e));
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, page, search, status, sort, dates, manufactureDates, refresh]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const update = (v: Partial<SnDraft>) => {
    if (active) return;
    setDraft((d) => ({ ...d, ...v }));
    setDirty(true);
  };
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      msg.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const v = await api.save(draft, revision);
    setRevision(v.revision);
    setDirty(false);
    setRefresh((n) => n + 1);
    return v.revision;
  };
  const showActive = async (id: string, action?: BatchAction) => {
    const v = await api.detail(id);
    const actionable = canWrite && !!v.batchRevision && v.status !== "retired" &&
      v.receivingStatus !== "received";
    setBatchAction(action && actionable ? { key: crypto.randomUUID(), action } : null);
    if (action && !actionable) {
      setRefresh((n) => n + 1);
      msg.warning(v.receivingStatus === "received" ? "此批次已入庫" : "批次狀態已變更，請重新確認");
    }
    setActive(v);
    setDraft({ ...v.data, id, version: 2, updatedAt: "" });
    setDirty(false);
    setCartonPage(1);
    setWarehouseFrom(1);
    setWarehouseTo(v.cartons);
    setFrom(isNoSerial(v.data) ? 1 : v.first!);
    setTo(
      isNoSerial(v.data)
        ? Math.min(v.cartons, 10000)
        : Math.min(v.last!, v.first! + 9999),
    );
    setTab("output");
  };
  const replace = (fn: () => void) => {
    if (dirty)
      modal.confirm({
        title: "捨棄尚未儲存的變更？",
        okText: "捨棄",
        cancelText: "取消",
        onOk: fn,
      });
    else fn();
  };
  const open = (e: Entry, action?: BatchAction) =>
    replace(() => {
      void run(async () => {
        if (e.status !== "draft") await showActive(e.id, action);
        else {
          setActive(null);
          setDraft({
            ...e.data,
            id: e.id,
            version: 2,
            updatedAt: e.updated_at,
          });
          setRevision(e.revision);
          setDirty(false);
          setTab("batch");
        }
      });
    });
  const create = () =>
    replace(() => {
      setDraft(newDraft(crypto.randomUUID()));
      setRevision(0);
      setActive(null);
      setDirty(false);
      setTab("batch");
    });
  const removeDraft = (entry: Entry) =>
    modal.confirm({
      title: `刪除草稿「${entry.data.name}」？`,
      content: "只刪除尚未啟用的草稿，不影響已配發序號與箱號。",
      okText: "刪除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () =>
        run(async () => {
          await api.remove(entry.id, entry.revision);
          if (!active && draft.id === entry.id) {
            setDraft(newDraft(crypto.randomUUID()));
            setRevision(0);
            setDirty(false);
          }
          setRefresh((n) => n + 1);
          msg.success("草稿已刪除");
        }),
    });
  const activate = () =>
    void run(async () => {
      if (!draft.name.trim()) throw new Error("請填寫批次名稱");
      const preview = await api.preview(draft);
      modal.confirm({
        title: noSerial ? "確認啟用無 SN 裝箱？" : "確認啟用並配發 SN？",
        content: noSerial
          ? `本次 ${draft.quantity} 件，共 ${preview.total} 箱；不產生單品 SN。`
          : `本次 ${draft.quantity} 個 SN，接續流水號 ${preview.first}～${preview.last}，共 ${preview.total} 箱。啟用後箱內 SN 固定。`,
        okText: noSerial ? "確認裝箱" : "確認配號",
        cancelText: "取消",
        onOk: () =>
          run(async () => {
            const r = dirty || !revision ? await save() : revision;
            try {
              const v = await api.activate(draft.id, r, preview.token);
              await showActive(v.batchId);
              msg.success("已啟用並完成裝箱");
            } finally {
              setRefresh((n) => n + 1);
            }
          }),
      });
    });
  const append = () => {
    if (!active || active.status === "retired" || active.review?.state === "pending") return;
    setDraft({
      ...active.data,
      id: crypto.randomUUID(),
      version: 2,
      updatedAt: "",
      quantity: 1,
    });
    setRevision(0);
    setActive(null);
    setDirty(true);
    setTab("batch");
    msg.info("請輸入本次追加數量；啟用後併入同日批次");
  };
  const canOutput = canWrite && active?.status !== "retired" && active?.review?.state !== "pending";
  const output = (kind: string) =>
    void run(async () => {
      if (!active || !canOutput) return;
      const warehouseCartons = kind === "warehouse-cartons";
      await api.export(active.id, {
        kind,
        from: warehouseCartons ? warehouseFrom : from,
        to: warehouseCartons ? warehouseTo : to,
        reason,
        columns,
      });
      setActive(await api.detail(active.id, cartonPage));
      msg.success(warehouseCartons ? "已下載箱號倉儲明細" : "已產生檔案；實際列印結果請核對");
    });
  const importLegacy = () =>
    void run(async () => {
      let count = 0;
      for (const d of localDrafts) {
        try {
          await api.save(d, 0);
          count++;
        } catch (e) {
          if (
            (e as { response?: { status?: number } }).response?.status !== 409
          )
            throw e;
        }
      }
      setRefresh((n) => n + 1);
      msg.success(`已匯入 ${count} 筆；既有伺服器草稿不覆寫，本機副本保留`);
    });
  const masterSave = () =>
    void run(async () => {
      const p = products.find((p) => p.id === draft.productId);
      if (!p && !newProduct) return;
      const values = await masterForm.validateFields();
      const updated = newProduct ? await productService.create(values) : await productService.updateSnProfile(p!.id, values);
      setProducts((rows) =>
        newProduct ? [...rows, updated] : rows.map((row) => (row.id === p!.id ? updated : row)),
      );
      update(productDefaults(updated));
      setMasterOpen(false);
      msg.success("產品 SN 建檔資料已儲存");
    });
  const dateField = (key: "orderDate" | "manufactureDate", label: string) => (
    <Form.Item label={label} required>
      <DatePicker
        aria-label={label}
        value={draft[key] ? dayjs(draft[key]) : null}
        onChange={(v) => update({ [key]: v?.format("YYYY-MM-DD") || "" })}
      />
    </Form.Item>
  );
  let sample = "",
    sampleError = "";
  try {
    sample = sampleSerial(draft);
  } catch (e) {
    sampleError = errorText(e);
  }
  const texts = (
    keys: (
      | "model"
      | "style"
      | "color"
      | "modelCode"
      | "styleCode"
      | "colorCode"
    )[],
    labels: string[],
  ) => (
    <div className="sn-field-triple">
      {keys.map((k, i) => (
        <Form.Item
          key={k}
          label={labels[i]}
          extra={k === "modelCode" ? "無SN.產品，請填入NSI" : undefined}
        >
          <Input
            aria-label={labels[i]}
            value={draft[k]}
            maxLength={k.endsWith("Code") ? 6 : 50}
            onChange={(e) =>
              update({
                [k]: k.endsWith("Code")
                  ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                  : e.target.value,
              })
            }
          />
        </Form.Item>
      ))}
    </div>
  );
  return (
    <div className="sn-workspace">
      {context}
      {modalContext}
      <header className="sn-heading">
        <div>
          <h1>SN 與標籤（試用）</h1>
          <p>試用序號以 TRY- 開頭。收貨後請在批次上標記「已入庫」。</p>
        </div>
        <Space wrap>
          <Tag color={active ? "green" : undefined}>
            {active ? active.status === "retired" ? "已退回"
              : active.receivingStatus === "received" ? "已入庫"
              : active.receivingStatus === "not-received" ? "尚未入庫"
              : active.receivingStatus === "unconfirmed" ? "入庫狀態待確認"
              : reviewStateText(active.review) || "已啟用"
              : dirty ? "尚未儲存" : "草稿"}
          </Tag>
          <Button onClick={create} disabled={busy}>
            新增草稿
          </Button>
          {active ? (
            <>
              {active.status !== "retired" && active.review?.state !== "pending" && (
                <Button onClick={append} disabled={!canWrite || busy}>
                  追加數量
                </Button>
              )}
              <BatchReviewControls
                key={batchAction?.key ?? active.id}
                active={active}
                api={api}
                canWrite={canWrite}
                disabled={busy}
                initialAction={batchAction?.action ?? null}
                onReceived={() => {
                  setActive(current => current?.id === active.id
                    ? { ...current, receivingStatus: "received" } : current);
                  setRefresh(n => n + 1);
                  msg.success("已標記入庫");
                  void run(async () => {
                    const detail = await api.detail(active.id, cartonPage);
                    setActive(current => current?.id === detail.id ? detail : current);
                  });
                }}
                onChange={(review) => {
                  setActive((current) => current?.id === active.id
                    ? { ...current, review, status: review.state === "approved" ? "retired" : current.status }
                    : current);
                  setRefresh((n) => n + 1);
                  if (review.state === "approved") {
                    setStatus("draft");
                    setPage(1);
                    if (pendingReviewRequested) {
                      const next = new URLSearchParams(query);
                      next.delete("status");
                      setQuery(next, { replace: true });
                    }
                    msg.success(`已退回，建立 ${review.replacementDraftIds.length} 份草稿`);
                  } else {
                    msg.warning("退回尚未完成，請重新載入批次");
                  }
                }}
              />
            </>
          ) : (
            <>
              <Button
                onClick={() =>
                  void run(async () => {
                    await save();
                    msg.success("已儲存至伺服器");
                  })
                }
                disabled={!canWrite || busy}
              >
                儲存草稿
              </Button>
              <Button
                type="primary"
                onClick={activate}
                loading={busy}
                disabled={!canWrite}
              >
                {noSerial ? "啟用裝箱" : "啟用配號"}
              </Button>
            </>
          )}
        </Space>
      </header>
      {!canWrite && (
        <Alert
          type="info"
          message="目前為唯讀權限；配號、建檔與匯出需庫存編輯權限。"
        />
      )}
      {active && (
        <Alert
          type={active.status === "retired" || active.review?.state === "pending" ? "info" : "success"}
          showIcon
          message={
            active.status === "retired"
              ? `已建立 ${active.review?.replacementDraftIds.length ?? 0} 份草稿，原箱號與序號保留。`
              : active.review?.state === "pending"
                ? `退回原因：${active.review.reason}`
                : noSerial
              ? `已建立 ${active.data.quantity} 件／${active.cartons} 箱，無單品 SN。`
              : `已配發 ${active.data.quantity} 個 SN／${active.cartons} 箱。漏印與破損補印沿用原 SN。`
          }
        />
      )}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "batch",
            label: "批次資料",
            children: (
              <section className="sn-panel">
                <Form
                  layout="vertical"
                  disabled={!!active || busy || !canWrite}
                >
                  <Form.Item label="批次名稱" required>
                    <Input
                      aria-label="批次名稱"
                      value={draft.name}
                      maxLength={100}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </Form.Item>
                  <Form.Item label="產品" required>
                    <Select
                      aria-label="產品"
                      showSearch
                      optionFilterProp="label"
                      value={draft.productId || undefined}
                      placeholder="搜尋商品、國際條碼、SKU 或型號"
                      options={products.map((p) => ({
                        value: p.id,
                        label: `${p.name} · ${p.barcode || ""} · ${p.sku} · ${p.modelNumber || ""}`,
                      }))}
                      onChange={(id) =>
                        void run(async () => {
                          const p = await productService.findOne(id);
                          setProducts((rows) =>
                            rows.map((row) => (row.id === p.id ? p : row)),
                          );
                          update(productDefaults(p));
                        })
                      }
                    />
                  </Form.Item>
                  {productError && (
                    <Alert
                      type="error"
                      message={`產品讀取失敗：${productError}`}
                    />
                  )}
                  <Space wrap>
                    <Tag>ERP SKU：{draft.sku || "—"}</Tag>
                    <Tag>{draft.barcode.startsWith("ITM-") ? "內部掃描碼" : "國際條碼"}：{draft.barcode || "—"}</Tag>
                    <Button onClick={() => { masterForm.resetFields(); setNewProduct(true); setMasterOpen(true); }}>新增品項</Button>
                    <Button
                      disabled={!draft.productId}
                      onClick={() => {
                        setNewProduct(false);
                        masterForm.setFieldsValue({
                          modelNumber: draft.model,
                          barcode: draft.barcode,
                          style: draft.style,
                          color: draft.color,
                          modelCode: draft.modelCode,
                          styleCode: draft.styleCode,
                          colorCode: draft.colorCode,
                        });
                        setMasterOpen(true);
                      }}
                    >
                      產品 SN 建檔
                    </Button>
                  </Space>
                  {texts(["model", "style", "color"], ["型號", "款式", "顏色"])}
                  <div className="sn-field-pair">
                    {dateField("orderDate", "下單日期")}
                    {dateField("manufactureDate", "製造日期")}
                  </div>
                  <div className="sn-field-pair">
                    <Form.Item
                      label={noSerial ? "本次產品數量" : "本次 SN 數量"}
                      required
                    >
                      <InputNumber
                        aria-label="SN 數量"
                        min={1}
                        max={10000}
                        value={draft.quantity}
                        onChange={(v) => v !== null && update({ quantity: v })}
                      />
                    </Form.Item>
                    <Form.Item label="每箱容量" required>
                      <InputNumber
                        aria-label="每箱容量"
                        min={1}
                        max={100}
                        value={draft.capacity}
                        onChange={(v) => update({ capacity: v })}
                      />
                    </Form.Item>
                  </div>
                </Form>
                <p className="sn-muted">
                  同日、同產品與同編碼組合會併入同一批次；追加另建箱號，已配箱內清單保持固定。
                </p>
              </section>
            ),
          },
          {
            key: "rules",
            label: "編碼規則",
            children: (
              <section className="sn-panel">
                <Form
                  layout="vertical"
                  disabled={!!active || busy || !canWrite}
                >
                  {texts(
                    ["modelCode", "styleCode", "colorCode"],
                    ["型號代碼", "款式代碼（選填）", "顏色代碼"],
                  )}
                </Form>
                <output className="sn-code-preview">
                  {sample || sampleError}
                </output>
                <p className="sn-muted">
                  上方為格式樣張。實際起號由伺服器交易決定。
                </p>
                <div className="sn-pending-list">
                  {CONFIRMED_RULES.map(([name, description]) => (
                    <div key={name}>
                      <strong>{name}</strong>
                      <span>{description}</span>
                    </div>
                  ))}
                </div>
              </section>
            ),
          },
          {
            key: "design",
            label: "標籤設計",
            children: (
              <section className="sn-panel">
                {active && (
                  <Alert
                    type="info"
                    message="此為啟用時的版面；正式檔案請從「配號與匯出」下載。"
                  />
                )}
                {noSerial ? (
                  <Alert
                    type="info"
                    message="NSI 無 SN 產品使用規格箱標籤，不產生單品序號標籤。"
                  />
                ) : (
                  <LabelDesigner
                    draft={draft}
                    onChange={(label) => update({ label })}
                  />
                )}
              </section>
            ),
          },
          {
            key: "cartons",
            label: "裝箱規劃",
            children: (
              <section className="sn-panel">
                <Form
                  layout="vertical"
                  disabled={!!active || busy || !canWrite}
                >
                  <Form.Item label="規格箱貼紙寬度 mm（60 × 75 等比縮放）">
                    <InputNumber
                      min={60}
                      max={120}
                      value={draft.cartonWidth || 60}
                      onChange={(v) =>
                        v && update({ cartonWidth: v, cartonHeight: v * 1.25 })
                      }
                    />
                  </Form.Item>
                </Form>
                {active ? (
                  <Button onClick={() => setTab("output")}>
                    查看實際箱號與箱內 SN
                  </Button>
                ) : (
                  <CartonPreview
                    key={`${JSON.stringify(draft)}:${refresh}`}
                    draft={draft}
                    entityId={entityId}
                  />
                )}
                <p className="sn-muted">
                  啟用後產生
                  CTN－下單日期－型號－箱序；正式箱內明細請見配號與匯出。
                </p>
              </section>
            ),
          },
          ...(active
            ? [
                {
                  key: "output",
                  label: "配號與匯出",
                  children: (
                    <section className="sn-panel">
                      <h2>
                        共 {active.data.quantity} {noSerial ? "件" : "個 SN"}／
                        {active.cartons} 箱
                      </h2>
                      <Space wrap>
                        <span>{noSerial ? "箱序範圍" : "流水號範圍"}</span>
                        <InputNumber
                          aria-label="匯出起號"
                          min={noSerial ? 1 : active.first!}
                          max={noSerial ? active.cartons : active.last!}
                          value={from}
                          onChange={(v) => v !== null && setFrom(v)}
                        />
                        <span>～</span>
                        <InputNumber
                          aria-label="匯出迄號"
                          min={from}
                          max={noSerial ? active.cartons : active.last!}
                          value={to}
                          onChange={(v) => v !== null && setTo(v)}
                        />
                        <Select
                          aria-label="輸出原因"
                          value={reason}
                          onChange={setReason}
                          options={[
                            { value: "initial", label: "首次輸出" },
                            { value: "missed", label: "漏印補印" },
                            { value: "damaged", label: "破損重印" },
                            { value: "copy", label: "另存副本" },
                          ]}
                        />
                      </Space>
                      <p className="sn-muted">
                        {noSerial
                          ? "依箱序選擇需要列印的箱號。"
                          : "每次最多輸出 10,000 個既有 SN；外箱 PDF 保留所選序號涉及之整箱內容。"}
                      </p>
                      <Space wrap>
                        {[
                          ["labels", "產品／彩盒 PDF"],
                          ["cartons", "規格箱 PDF"],
                          ["cartons-no-sn", "規格箱 PDF（無 SN）"],
                          ["warranty", "保固匯入 XLSX"],
                          ["warehouse", "倉儲 SN 明細 XLSX"],
                        ]
                          .filter(([k]) => !noSerial || k === "cartons-no-sn")
                          .map(([k, label]) => (
                            <Button
                              key={k}
                              disabled={!canOutput || busy}
                              onClick={() => output(k)}
                            >
                              {label}
                            </Button>
                          ))}
                      </Space>
                      <Space wrap style={{ marginTop: 12 }}>
                        <span>倉儲明細箱序</span>
                        <InputNumber
                          aria-label="倉儲明細起始箱序"
                          min={1}
                          max={active.cartons}
                          precision={0}
                          value={warehouseFrom}
                          onChange={(v) => {
                            if (v === null) return;
                            setWarehouseFrom(v);
                            setWarehouseTo((end) => Math.min(Math.max(end, v), active.cartons));
                          }}
                        />
                        <span>～</span>
                        <InputNumber
                          aria-label="倉儲明細結束箱序"
                          min={warehouseFrom}
                          max={active.cartons}
                          precision={0}
                          value={warehouseTo}
                          onChange={(v) => v !== null && setWarehouseTo(v)}
                        />
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setWarehouseFrom(1);
                            setWarehouseTo(active.cartons);
                          }}
                        >
                          選取全部箱號
                        </Button>
                        <Button
                          disabled={!canOutput || busy}
                          onClick={() => output("warehouse-cartons")}
                        >
                          箱號倉儲明細 XLSX
                        </Button>
                      </Space>
                      <p className="sn-muted">
                        預設匯出此批次全部 {active.cartons} 箱，也可指定箱序範圍。
                      </p>
                      <Form
                        layout="vertical"
                        style={{
                          marginTop: 16,
                          display: noSerial ? "none" : undefined,
                        }}
                      >
                        <Form.Item label="倉儲明細欄位">
                          <Select
                            mode="multiple"
                            value={columns}
                            onChange={setColumns}
                            options={[
                              "一般序號",
                              "SKU",
                              "國際條碼",
                              "ERP SKU",
                              "箱號",
                              "箱內順序",
                              "產品名稱",
                              "型號",
                              "款式",
                              "顏色",
                              "下單日期",
                              "製造日期",
                            ].map((value) => ({ value, label: value }))}
                          />
                        </Form.Item>
                      </Form>
                      <Alert
                        type="info"
                        message={
                          noSerial
                            ? "無 SN 產品只提供規格箱標籤，依所選箱序輸出；重印沿用原箱號。"
                            : "保固欄位為「一般序號、SKU」，SKU 使用國際條碼。倉儲檔為可設定的 SN 明細；不會自動入庫或建立出貨單。"
                        }
                      />
                      <Table
                        rowKey="id"
                        size="small"
                        pagination={false}
                        dataSource={active.boxes}
                        scroll={{ x: 650 }}
                        expandable={{
                          rowExpandable: (b) => b.serials.length > 0,
                          expandedRowRender: (b) => (
                            <div style={{ overflowWrap: "anywhere" }}>
                              {b.serials.join(" · ")}
                            </div>
                          ),
                        }}
                        columns={[
                          { title: "箱號", dataIndex: "id" },
                          { title: "數量", dataIndex: "quantity" },
                          {
                            title: "起號",
                            render: (_, b) => b.serials[0] || "—",
                          },
                          {
                            title: "迄號",
                            render: (_, b) => b.serials.at(-1) || "—",
                          },
                        ]}
                      />
                      <Pagination
                        current={cartonPage}
                        pageSize={20}
                        total={active.cartons}
                        showSizeChanger={false}
                        onChange={(p) =>
                          void run(async () => {
                            setActive(await api.detail(active.id, p));
                            setCartonPage(p);
                          })
                        }
                      />
                      <h2 className="sn-section-title">批次作業紀錄</h2>
                      <Table
                        rowKey={(_, i) => String(i)}
                        size="small"
                        dataSource={active.events}
                        pagination={{ pageSize: 5 }}
                        columns={[
                          {
                            title: "時間",
                            dataIndex: "created_at",
                            render: (v) => new Date(v).toLocaleString("zh-TW"),
                          },
                          {
                            title: "操作",
                            dataIndex: "action",
                            render: (v: string) => ({
                              ALLOCATE: "配號", EXPORT: "輸出", INBOUND_STATUS_RECORDED: "登記入庫狀態",
                              REVERT_REQUESTED: "申請退回", REVERT_REVIEWED: "審核退回",
                              REVERT_DRAFT_CREATED: "建立修改草稿", REVERT_RETURNED_TO_DRAFT: "退回修改",
                            })[v] ?? v,
                          },
                          {
                            title: "明細",
                            dataIndex: "data",
                            render: (v, event) => {
                              if (event.action === "INBOUND_STATUS_RECORDED")
                                return v.status === "received" ? "已入庫" : "尚未入庫";
                              if (event.action !== "ALLOCATE" && event.action !== "EXPORT")
                                return v.reason || "—";
                              return v.kind
                                ? `${({ labels: "產品標籤", cartons: "規格箱標籤", "cartons-no-sn": "規格箱（無 SN）", warranty: "保固匯入", warehouse: "倉儲明細" } as Record<string, string>)[String(v.kind)] || v.kind} · ${v.from}～${v.to} · ${v.reason === "missed" ? "漏印補印" : v.reason === "damaged" ? "破損重印" : v.reason === "copy" ? "副本" : "首次輸出"}`
                                : v.first === null
                                  ? `無 SN 裝箱，共 ${v.quantity} 件`
                                  : `${v.first}～${v.last}，共 ${v.quantity} 個`;
                            },
                          },
                        ]}
                      />
                    </section>
                  ),
                },
              ]
            : []),
        ]}
      />
      <section className="sn-panel sn-saved">
        <h2 ref={batchListHeading} tabIndex={-1}>批次查詢</h2>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            aria-label="搜尋批次"
            placeholder="商品、國際條碼、型號或批次名稱"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Select
            aria-label="批次狀態"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
              if (pendingReviewRequested && v !== "pending-review") {
                const next = new URLSearchParams(query);
                next.delete("status");
                setQuery(next, { replace: true });
              }
            }}
            options={[
              { value: "", label: "全部狀態" },
              { value: "draft", label: "草稿" },
              { value: "active", label: "已啟用" },
              { value: "pending-review", label: "舊退回申請" },
              { value: "retired", label: "已退回" },
            ]}
          />
          <DatePicker.RangePicker
            aria-label="下單日期篩選"
            placeholder={["下單日期起", "下單日期迄"]}
            value={dates.length === 2 ? [dayjs(dates[0]), dayjs(dates[1])] : null}
            onChange={(v) => {
              setDates(v?.map((d) => d?.format("YYYY-MM-DD") || "") || []);
              setPage(1);
            }}
          />
          <DatePicker.RangePicker
            aria-label="製造日期篩選"
            placeholder={["製造日期起", "製造日期迄"]}
            value={manufactureDates.length === 2
              ? [dayjs(manufactureDates[0]), dayjs(manufactureDates[1])] : null}
            onChange={(v) => {
              setManufactureDates(
                v?.map((d) => d?.format("YYYY-MM-DD") || "") || [],
              );
              setPage(1);
            }}
          />
          <Select
            aria-label="日期排序"
            value={sort}
            onChange={setSort}
            options={[
              { value: "desc", label: "下單日期新到舊" },
              { value: "asc", label: "下單日期舊到新" },
            ]}
          />
          <Button onClick={() => setRefresh((n) => n + 1)}>重新整理</Button>
        </Space>
        {error && <Alert type="error" message={error} />}
        <Table
          rowKey="id"
          size="small"
          dataSource={entries}
          scroll={{ x: 650 }}
          pagination={{
            current: page,
            total,
            pageSize: 30,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            { title: "批次", render: (_, e) => e.data.name },
            { title: "商品", render: (_, e) => e.data.productName },
            { title: "掃描碼", render: (_, e) => e.data.barcode },
            { title: "下單日期", render: (_, e) => e.data.orderDate },
            { title: "製造日期", render: (_, e) => e.data.manufactureDate },
            { title: "數量", render: (_, e) => e.data.quantity },
            {
              title: "入庫狀態",
              render: (_, e) => e.status === "draft" || e.status === "retired" ? "—"
                : e.receivingStatus === "received" ? "已入庫"
                : e.receivingStatus === "not-received" ? "尚未入庫" : "待確認",
            },
            {
              title: "狀態",
              render: (_, e) => (
                <Tag color={e.pending_review_requested_by ? "gold" : e.status === "active" ? "green" : undefined}>
                  {e.pending_review_requested_by
                    ? "待退回處理"
                    : e.status === "active" ? "已啟用" : e.status === "retired" ? "已退回" : "草稿"}
                </Tag>
              ),
            },
            {
              title: "操作",
              render: (_, e) => {
                const canChange = canWrite && e.status === "active" && e.receivingStatus !== "received";
                return (
                  <Space>
                    <Button size="small" disabled={busy} onClick={() => open(e)}>開啟</Button>
                    {canChange && <>
                      <Button size="small" disabled={busy} onClick={() => open(e, "receive")}>標記已入庫</Button>
                      <Button size="small" disabled={busy} onClick={() => open(e, "return")}>退回修改</Button>
                    </>}
                    {e.status === "draft" && canWrite && (
                      <Button
                        danger
                        size="small"
                        disabled={busy}
                        onClick={() => removeDraft(e)}
                      >
                        刪除草稿
                      </Button>
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
        {!!localDrafts.length && (
          <Button disabled={busy || !canWrite} onClick={importLegacy}>
            匯入此瀏覽器舊草稿（{localDrafts.length}）
          </Button>
        )}
      </section>
      <Modal
        title={newProduct ? "新增試用品項" : "產品 SN 建檔"}
        open={masterOpen}
        onCancel={() => setMasterOpen(false)}
        onOk={masterSave}
        confirmLoading={busy}
      >
        <Form form={masterForm} layout="vertical">
          {newProduct && <>
            <Form.Item name="sku" label="ECOUNT 品號" rules={[{required:true,whitespace:true}]}><Input maxLength={120}/></Form.Item>
            <Form.Item name="name" label="品名" rules={[{required:true,whitespace:true}]}><Input maxLength={200}/></Form.Item>
          </>}
          <Form.Item
            name="barcode"
            label="國際條碼或內部掃描碼"
            rules={[
              { required: true, message: "請填寫國際條碼或內部掃描碼" },
              { pattern: /^(?:\d{8,14}|ITM-[A-Za-z0-9_-]{1,80})$/, message: "請填國際條碼或 ITM- 開頭的內部掃描碼" },
            ]}
          >
            <Input maxLength={84} />
          </Form.Item>
          {[
            ["modelNumber", "型號"],
            ["style", "款式"],
            ["color", "顏色"],
            ["modelCode", "型號代碼"],
            ["styleCode", "款式代碼（選填）"],
            ["colorCode", "顏色代碼"],
          ].map(([key, label]) => (
            <Form.Item
              key={key}
              name={key}
              label={label}
              extra={key === "modelCode" ? "無SN.產品，請填入NSI" : undefined}
            >
              <Input maxLength={key.endsWith("Code") ? 6 : 50} />
            </Form.Item>
          ))}
        </Form>
        <p>儲存在產品資料，之後選取產品會自動帶入。</p>
      </Modal>
    </div>
  );
}
