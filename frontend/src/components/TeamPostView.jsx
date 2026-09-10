import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { ArrowLeft, MessageSquare, Paperclip } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, Skeleton } from '@/ui';

function formatTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-TW', { hour12: false });
}

function postTypeLabel(t) {
  return t === 'task' ? '交辦' : '公告';
}

function statusLabel(s) {
  if (s === 'open') return '未處理';
  if (s === 'in_progress') return '處理中';
  if (s === 'done') return '已完成';
  if (s === 'closed') return '已關閉';
  return s || '';
}

function priorityLabel(p) {
  if (p === 'urgent') return '緊急';
  if (p === 'important') return '重要';
  return '一般';
}

export function TeamPostView({ user }) {
  const { postId } = useParams();
  const navigate = useNavigate();

  const id = useMemo(() => {
    const n = parseInt(String(postId || ''), 10);
    return Number.isFinite(n) ? n : null;
  }, [postId]);

  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const fileInputRef = useRef(null);

  const canChangeStatus = useMemo(() => {
    if (!user || !item) return false;
    const r = String(user?.role || '').toLowerCase();
    if (r === 'admin' || r === 'superadmin') return true;
    if (Number(item.created_by) === Number(user.id)) return true;
    if (Array.isArray(item.assignees) && item.assignees.some((a) => Number(a?.id) === Number(user.id))) return true;
    return false;
  }, [user, item]);

  const fetchDetail = useCallback(async (opts = { silent: false }) => {
    if (!id) return;
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const res = await apiClient.get(`/api/team/posts/${id}`);
      setItem(res?.data?.item || null);
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || '請稍後再試';
      toast.error('取得交辦詳情失敗', { description: msg });
      if (err?.response?.status === 404) {
        navigate('/team');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchDetail({ silent: false });
  }, [fetchDetail]);

  useEffect(() => {
    const onChanged = (payload) => {
      if (!payload || Number(payload.postId) !== Number(id)) return;
      fetchDetail({ silent: true });
    };
    socket.on('team_post_changed', onChanged);
    return () => socket.off('team_post_changed', onChanged);
  }, [fetchDetail, id]);

  const sendComment = async () => {
    if (!id) return;
    const content = String(comment || '').trim();
    if (!content) return toast.error('請輸入留言內容');

    setSending(true);
    try {
      await apiClient.post(`/api/team/posts/${id}/comments`, { content });
      setComment('');
      await fetchDetail({ silent: false });
    } catch (err) {
      toast.error('留言失敗', { description: err?.response?.data?.message || err.message || '請稍後再試' });
    } finally {
      setSending(false);
    }
  };

  const uploadAttachments = async () => {
    if (!id) return;
    const input = fileInputRef.current;
    const files = Array.from(input?.files || []);
    if (!files.length) return toast.error('請先選擇附件');

    setUploading(true);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));
      await apiClient.post(
        `/api/team/posts/${id}/attachments`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      toast.success('附件已上傳');
      if (input) input.value = '';
      await fetchDetail({ silent: false });
    } catch (err) {
      toast.error('上傳附件失敗', { description: err?.response?.data?.message || err.message || '請稍後再試' });
    } finally {
      setUploading(false);
    }
  };

  const previewAttachment = async (att) => {
    if (!id || !att?.id) return;
    setDownloadingId(att.id);
    try {
      const res = await apiClient.get(
        `/api/team/posts/${id}/attachments/${att.id}/download?inline=1`,
        { responseType: 'blob' }
      );
      const blob = new Blob([res.data], { type: att.mime_type || 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      // 讓瀏覽器有時間取用，延遲釋放
      setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error('預覽附件失敗', { description: err?.response?.data?.message || err.message || '請稍後再試' });
    } finally {
      setDownloadingId(null);
    }
  };

  const downloadAttachment = async (att) => {
    if (!id || !att?.id) return;
    setDownloadingId(att.id);
    try {
      const res = await apiClient.get(
        `/api/team/posts/${id}/attachments/${att.id}/download`,
        { responseType: 'blob' }
      );
      const blob = new Blob([res.data], { type: att.mime_type || 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.original_name || `attachment-${att.id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('下載附件失敗', { description: err?.response?.data?.message || err.message || '請稍後再試' });
    } finally {
      setDownloadingId(null);
    }
  };

  const changeStatus = async (next) => {
    if (!id) return;
    try {
      await apiClient.patch(`/api/team/posts/${id}/status`, { status: next });
      await fetchDetail({ silent: false });
      toast.success('已更新狀態');
    } catch (err) {
      toast.error('更新狀態失敗', { description: err?.response?.data?.message || err.message || '請稍後再試' });
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }

  if (!item) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="找不到交辦"
        description="可能已被刪除或你沒有權限查看。"
        action="回公告板"
        onAction={() => navigate('/team')}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={item.title}
        description={item.created_by_name ? `建立者：${item.created_by_name}${item.created_at ? ` · ${formatTs(item.created_at)}` : ''}` : ''}
        backButton={
          <Button as={Link} to="/team" variant="secondary" size="sm" leadingIcon={ArrowLeft} className="rounded-full">
            回公告板
          </Button>
        }
        actions={
          canChangeStatus ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="rounded-full" onClick={() => changeStatus('open')}>未處理</Button>
              <Button variant="secondary" size="sm" className="rounded-full" onClick={() => changeStatus('in_progress')}>處理中</Button>
              <Button variant="secondary" size="sm" className="rounded-full" onClick={() => changeStatus('done')}>已完成</Button>
              <Button variant="secondary" size="sm" className="rounded-full" onClick={() => changeStatus('closed')}>已關閉</Button>
            </div>
          ) : null
        }
      />

      <Card className="mb-4">
        <CardContent className="py-5">
          <div className="flex flex-wrap gap-2 mb-3">
            <Badge variant="neutral">{postTypeLabel(item.post_type)}</Badge>
            <Badge variant="neutral">{statusLabel(item.status)}</Badge>
            <Badge variant="neutral">{priorityLabel(item.priority)}</Badge>
            {item.due_at ? <Badge variant="neutral">期限：{formatTs(item.due_at)}</Badge> : null}
          </div>
          {item.post_type === 'task' && Array.isArray(item.assignees) && item.assignees.length > 0 ? (
            <div className="text-xs text-gray-600 font-medium mb-3">
              指派：{item.assignees.map((a) => a?.name || `User #${a?.id}`).join('、')}
            </div>
          ) : null}
          <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{item.content}</div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>附件</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
            <div className="text-sm text-gray-600 font-medium">
              支援 jpg/png/webp/pdf（最多 5 個、每個 10MB）
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="text-sm"
                disabled={uploading}
              />
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full"
                onClick={uploadAttachments}
                leadingIcon={Paperclip}
                disabled={uploading}
              >
                {uploading ? '上傳中…' : '上傳附件'}
              </Button>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {(item.attachments || []).length === 0 ? (
              <div className="text-sm text-gray-500 font-medium">目前尚無附件。</div>
            ) : (
              (item.attachments || []).map((att) => (
                <div key={att.id} className="bg-white/50 border border-gray-100 rounded-2xl px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{att.original_name || `attachment-${att.id}`}</div>
                    <div className="text-xs text-gray-500 font-medium mt-1">
                      {att.mime_type || '檔案'}{att.size_bytes ? ` · ${Math.round(att.size_bytes / 1024)} KB` : ''}{att.uploaded_at ? ` · ${formatTs(att.uploaded_at)}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="rounded-full"
                      onClick={() => previewAttachment(att)}
                      disabled={downloadingId === att.id}
                    >
                      預覽
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="rounded-full"
                      onClick={() => downloadAttachment(att)}
                      disabled={downloadingId === att.id}
                    >
                      下載
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>留言回報</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(item.comments || []).length === 0 ? (
              <div className="text-sm text-gray-500 font-medium">目前尚無留言。</div>
            ) : (
              (item.comments || []).map((c) => (
                <div key={c.id} className="bg-white/50 border border-gray-100 rounded-2xl px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-gray-900">{c.user_name || `User #${c.user_id}`}</div>
                    <div className="text-xs text-gray-500 font-medium">{formatTs(c.created_at)}</div>
                  </div>
                  <div className="text-sm text-gray-800 mt-2 whitespace-pre-wrap">{c.content}</div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2.5">新增留言</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="回報進度或補充資訊…"
              className="w-full min-h-[110px] font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-4 placeholder-gray-400 text-gray-900 focus:bg-white focus:border-primary/50 focus:ring-4 focus:ring-primary/10 focus:shadow-lg resize-y"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  sendComment();
                }
              }}
            />
            <div className="mt-3 flex justify-end">
              <Button onClick={sendComment} className="rounded-full" disabled={sending}>
                {sending ? '送出中…' : '送出留言'}
              </Button>
            </div>
            <div className="mt-2 text-xs text-gray-500 font-medium">提示：按 Ctrl/⌘ + Enter 也可送出。</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default TeamPostView;
