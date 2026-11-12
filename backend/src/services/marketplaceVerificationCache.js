function createVerificationCache({now=Date.now,ttlMs=15000,maxEntries=16}={}){
 const settled=new Map(),pending=new Map();
 return function cached(key,{refresh=false}={},read){
  if(!refresh){
   if(pending.has(key))return pending.get(key);
   const hit=settled.get(key);
   if(hit?.expires>now())return hit.promise;
  }
  settled.delete(key);
  const promise=Promise.resolve().then(read);
  pending.set(key,promise);
  promise.then(()=>{
   if(pending.get(key)!==promise)return;
   pending.delete(key);
   settled.set(key,{promise,expires:now()+ttlMs});
   if(settled.size>maxEntries)settled.delete(settled.keys().next().value);
  },()=>{
   if(pending.get(key)===promise)pending.delete(key);
  });
  return promise;
 };
}

module.exports={createVerificationCache};
