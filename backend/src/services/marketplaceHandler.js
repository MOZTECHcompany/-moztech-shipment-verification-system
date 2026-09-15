// Authenticated staff identity is recorded independently of conversion inputs.
function captureHandler(user){
 return {userId:user.id,name:user.name||user.username||'',username:user.username||''};
}
async function batchHandler(pool,row){
 if(row.snapshot?.handler)return row.snapshot.handler;
 if(!row.created_by)return null;
 const user=(await pool.query('SELECT id,name,username FROM users WHERE id=$1',[row.created_by])).rows[0];
 return user?{...captureHandler(user),legacy:true}:null;
}
module.exports={captureHandler,batchHandler};
