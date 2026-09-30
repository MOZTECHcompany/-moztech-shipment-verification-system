import React, {useEffect,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {toast} from 'sonner';
import apiClient from '@/api/api';
import {socket} from '@/api/socket';

export default function OrderReviewAlerts({user}) {
    const [summary,setSummary] = useState({items:[],total:0,canReview:false});
    const [failed,setFailed] = useState(false);
    const [expanded,setExpanded] = useState(false);
    const navigate = useNavigate();
    useEffect(()=>{
        let alive=true;
        const refresh=async()=>{try{const {data}=await apiClient.get('/api/order-reviews');if(alive){setSummary(data);setFailed(false);}}catch{if(alive)setFailed(true);}};
        const notice=data=>{
            refresh();
            if (!data?.recipientUserIds?.includes(Number(user?.id)) || Number(data.actorId)===Number(user?.id)) return;
            toast.warning(`${data.voucherNumber} · ${data.title}`,{description:data.message,duration:12000,
                action:{label:'查看訂單',onClick:()=>navigate(`/order/${data.orderId}`)}});
        };
        refresh();const interval=setInterval(refresh,30000);
        socket.on('order_change_notice',notice);socket.on('connect',refresh);socket.on('order_exception_changed',refresh);
        return()=>{alive=false;clearInterval(interval);socket.off('order_change_notice',notice);socket.off('connect',refresh);socket.off('order_exception_changed',refresh);};
    },[user?.id,navigate]);
    if (!summary.total && !failed) return null;
    return <section aria-label="訂單異動提醒" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <div className="flex flex-wrap items-center gap-3">
            <strong role="status">{failed ? '異動通知暫時無法更新，請重新整理' : `${summary.total} 筆異動待審核 · 相關作業暫停`}</strong>
            {summary.total>0 && <button type="button" className="underline" onClick={()=>setExpanded(v=>!v)}>{expanded?'收合':'查看待審核訂單'}</button>}
            {summary.canReview && <Link className="ml-auto font-semibold underline" to="/admin/exceptions">前往審核</Link>}
        </div>
        {expanded && <ul className="mt-2 max-h-48 overflow-auto space-y-2">{summary.items.map(item=><li key={item.id}>
            <Link className="underline" to={`/order/${item.order_id}`}>{item.voucher_number} · {item.proposal_action==='delete_order'?'刪除申請':'訂單異動'}</Link>
            <span className="ml-2">{item.reason_text}</span>
        </li>)}</ul>}
    </section>;
}
