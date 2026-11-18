import { useEffect, useMemo, useState } from "react";
import { Alert, Button, List, Modal, Table } from "antd";
import { errorText, snApi } from "./api";
import type { AllocationPreview } from "./api";
import type { SnDraft } from "./model";

export default function CartonPreview({
  draft,
  entityId,
}: {
  draft: SnDraft;
  entityId: string;
}) {
  const api = useMemo(() => snApi(entityId), [entityId]);
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    value: AllocationPreview;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [selected, setSelected] = useState<
    AllocationPreview["rows"][number] | null
  >(null);
  const key = JSON.stringify([draft, page, refresh]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api
        .preview(draft, page)
        .then((value) => {
          if (live) {
            setResult({ key, value });
            setFailure(null);
          }
        })
        .catch((e) => {
          if (live) setFailure({ key, message: errorText(e) });
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, draft, page, key]);
  useEffect(() => {
    // Keep the currently inspected carton stable until the user closes its list.
    if (selected) return;
    const update = () => {
      setSelected(null);
      setRefresh((n) => n + 1);
    };
    window.addEventListener("focus", update);
    const interval = window.setInterval(update, 30000);
    return () => {
      window.removeEventListener("focus", update);
      clearInterval(interval);
    };
  }, [selected]);
  const value = result?.key === key ? result.value : null;
  const error = failure?.key === key ? failure.message : "";
  return (
    <>
      <Alert
        type={error ? "warning" : "info"}
        showIcon
        message={
          error ||
          (value
            ? value.noSerial
              ? "NSI 無 SN 產品：只建立箱號與數量，不配發單品序號。"
              : `目前可接續流水號 ${value.first}～${value.last}，未占用號碼。啟用前會再次核對。`
            : "正在讀取目前可配號碼…")
        }
      />
      <Button
        style={{ margin: "12px 0" }}
        onClick={() => {
          setSelected(null);
          setRefresh((n) => n + 1);
        }}
      >
        更新裝箱預覽
      </Button>
      <Table
        size="small"
        rowKey="id"
        loading={!value && !error}
        dataSource={value?.rows || []}
        scroll={{ x: 700 }}
        pagination={{
          current: page,
          pageSize: 10,
          total: value?.total || 0,
          showSizeChanger: false,
          onChange: (p) => {
            setPage(p);
            setSelected(null);
          },
        }}
        columns={[
          { title: "預計箱號", dataIndex: "id" },
          { title: "實際數量", dataIndex: "quantity" },
          ...(!value?.noSerial
            ? [
                {
                  title: "起始 SN",
                  render: (_: unknown, c: AllocationPreview["rows"][number]) =>
                    c.serials[0],
                },
                {
                  title: "結束 SN",
                  render: (_: unknown, c: AllocationPreview["rows"][number]) =>
                    c.serials.at(-1),
                },
                {
                  title: "箱內清單",
                  render: (
                    _: unknown,
                    c: AllocationPreview["rows"][number],
                  ) => (
                    <Button size="small" onClick={() => setSelected(c)}>
                      查看序號
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal
        title={
          selected ? `${selected.id} · ${selected.quantity} 件（預覽）` : ""
        }
        open={!!selected && !!value}
        onCancel={() => setSelected(null)}
        footer={null}
      >
        <List
          size="small"
          pagination={{ pageSize: 20 }}
          dataSource={selected?.serials || []}
          renderItem={(sn) => (
            <List.Item>
              <code>{sn}</code>
            </List.Item>
          )}
        />
      </Modal>
    </>
  );
}
