const {createHash}=require('node:crypto');
const text=value=>typeof value==='string'?value.trim():'';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message,code='SHOPIFY_EDIT_REVIEW_REQUIRED')=>Object.assign(new Error(message),{status:400,code});
const LINE_SELECTION=`id sku name title variantTitle currentQuantity product { id } variant { id title product { id } selectedOptions { name value } }`;
const AGREEMENT_SELECTION=`__typename id happenedAt reason sales(first: 20, after: $saleAfter) {
 nodes { __typename id actionType quantity ... on ProductSale { lineItem { ${LINE_SELECTION} } } }
 pageInfo { hasNextPage endCursor }
}`;
const EDIT_QUERY=`query WmsOrderEditHistory($id: ID!, $agreementAfter: String, $saleAfter: String) {
 shop { myshopifyDomain }
 order(id: $id) { id name updatedAt agreements(first: 20, after: $agreementAfter) { edges { cursor node { ${AGREEMENT_SELECTION} } } pageInfo { hasNextPage endCursor } } }
}`;
const EDIT_SALES_QUERY=`query WmsOrderEditSales($id: ID!, $agreementAfter: String, $saleAfter: String) {
 shop { myshopifyDomain }
 order(id: $id) { id name updatedAt agreements(first: 1, after: $agreementAfter) { edges { cursor node { ${AGREEMENT_SELECTION} } } pageInfo { hasNextPage endCursor } } }
}`;
const validId=(value,type)=>new RegExp('^gid://shopify/'+type+'/\\d+$').test(value||'');
function metadata(line){
 if(!line||!validId(line.id,'LineItem')||!text(line.sku)||!Number.isSafeInteger(line.currentQuantity)||line.currentQuantity<0)return null;
 const result={id:line.id,sku:text(line.sku),name:text(line.name)||[text(line.title),text(line.variantTitle)].filter(Boolean).join(' - '),currentQuantity:line.currentQuantity};
 if(text(line.title))result.productTitle=text(line.title);
 if(text(line.variantTitle))result.variantTitle=text(line.variantTitle);
 if(validId(line.product?.id,'Product'))result.productId=line.product.id;
 const variant=line.variant;
 if(validId(variant?.id,'ProductVariant'))result.variantId=variant.id;
 const options=variant?.selectedOptions;
 // Current catalog options may have been renamed since the order. They are
 // usable as compact variant labels only when they still match the order's
 // own variant title and the two official parent product identities agree.
 if(result.productId&&variant?.product?.id===result.productId&&text(variant.title)===result.variantTitle&&Array.isArray(options)&&options.length>0&&options.length<=10&&options.every(option=>text(option?.name)&&text(option?.value)&&option.name.length<=500&&option.value.length<=500)&&new Set(options.map(option=>text(option.name))).size===options.length){
  result.selectedOptions=options.map(option=>({name:text(option.name),value:text(option.value)})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 }
 return result;
}
function normalizedSale(sale){
 if(!validId(sale?.id,'Sale')||!text(sale.__typename)||!text(sale.actionType))throw fail('Shopify 訂單修改明細身分無法核對');
 return {id:sale.id,type:sale.__typename,actionType:sale.actionType,quantity:sale.quantity,...(sale.__typename==='ProductSale'?{line:metadata(sale.lineItem)}:{})};
}
function agreementIdentity(group){
 if(!validId(group?.id,'SalesAgreement')||!text(group.__typename)||!text(group.reason)||!Number.isFinite(Date.parse(group.happenedAt)))throw fail('Shopify 訂單修改事件身分或時間無法核對');
 return {id:group.id,type:group.__typename,happenedAt:group.happenedAt,reason:group.reason};
}
function assertOrder(expected,current){if(!current||current.id!==expected.id||current.name!==expected.name||current.updatedAt!==expected.updatedAt)throw fail('Shopify 訂單在修改紀錄核對期間已更新，請重新核對','SHOPIFY_ORDER_CHANGED');}
function pageInfo(connection){if(typeof connection?.pageInfo?.hasNextPage!=='boolean'||connection.pageInfo.hasNextPage&&!text(connection.pageInfo.endCursor))throw fail('Shopify 訂單修改分頁未完整回傳');return connection.pageInfo;}
async function readShopifyOrderEdits(order,request){
 const agreements=[],groupIds=new Set(),edgeCursors=new Set(),topCursors=new Set(),saleIds=new Set();let after=null;
 for(let page=0;page<13;page++){
  const current=await request(EDIT_QUERY,{id:order.id,agreementAfter:after,saleAfter:null});assertOrder(order,current);
  const connection=current.agreements,info=pageInfo(connection);
  if(!Array.isArray(connection.edges)||connection.edges.length>20||info.hasNextPage&&!connection.edges.length)throw fail('Shopify 訂單修改事件未完整回傳');
  let previous=after;
  for(const edge of connection.edges){
   if(!text(edge?.cursor)||edgeCursors.has(edge.cursor))throw fail('Shopify 訂單修改事件分頁重複');edgeCursors.add(edge.cursor);
   const group=edge.node,identity=agreementIdentity(group);if(groupIds.has(group.id))throw fail('Shopify 訂單修改事件重複');groupIds.add(group.id);
   if(groupIds.size>250)throw fail('Shopify 訂單修改事件超過核對上限');
   const sales=[],cursors=new Set();let salesConnection=group.sales;
   for(let salePage=0;salePage<51;salePage++){
    const saleInfo=pageInfo(salesConnection);
    if(!Array.isArray(salesConnection.nodes)||salesConnection.nodes.length>20||saleInfo.hasNextPage&&!salesConnection.nodes.length)throw fail('Shopify 訂單修改商品明細未完整回傳');
    for(const sale of salesConnection.nodes){const normalized=normalizedSale(sale);if(saleIds.has(normalized.id))throw fail('Shopify 訂單修改商品明細重複');saleIds.add(normalized.id);sales.push(normalized);if(sales.length>1000||saleIds.size>5000)throw fail('Shopify 訂單修改商品明細超過核對上限');}
    if(!saleInfo.hasNextPage)break;
    if(salePage===50||cursors.has(saleInfo.endCursor))throw fail('Shopify 訂單修改商品分頁重複或超過上限');cursors.add(saleInfo.endCursor);
    const continuation=await request(EDIT_SALES_QUERY,{id:order.id,agreementAfter:previous,saleAfter:saleInfo.endCursor});assertOrder(order,continuation);
    const edges=continuation.agreements?.edges;pageInfo(continuation.agreements);
    if(!Array.isArray(edges)||edges.length!==1||edges[0].cursor!==edge.cursor||hash(agreementIdentity(edges[0].node))!==hash(identity))throw fail('Shopify 訂單修改事件在分頁期間已變更','SHOPIFY_ORDER_CHANGED');
    salesConnection=edges[0].node.sales;
   }
   agreements.push({...identity,sales});previous=edge.cursor;
  }
  if(!info.hasNextPage){const evidence={version:'shopify-order-edit-v1',orderId:order.id,updatedAt:order.updatedAt,complete:true,agreements};return {...evidence,fingerprint:hash(evidence)};}
  if(page===12||info.endCursor!==previous||topCursors.has(info.endCursor))throw fail('Shopify 訂單修改事件分頁重複或超過上限');topCursors.add(info.endCursor);after=info.endCursor;
 }
 throw fail('Shopify 訂單修改事件未完整讀取');
}
function reviewEditChanges(evidence){
 const history=evidence.editEvidence;if(!history)return [];
 const {fingerprint,...unsigned}=history;
 if(history.version!=='shopify-order-edit-v1'||history.complete!==true||history.orderId!=='gid://shopify/Order/'+String(evidence.id).replace('gid://shopify/Order/','')||history.updatedAt!==evidence.updatedAt||fingerprint!==hash(unsigned))throw fail('Shopify 訂單修改證據已變更，請重新核對','SHOPIFY_ORDER_CHANGED');
 const groups=history.agreements,all=evidence.allItems||[],changes=[];
 const movement=sale=>sale.type==='ProductSale'&&sale.line&&((sale.actionType==='ORDER'&&Number.isSafeInteger(sale.quantity)&&sale.quantity>0&&sale.quantity<=50000)||(sale.actionType==='RETURN'&&Number.isSafeInteger(sale.quantity)&&sale.quantity<0&&sale.quantity>=-50000));
 const balances=new Map(),unknownLines=new Set();
 for(const group of groups)for(const sale of group.sales)if(sale.type==='ProductSale'&&sale.line){if(movement(sale))balances.set(sale.line.id,(balances.get(sale.line.id)||0)+sale.quantity);else if(sale.actionType!=='UPDATE')unknownLines.add(sale.line.id);}
 for(const group of groups){
  if(group.type!=='OrderEditAgreement'||group.reason!=='ORDER_EDIT')continue;
  const sales=group.sales.filter(movement);if(!sales.length)continue;
  // Another later (or equal-time, differently identified) event touching any
  // side makes this group historical, not an explanation of current choices.
  if(groups.some(other=>other.id!==group.id&&Date.parse(other.happenedAt)>=Date.parse(group.happenedAt)&&other.sales.some(sale=>movement(sale)&&sales.some(old=>old.line.id===sale.line.id))))continue;
  const removedItems=[],addedItems=[];let compatible=true;
  for(const sale of sales){
   const current=all.filter(item=>item.id===sale.line.id&&item.sku===sale.line.sku);
   if(current.length!==1||current[0].currentQuantity!==sale.line.currentQuantity||balances.get(sale.line.id)!==current[0].currentQuantity||unknownLines.has(sale.line.id)){compatible=false;break;}
   const item=current[0],quantity=Math.abs(sale.quantity),adding=sale.actionType==='ORDER';
   if(adding?item.currentQuantity<quantity:item.originalQuantity-item.currentQuantity<quantity){compatible=false;break;}
   const {currentQuantity,...details}=sale.line,delta={...details,saleId:sale.id,quantity};(adding?addedItems:removedItems).push(delta);
  }
  if(!compatible||!removedItems.length&&!addedItems.length)continue;
  const from=removedItems[0],to=addedItems[0],currentFrom=from&&all.find(item=>item.id===from.id);
  const optionsDiffer=from?.selectedOptions&&to?.selectedOptions&&hash(from.selectedOptions.map(option=>option.name))===hash(to.selectedOptions.map(option=>option.name))&&from.selectedOptions.some((option,index)=>option.value!==to.selectedOptions[index].value);
  const canPair=removedItems.length===1&&addedItems.length===1&&sales.length===2&&group.sales.length===2&&from.quantity===to.quantity&&currentFrom.currentQuantity===0&&from.id!==to.id&&Boolean(from.productId&&from.productId===to.productId&&from.variantId&&to.variantId&&from.variantId!==to.variantId&&from.variantTitle&&to.variantTitle&&optionsDiffer);
  changes.push({agreementId:group.id,happenedAt:group.happenedAt,evidenceFingerprint:hash({historyFingerprint:fingerprint,orderId:history.orderId,updatedAt:history.updatedAt,group,removedItems,addedItems,canPair}),removedItems,addedItems,canPair});
 }
 return changes;
}
module.exports={EDIT_QUERY,EDIT_SALES_QUERY,readShopifyOrderEdits,reviewEditChanges};
