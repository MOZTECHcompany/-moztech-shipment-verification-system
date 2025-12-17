import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, PageHeader, Skeleton, SkeletonText } from '@/ui';

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

export function TeamBoard({ user }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const canCreate = useMemo(() => {
    const r = String(user?.role || '').toLowerCase();
    return r === 'admin' || r === 'superadmin' || r === 'dispatcher';
  }, [user]);

  const [showCreate, setShowCreate] = useState(false);
  const [postType, setPostType] = useState('task');
  const [priority, setPriority] = useState('normal');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchList = useCallback(async (opts = { silent: false }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const res = await apiClient.get('/api/team/posts?limit=50&page=1');
      setItems(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch (err) {
      toast.error('取得公告板失敗', { description: err?.response?.data?.message || err.message || '請稍後再試' });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList({ silent: false });
  }, [fetchList]);

  useEffect(() => {
    const onChanged = () => {
      fetchList({ silent: true });
    };
    socket.on('team_post_changed', onChanged);
    return () => {
      socket.off('team_post_changed', onChanged);
    };
  }, [fetchList]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchList({ silent: false });
    setRefreshing(false);
  };

  const submitCreate = async () => {
    if (!canCreate) return;
    const safeTitle = String(title || '').trim();
    const safeContent = String(content || '').trim();
    if (!safeTitle) return toast.error('請輸入標題');
    if (!safeContent) return toast.error('請輸入內容');

    setSubmitting(true);
    try {
      await apiClient.post('/api/team/posts', {
        postType,
        title: safeTitle,
        content: safeContent,
        priority,
      });
      toast.success('已建立交辦');
      setTitle('');
      setContent('');
      setPostType('task');
      setPriority('normal');
      setShowCreate(false);
      await fetchList({ silent: false });
    } catch (err) {
      toast.error('建立失敗', { description: err?.response?.data?.message || err.message || '請稍後再試' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="公告板"
        description="團隊交辦與進度留言（不影響訂單內討論）"
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              leadingIcon={RefreshCw}
              className="rounded-full"
              disabled={refreshing}
            >
              重新整理
            </Button>
            {canCreate && (
              <Button
                size="sm"
                leadingIcon={Plus}
                className="rounded-full"
                onClick={() => setShowCreate((v) => !v)}
              >
                新增交辦
              </Button>
            )}
          </>
        }
      />

      {canCreate && showCreate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>新增交辦/公告</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                <label className="block text-sm font-semibold text-gray-700 mb-2.5">類型</label>
                <select
                  value={postType}
                  onChange={(e) => setPostType(e.target.value)}
                  className="w-full font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-4 focus:bg-white focus:border-primary/50 focus:ring-4 focus:ring-primary/10 focus:shadow-lg"
                >
                  <option value="task">交辦</option>
                  <option value="announcement">公告</option>
                </select>
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-semibold text-gray-700 mb-2.5">優先級</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-4 focus:bg-white focus:border-primary/50 focus:ring-4 focus:ring-primary/10 focus:shadow-lg"
                >
                  <option value="normal">一般</option>
                  <option value="important">重要</option>
                  <option value="urgent">緊急</option>
                </select>
              </div>
              <div className="md:col-span-3">
                <Input
                  label="標題"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：今天要出貨：產品 XXX * 10，地址…"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-sm font-semibold text-gray-700 mb-2.5">內容</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="請輸入交辦內容與需求（產品、數量、地址、注意事項…）"
                  className="w-full min-h-[140px] font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-4 placeholder-gray-400 text-gray-900 focus:bg-white focus:border-primary/50 focus:ring-4 focus:ring-primary/10 focus:shadow-lg resize-y"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setShowCreate(false)}
                className="rounded-full"
                disabled={submitting}
              >
                取消
              </Button>
              <Button onClick={submitCreate} className="rounded-full" disabled={submitting}>
                {submitting ? '送出中…' : '送出'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="目前沒有交辦/公告"
          description={canCreate ? '可以先新增一則交辦讓大家回報進度。' : '等待管理員發布交辦/公告。'}
          action={canCreate ? '新增交辦' : null}
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="space-y-4">
          {items.map((p) => (
            <Card key={p.id} className="hover:shadow-apple-md transition-shadow">
              <CardContent className="py-5">
                <div className="flex flex-col md:flex-row md:items-start gap-4 justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge variant="neutral">{postTypeLabel(p.post_type)}</Badge>
                      <Badge variant="neutral">{statusLabel(p.status)}</Badge>
                      <Badge variant="neutral">{priorityLabel(p.priority)}</Badge>
                      <Badge variant="neutral">留言 {p.comment_count || 0}</Badge>
                    </div>

                    <Link to={`/team/${p.id}`} className="block">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">{p.title}</h3>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{p.content}</p>
                    </Link>

                    <div className="text-xs text-gray-500 mt-2 font-medium">
                      {p.created_by_name ? `建立者：${p.created_by_name}` : ''}
                      {p.created_at ? ` · ${formatTs(p.created_at)}` : ''}
                    </div>
                  </div>

                  <div className="flex-shrink-0">
                    <Button as={Link} to={`/team/${p.id}`} variant="secondary" size="sm" className="rounded-full">
                      查看
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 小型註記：避免混淆 */}
      <div className="mt-6 text-xs text-gray-500 font-medium">
        提醒：這裡是「團隊公告/交辦」；訂單內討論仍在各訂單頁面。
      </div>
    </div>
  );
}

export default TeamBoard;
