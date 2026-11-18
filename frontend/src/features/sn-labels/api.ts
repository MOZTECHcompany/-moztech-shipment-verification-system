import api from "../../api/api";
import type { SnDraft } from "./model";
export type ReceivingStatus = "not-received" | "received" | "unconfirmed";
export type Entry = {
  id: string;
  status: "draft" | "active" | "retired";
  revision: number;
  data: SnDraft;
  updated_at: string;
  pending_review_requested_by?: string | null;
  receivingStatus?: ReceivingStatus;
};
export type AllocationPreview = {
  first: number | null;
  last: number | null;
  noSerial: boolean;
  token: string;
  total: number;
  checkedAt: string;
  rows: { id: string; ordinal: number; quantity: number; serials: string[] }[];
};
export type Detail = {
  id: string;
  status?: "active" | "retired";
  batchRevision?: string;
  review?: BatchReview | null;
  receivingStatus?: ReceivingStatus;
  data: SnDraft;
  first: number | null;
  last: number | null;
  cartons: number;
  boxes: { id: string; ordinal: number; quantity: number; serials: string[] }[];
  events: {
    action: string;
    actor_id: string;
    created_at: string;
    data: Record<string, unknown>;
  }[];
};
export type BatchReview = {
  id: string;
  state: "pending" | "approved" | "rejected" | "blocked";
  requestedBy: string;
  reason: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  blocker: "ECOUNT_RECEIVED" | "ERP_SERIAL_IN_USE" | "WMS_USED" | "PHYSICAL_USED" | null;
  replacementDraftIds: string[];
};
const blockerText = {
  ECOUNT_RECEIVED: "已有 ECOUNT 進貨紀錄",
  ERP_SERIAL_IN_USE: "序號已有庫存使用紀錄",
  WMS_USED: "已有 WMS 使用紀錄",
  PHYSICAL_USED: "已有實物使用紀錄",
};
export const reviewStateText = (review?: BatchReview | null) =>
  review?.state === "pending"
    ? "待退回處理"
    : review?.state === "approved"
      ? "已退回"
      : review?.state === "blocked"
        ? (review.blocker ? blockerText[review.blocker] : "不可退回")
        : review?.state === "rejected"
          ? "退回申請已駁回"
          : "";
export const snApi = (entityId: string) => ({
  list: async (query: Record<string, unknown>) =>
    (
      await api.get<{ rows: Entry[]; total: number }>("/api/sn-labels", {
        params: { ...query, entityId },
      })
    ).data,
  save: async (d: SnDraft, revision: number) =>
    (
      await api.put<{ id: string; revision: number; data: SnDraft }>(
        `/api/sn-labels/drafts/${d.id}`,
        { data: d, revision },
        { params: { entityId } },
      )
    ).data,
  preview: async (data: SnDraft, page = 1) =>
    (
      await api.post<AllocationPreview>(
        "/api/sn-labels/preview",
        { data, page },
        { params: { entityId } },
      )
    ).data,
  remove: async (id: string, revision: number) =>
    (
      await api.delete(`/api/sn-labels/drafts/${id}`, {
        data: { revision },
        params: { entityId },
      })
    ).data,
  activate: async (id: string, revision: number, previewToken: string) =>
    (
      await api.post<{ batchId: string }>(
        `/api/sn-labels/drafts/${id}/activate`,
        { revision, previewToken },
        { params: { entityId } },
      )
    ).data,
  detail: async (id: string, page = 1) =>
    (
      await api.get<Detail>(`/api/sn-labels/batches/${id}`, {
        params: { entityId, page },
      })
    ).data,
  export: async (id: string, body: Record<string, unknown>) => {
    try {
      const res = await api.post(`/api/sn-labels/batches/${id}/export`, body, {
        params: { entityId },
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SN-${body.kind}-${id}.${["warranty", "warehouse", "warehouse-cartons"].includes(String(body.kind)) ? "xlsx" : "pdf"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e: unknown) {
      const data = (e as { response?: { data?: Blob } }).response?.data;
      if (data instanceof Blob) {
        try {
          throw new Error(JSON.parse(await data.text()).message);
        } catch (parsed) {
          if (parsed instanceof SyntaxError) throw e;
          throw parsed;
        }
      }
      throw e;
    }
  },
  markReceived: async (id: string, batchRevision: string) =>
    (
      await api.post<{ batchId: string; receivingStatus: "received" }>(
        `/api/sn-labels/batches/${id}/mark-received`,
        { batchRevision },
        { params: { entityId } },
      )
    ).data,
  requestReversion: async (id: string, batchRevision: string, reason: string, confirmNotReceived?: true) =>
    (
      await api.post<BatchReview>(
        `/api/sn-labels/batches/${id}/reversion`,
        { batchRevision, reason, ...(confirmNotReceived && { confirmNotReceived }) },
        { params: { entityId } },
      )
    ).data,
});
export function errorText(e: unknown) {
  const v = e as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const m = v.response?.data?.message || v.message || "操作失敗，請稍後重試";
  return Array.isArray(m) ? m.join("、") : m;
}
export function productDefaults(p: {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  modelNumber?: string;
  attributes?: Record<string, unknown>;
}) {
  const v = (p.attributes?.snLabels || {}) as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === "string" ? String(v[k]) : "");
  return {
    productId: p.id,
    productName: p.name,
    sku: p.sku,
    barcode: p.barcode || "",
    model: p.modelNumber || "",
    style: str("style"),
    color: str("color"),
    modelCode: str("modelCode").toUpperCase(),
    styleCode: str("styleCode").toUpperCase(),
    colorCode: str("colorCode").toUpperCase(),
  };
}
