// Read-only CLI for support checks. It does not save WMS batches or post ERP.
const fs=require('node:fs');
const XLSX=require('xlsx');
const {createShopifyOrderVerifier}=require('../src/services/shopifyOrderVerification');
async function main(){
 const file=process.argv[2];
 if(!file||process.argv.length!==3)throw Object.assign(new Error('用法：npm run shopify:check -- 訂單.csv'),{code:'USAGE'});
 const bytes=fs.readFileSync(file);if(bytes.length>10*1024*1024)throw Error('檔案上限 10 MiB');
 const source=/\.csv$/i.test(file)?new TextDecoder('utf-8',{fatal:true}).decode(bytes):bytes;
 const book=XLSX.read(source,{type:typeof source==='string'?'string':'buffer',raw:true,cellFormula:false,cellHTML:false,sheetRows:5001});
 const {inspectMarketplaceRows,parseUnifiedMarketplace,prepareUnifiedMarketplace}=await import('../src/services/unifiedMarketplace.mjs');
 const candidates=[];
 for(const name of book.SheetNames){
  const rows=XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:true});
  try{const source=inspectMarketplaceRows(rows);if(source.platform==='Shopify')candidates.push(source);}catch{}
 }
 if(candidates.length!==1)throw Error('請選擇只有一個 Shopify 訂單工作表的原始檔');
 const verified=await createShopifyOrderVerifier()(candidates[0].rows);
 const raw=parseUnifiedMarketplace(verified.rows).parsed;
 const result=prepareUnifiedMarketplace(raw,{currency:'TWD',taxMode:'erp_inclusive',taxType:'11'});
 console.log(JSON.stringify({shop:verified.verification.shop,apiVersion:verified.verification.apiVersion,checkedAt:verified.verification.checkedAt,
  orders:verified.verification.orders.map(o=>({number:o.number,total:o.totalMinor/100,fulfillment:o.fulfillmentStatus,cancelled:o.cancelled===true,eligible:result.choices.find(c=>c.number===o.number)?.eligible===true})),
  items:raw.items.map(i=>({order:i.sourceOrderNumber,sku:i.sku,quantity:i.quantity,amount:i.lineSubtotalMinor/100}))},null,2));
}
main().catch(e=>{console.error(JSON.stringify({code:e.code||'SHOPIFY_CHECK_FAILED',message:e.message}));process.exitCode=1;});
