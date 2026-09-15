const jwt=require('jsonwebtoken');
const {validId,batchLinks}=require('./marketplaceBatchManagement');
const COOKIE='wms_marketplace_download';
const path=(id,kind)=>`/api/marketplace-files/${id}/${kind}`;
const allowed=kind=>['ecount','prepick'].includes(kind);
function issueDownload(res,id,kind,actor){
 if(!validId(id)||!allowed(kind))throw Object.assign(new Error('下載類型或批次無效'),{status:400});
 const url=path(id,kind);
 // Deliberately no id/userId claim: this token cannot authenticate other APIs.
 const token=jwt.sign({downloadActor:actor,intakeId:Number(id),kind},process.env.JWT_SECRET,{algorithm:'HS256',audience:'wms-marketplace-file',expiresIn:120});
 res.cookie(COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:120000,path:url});
 res.set('Cache-Control','private, no-store').json({url,expiresIn:120});
}
function downloadFile({pool}){return async(req,res,next)=>{
 try{
  if(!validId(req.params.id)||!allowed(req.params.kind))return res.status(400).send('下載類型或批次無效');
  const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  let claims;try{claims=jwt.verify(raw,process.env.JWT_SECRET,{algorithms:['HS256'],audience:'wms-marketplace-file'});}catch{return res.status(403).send('下載連結已過期，請回批次頁重新下載。');}
  if(claims.intakeId!==Number(req.params.id)||claims.kind!==req.params.kind)return res.status(403).send('下載權限不符');
  const user=(await pool.query('SELECT role FROM users WHERE id=$1',[claims.downloadActor])).rows[0];
  if(!user||!['admin','superadmin','dispatcher'].includes(user.role))return res.status(403).send('帳號已無下載權限');
  const r=(await pool.query('SELECT * FROM marketplace_intakes WHERE id=$1',[req.params.id])).rows[0];
  if(!r)return res.status(404).send('批次已刪除或不存在');
  if(req.params.kind==='ecount')await require('./marketplaceProductCatalog').verifyCatalogMappings(pool,r.snapshot.settings,[...new Set(r.snapshot.items.map(i=>i.sku))]);
  const record={...r.snapshot,id:r.id,batchNumber:r.batch_number,platform:r.source_platform,store:r.source_store,links:await batchLinks(pool,r.id)};
  const {savedBatchTables}=await import('./marketplaceBatchFiles.mjs'),XLSX=require('xlsx');
  const book=XLSX.utils.book_new();for(const t of savedBatchTables(record,req.params.kind)){const sheet=XLSX.utils.aoa_to_sheet(t.rows);sheet['!cols']=(t.rows[0]||[]).map(()=>({wch:24}));XLSX.utils.book_append_sheet(book,sheet,t.name);}
  const filename=`${req.params.kind==='ecount'?'ECOUNT銷貨匯入':'WMS預揀與訂單明細'}_${r.batch_number}.xlsx`;
  res.set({'Cache-Control':'private, no-store','Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="WMS-${r.id}-${req.params.kind}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,'X-Content-Type-Options':'nosniff'});
  res.send(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
 }catch(e){if(e.status)return res.status(e.status).send(e.message);next(e);}
};}
module.exports={issueDownload,downloadFile};
