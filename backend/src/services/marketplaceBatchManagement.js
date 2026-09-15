const validId=value=>/^[1-9]\d{0,9}$/.test(String(value))&&Number(value)<=2147483647;
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const dateExpr="COALESCE(i.snapshot->'settings'->>'date',to_char(i.created_at AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD'))";
function listFilters(query){
 const values=[],where=[];
 const add=(sql,value)=>{values.push(value);where.push(sql.replace('?',`$${values.length}`));};
 const status=query.status||'active';
 if(!['active','archived','all'].includes(status))throw error('批次狀態無效');
 if(status!=='all')where.push(`i.archived_at IS ${status==='active'?'NULL':'NOT NULL'}`);
 for(const [key,column] of [['platform','source_platform'],['store','source_store']])if(query[key]){
  if(typeof query[key]!=='string'||query[key].length>100)throw error('篩選條件無效');
  add(`i.${column}=?`,query[key]);
 }
 for(const [key,operator] of [['from','>='],['to','<=']])if(query[key]){
  const v=query[key];if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw error('日期格式無效');
  add(`${dateExpr}${operator}?`,v);
 }
 if(query.from&&query.to&&query.from>query.to)throw error('開始日期不可晚於結束日期');
 if(query.q){if(typeof query.q!=='string'||query.q.length>100)throw error('搜尋文字最多 100 字');add("(strpos(lower(i.batch_number),lower(?))>0 OR i.id::text=$"+(values.length+1)+")",query.q);}
 const page=Number(query.page||1),pageSize=20;
 if(!Number.isSafeInteger(page)||page<1||page>1000000)throw error('頁碼無效');
 return {values,where:where.length?' WHERE '+where.join(' AND '):'',page,pageSize};
}
async function listBatches(pool,query){
 const f=listFilters(query);
 const totals=(await pool.query(`SELECT COUNT(*)::int AS total,COALESCE(SUM((i.snapshot->'summary'->>'orderCount')::int),0)::int AS orders FROM marketplace_intakes i${f.where}`,f.values)).rows[0];
 const rows=await pool.query(`SELECT i.id,i.batch_number,i.source_platform,i.source_store,i.created_at,i.archived_at,${dateExpr} AS sales_date,
 i.snapshot->'summary' AS summary,
 (SELECT COUNT(*)::int FROM marketplace_intake_orders o WHERE o.intake_id=i.id) AS order_count,
 (SELECT COUNT(*)::int FROM marketplace_intake_orders o JOIN marketplace_work_order_links l ON l.intake_order_id=o.id WHERE o.intake_id=i.id) AS linked_count
 FROM marketplace_intakes i${f.where} ORDER BY ${dateExpr} DESC,i.id DESC LIMIT $${f.values.length+1} OFFSET $${f.values.length+2}`,[...f.values,f.pageSize,(f.page-1)*f.pageSize]);
 const facets=(await pool.query('SELECT DISTINCT source_platform,source_store FROM marketplace_intakes ORDER BY source_platform,source_store')).rows;
 return {intakes:rows.rows,...totals,page:f.page,pageSize:f.pageSize,facets};
}
async function batchLinks(pool,id){
 return (await pool.query(`SELECT o.source_order_number,l.order_id,w.import_batch_id,w.work_barcode,w.status,b.voucher_number
 FROM marketplace_intake_orders o LEFT JOIN marketplace_work_order_links l ON l.intake_order_id=o.id
 LEFT JOIN orders w ON w.id=l.order_id LEFT JOIN warehouse_import_batches b ON b.id=w.import_batch_id
 WHERE o.intake_id=$1 ORDER BY o.id`,[id])).rows;
}
async function changeBatch(pool,id,action,actor,body){
 if(!validId(id))throw error('轉檔批次編號無效');
 if(!['archive','restore','delete'].includes(action))throw error('批次操作無效');
 const db=await pool.connect();let open=false,tainted=false;
 try{
  await db.query('BEGIN');open=true;
  await db.query("SET LOCAL lock_timeout='2000ms'");await db.query("SET LOCAL statement_timeout='10000ms'");
  // Same lock ordering as conversion and ERP return: source identities first.
  // No physical deletion can race an import that is creating work-order links.
  const identities=(await db.query('SELECT source_platform,source_store,source_order_number FROM marketplace_intake_orders WHERE intake_id=$1',[id])).rows.map(o=>JSON.stringify([o.source_platform,o.source_store,o.source_order_number])).sort((a,b)=>a.localeCompare(b));
  for(const identity of identities)await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-marketplace-source'),hashtext($1))",[identity]);
  const record=(await db.query('SELECT * FROM marketplace_intakes WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!record)throw error('找不到轉檔批次',404);
  if(action==='delete'){
   if(body?.confirmed!==true||body?.batchNumber!==record.batch_number)throw error('請確認要永久刪除的批次');
   const linked=(await db.query(`SELECT 1 FROM marketplace_intake_orders o WHERE o.intake_id=$1 AND
    (EXISTS(SELECT 1 FROM marketplace_work_order_links l WHERE l.intake_order_id=o.id)
    OR EXISTS(SELECT 1 FROM orders w WHERE w.source_platform=o.source_platform AND w.source_store=o.source_store AND w.source_order_number=o.source_order_number)) LIMIT 1`,[id])).rowCount;
   if(linked)throw error('此批次已連結理貨工作單，無法刪除；請使用封存保留訂單對應。',409);
   await db.query('DELETE FROM marketplace_intake_orders WHERE intake_id=$1',[id]);
   await db.query('DELETE FROM marketplace_intakes WHERE id=$1',[id]);
  }else{
   const archived=action==='archive';
   if(Boolean(record.archived_at)===archived){await db.query('COMMIT');open=false;return {id:Number(id),action,unchanged:true};}
   await db.query('UPDATE marketplace_intakes SET archived_at=CASE WHEN $2 THEN NOW() ELSE NULL END,archived_by=CASE WHEN $2 THEN $3::integer ELSE NULL END WHERE id=$1',[id,archived,actor]);
  }
  await db.query('INSERT INTO marketplace_intake_events(intake_id,batch_number,action,actor_id) VALUES($1,$2,$3,$4)',[id,record.batch_number,action,actor]);
  await db.query('COMMIT');open=false;return {id:Number(id),action};
 }catch(e){if(open)try{await db.query('ROLLBACK');}catch{tainted=true;}
  if(['55P03','57014','23503'].includes(e.code))throw error('批次正在處理或已建立關聯，請重新讀取後再操作。',409);
  throw e;
 }finally{db.release(tainted);}
}
module.exports={validId,listFilters,listBatches,batchLinks,changeBatch};
