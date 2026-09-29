const assert=require('node:assert/strict');
module.exports=async({t,api,ok,pool,users})=>{
 await t.test('comments, card summaries, pins and mentions expose the same UTC instant with exact pagination',async()=>{
  const id=(await pool.query("INSERT INTO orders(voucher_number,customer_name,status) VALUES('TIME-FIXTURE','Time fixture','pending') RETURNING id")).rows[0].id;
  const created=ok(await api('dispatcher','POST',`/api/tasks/${id}/comments`,{content:'@fixture_packer timezone fixture',priority:'urgent'}),201);
  const persisted=(await pool.query("SELECT created_at AT TIME ZONE 'UTC' AS instant FROM task_comments WHERE id=$1",[created.id])).rows[0].instant;
  assert.equal(Date.parse(created.created_at),persisted.getTime(),'POST response must not depend on Node local time');
  await pool.query("UPDATE task_comments SET created_at=timestamp '2026-09-29 05:53:59.263438' WHERE id=$1",[created.id]);
  const earlier=(await pool.query("INSERT INTO task_comments(order_id,user_id,content,created_at) VALUES($1,$2,'Earlier microsecond',timestamp '2026-09-29 05:53:59.263437') RETURNING id",[id,users.dispatcher])).rows[0].id;
  ok(await api('packer','PUT',`/api/tasks/${id}/pins/${created.id}`,{pinned:true}));
  const expected=Date.parse('2026-09-29T05:53:59.263Z');
  const instant=value=>{assert.match(value,/(?:Z|[+-]\d{2}:\d{2})$/);assert.equal(Date.parse(value),expected);};
  for(const zone of ['UTC','Asia/Taipei']){
   await pool.query(`SET TIME ZONE '${zone}'`);
   try{
    const page=ok(await api('packer','GET',`/api/tasks/${id}/comments?latest=1&limit=1`));
    assert.equal(page.items[0].id,created.id);instant(page.items[0].created_at);
    assert.equal(page.items[0].cursor_created_at,'2026-09-29 05:53:59.263438');
    const before=ok(await api('packer','GET',`/api/tasks/${id}/comments?latest=1&limit=1&before=${encodeURIComponent(page.previousCursor)}`));
    assert.equal(before.items[0].id,earlier);
    for(const path of ['/api/tasks','/api/tasks?pagination=cursor&q=TIME-FIXTURE']){
     const data=ok(await api('admin','GET',path));instant((Array.isArray(data)?data:data.items).find(x=>x.id===id).latest_comment.created_at);
    }
    const pinned=ok(await api('packer','GET',`/api/tasks/${id}/pins`));instant(pinned.pinned[0].created_at);
    const mentions=ok(await api('packer','GET',`/api/tasks/${id}/mentions?status=all`));instant(mentions.items[0].comment_created_at);
    assert.match(mentions.items[0].created_at,/(?:Z|[+-]\d{2}:\d{2})$/);
    const unread=ok(await api('packer','GET','/api/comments/unread-summary'));instant(unread.orders.find(x=>x.order_id===id).latest_comment_time);
   }finally{await pool.query("SET TIME ZONE 'UTC'");}
  }
  assert.equal((await pool.query('SELECT created_at::text AS raw FROM task_comments WHERE id=$1',[created.id])).rows[0].raw,'2026-09-29 05:53:59.263438');
 });
};
