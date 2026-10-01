import React, {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {AlertTriangle, Volume2} from 'lucide-react';
import {toast} from 'sonner';
import apiClient from '@/api/api';
import {socket} from '@/api/socket';
import soundNotification from '@/utils/soundNotification';
import {formatMessageTimestamp} from '@/utils/messageTimestamp';

export default function OrderReviewAlerts({user}) {
    const [summary,setSummary] = useState({items:[],total:0,canReview:false});
    const [inbox,setInbox] = useState({items:[],total:0});
    const [failed,setFailed] = useState(false);
    const [expanded,setExpanded] = useState(false);
    const [showNotices,setShowNotices] = useState(true);
    const [soundBlocked,setSoundBlocked] = useState(false);
    const [confirming,setConfirming] = useState(false);
    const [refreshVersion,setRefreshVersion] = useState(0);
    // Kept across refreshes and route changes; one alarm per newly observed batch.
    const [seen] = useState(() => new Set());
    useEffect(()=>{
        let alive=true, fetching=false, queued=false;
        const refresh=async()=>{
            if(fetching){queued=true;return;}
            fetching=true;
            try {
                const [review,notices]=await Promise.all([apiClient.get('/api/order-reviews'),apiClient.get('/api/order-change-notices')]);
                if(!alive)return;
                setSummary(review.data);setInbox(notices.data);setFailed(false);
                const fresh=notices.data.items.filter(item=>!seen.has(item.id));
                if(fresh.length){
                    fresh.forEach(item=>seen.add(item.id));
                    setShowNotices(true);
                    soundNotification.setUser(user?.id);
                    const played=await soundNotification.play('orderChange');
                    if(alive)setSoundBlocked(!played);
                }
            } catch {if(alive)setFailed(true);}
            finally {fetching=false;if(queued&&alive){queued=false;void refresh();}}
        };
        const notice=data=>{if(data?.recipientUserIds?.includes(Number(user?.id)))void refresh();};
        const foreground=()=>{if(!document.hidden)void refresh();};
        refresh();const interval=setInterval(refresh,15000);
        socket.on('order_change_notice',notice);socket.on('connect',refresh);socket.on('order_exception_changed',refresh);
        window.addEventListener('online',refresh);document.addEventListener('visibilitychange',foreground);
        return()=>{alive=false;clearInterval(interval);socket.off('order_change_notice',notice);socket.off('connect',refresh);socket.off('order_exception_changed',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',foreground);};
    },[user?.id,refreshVersion,seen]);
    const enableSound=async()=>{
        try {
            soundNotification.setUser(user?.id);
            soundNotification.setOrderAlertsEnabled(true);
            if(soundNotification.getSettings().volume===0)soundNotification.setVolume(0.3);
            const played=await soundNotification.preview('orderChange');
            setSoundBlocked(!played);
            if(!played)toast.error('無法播放，請確認裝置音量及瀏覽器的音訊權限。');
        } catch {toast.error('無法啟用警示音，請檢查瀏覽器設定。');}
    };
    const current=inbox.items[0];
    const acknowledge=async()=>{
        if(!current||confirming)return;
        setConfirming(true);
        try {
            await apiClient.post(`/api/order-change-notices/${current.id}/acknowledge`);
            setInbox(previous=>({...previous,items:previous.items.filter(item=>item.id!==current.id),total:Math.max(0,previous.total-1)}));
            setRefreshVersion(version=>version+1);
        } catch {toast.error('確認未送出，請重試；通知仍會保留。');}
        finally {setConfirming(false);}
    };
    if(!summary.total&&!inbox.total&&!failed)return null;
    return <>
        <section aria-label="訂單異動提醒" className="border-b-2 border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950">
            <div className="flex flex-wrap items-center gap-3">
                <AlertTriangle size={22} aria-hidden="true" className="shrink-0 text-amber-700" />
                <strong role="status">{failed?'異動通知暫時無法更新，請重新整理':summary.total?`${summary.total} 筆異動待審核 · 相關作業暫停`:`${inbox.total} 則訂單異動尚未確認`}</strong>
                {inbox.total>0&&<button type="button" className="min-h-10 rounded-lg bg-amber-900 px-3 font-semibold text-white" onClick={()=>setShowNotices(true)}>查看異動警示（{inbox.total}）</button>}
                {summary.total>0&&<button type="button" className="min-h-10 underline" onClick={()=>setExpanded(value=>!value)}>{expanded?'收合':'查看待審核訂單'}</button>}
                {summary.canReview&&summary.total>0&&<Link className="ml-auto min-h-10 inline-flex items-center font-semibold underline" to="/admin/exceptions">前往審核</Link>}
            </div>
            {expanded&&<ul className="mt-2 max-h-48 overflow-auto space-y-2">{summary.items.map(item=><li key={item.id}>
                <Link className="underline" to={`/order/${item.order_id}`}>{item.voucher_number} · {item.proposal_action==='delete_order'?'刪除申請':'訂單異動'}</Link>
                <span className="ml-2">{item.reason_text}</span>
            </li>)}</ul>}
        </section>
        {current&&showNotices&&<aside aria-label="重要訂單異動" className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-lg rounded-2xl border-2 border-red-400 bg-white shadow-2xl text-slate-900">
            <div className="flex items-center justify-between gap-3 rounded-t-xl bg-red-50 px-5 py-3">
                <h2 className="flex items-center gap-2 text-lg font-bold text-red-800"><AlertTriangle size={23} />重要訂單異動</h2>
                <button type="button" aria-label="收合異動警示" className="min-h-10 px-2 text-sm underline" onClick={()=>setShowNotices(false)}>稍後查看</button>
            </div>
            <div className="max-h-[55vh] overflow-auto p-5 space-y-3">
                <div role="alert" aria-atomic="true" key={current.id}>
                    <div className="text-2xl font-bold break-words">{current.payload.voucherNumber}</div>
                    <div className="mt-2 text-lg font-semibold text-red-800">{current.payload.title}</div>
                    <p className="mt-2 text-base font-semibold">{current.is_current ? current.payload.message : '此為較早的異動通知，已有後續更新，請以訂單最新內容為準。'}</p>
                </div>
                {current.payload.reason&&<p className="text-sm text-slate-600 whitespace-pre-wrap break-words">原因：{current.payload.reason}</p>}
                {current.payload.actorName&&<p className="text-sm text-slate-700">操作人：{current.payload.actorName}（{current.payload.actorRole}）</p>}
                {current.payload.details?.lines?.length>0&&<section aria-label="異動明細" className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                    <h3 className="font-semibold">{current.payload.details.heading}</h3>
                    <ul className="mt-2 space-y-2 whitespace-pre-wrap break-words">{current.payload.details.lines.slice(0,3).map((line,index)=><li key={index}>{line}</li>)}</ul>
                    {current.payload.details.lines.length>3&&<details className="mt-2" key={current.id}>
                        <summary className="min-h-10 cursor-pointer font-semibold text-blue-700">展開全部異動明細</summary>
                        <ul className="space-y-2 whitespace-pre-wrap break-words">{current.payload.details.lines.slice(3).map((line,index)=><li key={index}>{line}</li>)}</ul>
                    </details>}
                </section>}
                <p className="text-xs text-slate-500">{formatMessageTimestamp(current.created_at)} · 尚有 {inbox.total} 則未確認</p>
                {soundBlocked&&<div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                    <p>警示音尚未播放，請先點選啟用並確認裝置音量。</p>
                    <button type="button" onClick={enableSound} className="mt-2 min-h-10 inline-flex items-center gap-2 font-semibold underline"><Volume2 size={18} />啟用並試聽警示音</button>
                </div>}
                <div className="flex flex-wrap gap-2">
                    <Link to={summary.canReview&&current.is_current&&current.payload.phase==='requested'?'/admin/exceptions':`/order/${current.order_id}`} onClick={()=>setShowNotices(false)} className="min-h-11 inline-flex items-center rounded-xl border border-slate-300 px-4 font-semibold">{summary.canReview&&current.is_current&&current.payload.phase==='requested'?'查看申請':'查看訂單'}</Link>
                    <button type="button" disabled={confirming} onClick={acknowledge} className="min-h-11 rounded-xl bg-red-700 px-4 font-semibold text-white disabled:opacity-50">{confirming?'確認中…':'我已知悉'}</button>
                </div>
                <p className="text-xs text-slate-500">知悉只確認收到通知，不會核准異動或恢復作業。</p>
            </div>
        </aside>}
    </>;
}
