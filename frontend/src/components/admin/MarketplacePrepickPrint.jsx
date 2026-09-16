import React,{useRef,useState} from 'react';
import {useReactToPrint} from 'react-to-print';
import {Printer} from 'lucide-react';
import {Button} from '../../ui';
export default function MarketplacePrepickPrint({record,isCurrentSession}){
 const ref=useRef(null),[error,setError]=useState('');
 const print=useReactToPrint({contentRef:ref,documentTitle:`預揀總表-${record.batchNumber}`,onBeforePrint:async()=>{if(!isCurrentSession())throw Error('登入人員已變更');},onPrintError:()=>setError('無法開啟列印，請重新載入批次後再試。'),pageStyle:'@page { size: A4; margin: 10mm; } @media print { thead {display:table-header-group} tr {break-inside:avoid} body {color:#000;background:#fff} }'});
 return <><Button variant="secondary" disabled={!!record.reviewWarning} onClick={()=>{setError('');print();}}><Printer size={16} className="mr-1"/>列印預揀總表</Button>{error&&<p role="alert">{error}</p>}<div style={{display:'none'}}><div ref={ref} style={{fontSize:'11pt',fontFamily:'sans-serif'}}><h1 style={{fontSize:'20pt',marginBottom:12}}>預揀總表</h1><p>{record.platform} · {record.store}</p><p>{record.batchNumber} · 銷貨日期 {record.settings.date}</p><p>轉檔建立者：{record.handler?.name||record.handler?.username||'未記錄'}</p><p>專案負責人：{record.settings.projectOwner||'未指定'} · 業務負責人：{record.settings.salesOwner||'未指定'}</p><p>商品合計供整批預揀；各筆訂單請依理貨回匯後的工作單分揀與裝箱。</p><table style={{width:'100%',borderCollapse:'collapse',marginTop:16}}><thead><tr>{['品項編碼','商品名稱','已確認條碼','數量','訂單數'].map(h=><th key={h} style={{border:'1px solid #888',padding:6,textAlign:'left'}}>{h}</th>)}</tr></thead><tbody>{record.prepick.rows.map((r,i)=><tr key={i}>{[r[2],r[4],r[3]||'待確認',r[5],r[6]].map((v,j)=><td key={j} style={{border:'1px solid #888',padding:6,overflowWrap:'anywhere'}}>{v}</td>)}</tr>)}</tbody></table></div></div></>;
}
