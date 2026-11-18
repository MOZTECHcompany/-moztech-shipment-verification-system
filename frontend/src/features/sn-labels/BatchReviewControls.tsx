import { useRef, useState } from "react";
import { Alert, Button, Checkbox, Form, Input, Modal } from "antd";
import { errorText } from "./api";
import type { BatchReview, Detail, snApi } from "./api";

export type BatchAction = "return" | "receive";
type ReturnFields = { reason: string; confirmNotReceived?: boolean };

export default function BatchReviewControls({
  active,
  api,
  canWrite,
  disabled,
  initialAction,
  onChange,
  onReceived,
}: {
  active: Detail;
  api: ReturnType<typeof snApi>;
  canWrite: boolean;
  disabled: boolean;
  initialAction: BatchAction | null;
  onChange: (review: BatchReview) => void;
  onReceived: () => void;
}) {
  const [form] = Form.useForm<ReturnFields>();
  const [action, setAction] = useState(initialAction),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  const revision = active.batchRevision;
  if (!canWrite || !revision || active.status === "retired") return null;
  if (active.receivingStatus === "received") return <Button disabled>已入庫，不可退回</Button>;

  const needsConfirmation = active.receivingStatus !== "not-received";
  const openModal = (next: BatchAction) => {
    form.resetFields();
    setError("");
    setAction(next);
  };
  const submit = async () => {
    if (!action || submitting.current || disabled) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      if (action === "receive") {
        const result = await api.markReceived(active.id, revision);
        if (result.batchId !== active.id || result.receivingStatus !== "received")
          throw new Error("入庫狀態尚未確認，請重新載入批次");
        onReceived();
      } else {
        let values: ReturnFields;
        try {
          values = await form.validateFields();
        } catch {
          return;
        }
        const result = await api.requestReversion(active.id, revision, values.reason.trim(),
          needsConfirmation && values.confirmNotReceived ? true : undefined);
        if (result.state !== "approved") throw new Error("退回尚未完成，請重新載入批次");
        onChange(result);
      }
      setAction(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  return (
    <>
      <Button onClick={() => openModal("receive")} disabled={disabled}>標記已入庫</Button>
      <Button onClick={() => openModal("return")} disabled={disabled}>退回修改</Button>
      <Modal
        title={action === "receive" ? "標記已入庫" : "退回修改"}
        open={action !== null}
        onCancel={() => { if (!submitting.current) setAction(null); }}
        onOk={() => void submit()}
        okText={action === "receive" ? "確認已入庫" : "確認退回"}
        cancelText="取消"
        confirmLoading={saving}
        forceRender
      >
        <p>{active.data.name} · {active.cartons} 箱 · {active.data.quantity} 件</p>
        {error && <Alert type="error" message={error} showIcon />}
        {action === "receive" && <p>確認這個批次已入庫？標記後就無法退回修改。</p>}
        <Form form={form} layout="vertical" disabled={saving} hidden={action !== "return"}
          initialValues={{ reason: active.review?.state === "pending" ? active.review.reason : "", confirmNotReceived: false }}>
          {needsConfirmation && (
            <Form.Item name="confirmNotReceived" valuePropName="checked"
              rules={[{ validator: (_, confirmed) => confirmed === true
                ? Promise.resolve() : Promise.reject(new Error("請先核對此批次尚未入庫")) }]}>
              <Checkbox>我已核對 ECOUNT 進貨單，確認此批次尚未入庫</Checkbox>
            </Form.Item>
          )}
          <Form.Item name="reason" label="退回原因"
            rules={[{ required: true, whitespace: true, message: "請填寫退回原因" }]}>
            <Input.TextArea rows={3} maxLength={400} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
