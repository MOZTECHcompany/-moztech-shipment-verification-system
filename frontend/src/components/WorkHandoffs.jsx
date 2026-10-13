import {useEffect,useState} from 'react';
import apiClient from '@/api/api';
import {formatMessageTimestamp} from '@/utils/messageTimestamp';
import {workTypeLabel} from '@/utils/warehouseWork';

export function WorkHandoffs({orderId,version}) {
    const [items,setItems]=useState([]);
    const [error,setError]=useState(false);
    useEffect(()=>{
        let alive=true;
        apiClient.get(`/api/orders/${orderId}/handoffs`).then(({data})=>{if(alive){setItems(data.items||[]);setError(false);}}).catch(()=>{if(alive)setError(true);});
        return()=>{alive=false;};
    },[orderId,version]);
    return <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-semibold text-slate-800">交接紀錄{items.length?`（${items.length}）`:''}</summary>
        {error?<p className="mt-3 text-sm text-amber-800">暫時無法載入交接紀錄，重新整理後再試。</p>:items.length?<ol className="mt-3 space-y-3">
            {items.map(item=><li key={item.id} className="border-t border-slate-100 pt-3 text-sm">
                <div className="font-medium">{workTypeLabel(item.task_type)}：{item.from_name||'未記錄'} → {item.to_name||'未記錄'}</div>
                <div className="mt-1 text-xs text-slate-500">{formatMessageTimestamp(item.created_at)}{item.performed_by_name?` · 操作：${item.performed_by_name}`:''}</div>
                {item.progress_snapshot&&<p className="mt-1 text-xs text-slate-600">交接時已揀 {item.progress_snapshot.picked_quantity??0} 件、已裝 {item.progress_snapshot.packed_quantity??0} 件</p>}
                {item.reason&&<p className="mt-1 break-words text-slate-600">{item.reason}</p>}
            </li>)}
        </ol>:<p className="mt-3 text-sm text-slate-500">尚無交接紀錄</p>}
    </details>;
}
