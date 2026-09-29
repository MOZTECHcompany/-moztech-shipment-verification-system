import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/api';
import { socket } from '../api/socket';

export function WorkplaceAnnouncements() {
    const [items,setItems] = useState([]);
    const [error,setError] = useState(false);
    useEffect(() => {
        let active=true;
        const load=()=>api.get('/api/team/posts?type=announcement&limit=3&page=1').then(({data})=>{if(active){setItems(data.items || []);setError(false);}}).catch(()=>{if(active)setError(true);});
        load(); socket.on('team_post_changed',load);
        return()=>{active=false;socket.off('team_post_changed',load);};
    },[]);
    return <section aria-label="團隊公告" className="mb-5 rounded-xl border border-slate-200 bg-white px-5 py-4"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">團隊公告</h2><Link to="/team" className="inline-flex min-h-11 items-center text-sm text-slate-600">全部公告與交辦</Link></div>{error ? <p role="status" className="text-sm text-amber-700">公告暫時無法載入，請開啟全部公告重試。</p> : items.length ? <ul className="divide-y divide-slate-100">{items.map(item=><li key={item.id}><Link to={'/team/'+item.id} className="block py-3 text-sm">{item.title}</Link></li>)}</ul> : <p className="text-sm text-slate-500">目前沒有新公告</p>}</section>;
}
