const jwt=require('jsonwebtoken');
const {validId,batchLinks}=require('./marketplaceBatchManagement');
const {assertUploadScope}=require('./marketplaceUploadScopes');
const COOKIE='wms_marketplace_download';
const path=(id,kind)=>`/api/marketplace-files/${id}/${kind}`;
const allowed=kind=>['ecount','ecount-grouped','prepick'].includes(kind);
function issueDownload(res,id,kind,actor,draftRevision=0,uploadScopeFingerprint){
 if(!validId(id)||!allowed(kind))throw Object.assign(new Error('下載類型或批次無效'),{status:400});
 const url=path(id,kind);
 // Deliberately no id/userId claim: this token cannot authenticate other APIs.
 if(uploadScopeFingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(uploadScopeFingerprint))throw Object.assign(new Error('本次訂單版本無效，請重新核對'),{status:409});
 const token=jwt.sign({downloadActor:actor,intakeId:Number(id),kind,draftRevision,...(uploadScopeFingerprint?{uploadScopeFingerprint}:{})},process.env.JWT_SECRET,{algorithm:'HS256',audience:'wms-marketplace-file',expiresIn:120});
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
  if((claims.draftRevision??0)!==(r.snapshot.draftRevision??0))return res.status(409).send('銷貨版本已更新，請回批次頁核對後重新下載。');
  await assertUploadScope(pool,r);
  if(claims.uploadScopeFingerprint!==r.snapshot.uploadScope?.fingerprint)return res.status(409).send('本次訂單版本已更新，請重新核對並產檔。');
  let reviewWarning='';
  const physicalReview=r.snapshot.barcodeReviews?.some(review=>review?.evidence?.barcodeProof==='physical-scan-v1');
  try{const reviewed=await require('./marketplaceBarcodeReviews').verifySavedBarcodeReviews(pool,r.snapshot,undefined,{returnContext:true});await require('./marketplaceProductCatalog').verifyCatalogMappings(pool,r.snapshot.settings,[...new Set(r.snapshot.items.map(i=>i.sku))],undefined,reviewed,{...r.snapshot,platform:r.source_platform});}catch(e){if(req.params.kind==='prepick'&&e.status===400&&!physicalReview)reviewWarning=e.message;else throw e;}
  const record={reviewWarning,...r.snapshot,handler:await require('./marketplaceHandler').batchHandler(pool,r),id:r.id,batchNumber:r.batch_number,platform:r.source_platform,store:r.source_store,links:await batchLinks(pool,r.id)};
  const {savedBatchTables}=await import('./marketplaceBatchFiles.mjs'),XLSX=require('xlsx');
  const {formatEcountProductColumn}=await import('./marketplaceIntake.mjs');
  let tables;try{tables=savedBatchTables(record,req.params.kind);}catch(e){throw Object.assign(e,{status:400});}
  const book=XLSX.utils.book_new();for(const t of tables){const sheet=XLSX.utils.aoa_to_sheet(t.rows);sheet['!cols']=(t.rows[0]||[]).map(()=>({wch:24}));if(t.name==='銷貨匯入')formatEcountProductColumn(sheet,t.rows.length);XLSX.utils.book_append_sheet(book,sheet,t.name);}
  const filename=`${req.params.kind==='ecount-grouped'?'ECOUNT彙總銷貨匯入':req.params.kind==='ecount'?'ECOUNT銷貨匯入':'WMS預揀與訂單明細'}_${r.batch_number}${r.snapshot.draftRevision?`_修訂${r.snapshot.draftRevision}`:''}.xlsx`;
  res.set({'Cache-Control':'private, no-store','Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="WMS-${r.id}-${req.params.kind}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,'X-Content-Type-Options':'nosniff'});
  res.send(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
 }catch(e){if(e.status)return res.status(e.status).send(e.message);next(e);}
};}
module.exports={issueDownload,downloadFile};
