const {fixture:refundFixture,connection,table,profile,preparation,response,shop}=require('./anonymous-shopify-refund-review.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const result=refundFixture(false),{current}=result;
 for(const line of current.lineItems.nodes){
  const strap=['4711299273674','4711299273667'].includes(line.sku),title=strap?'Synthetic strap':'Synthetic '+line.sku,colour=line.sku==='4711299273674'?'Oat':line.sku==='4711299273667'?'Pink':'Other',product='gid://shopify/Product/'+(strap?'500':line.id.split('/').pop());
  Object.assign(line,{title,variantTitle:colour+' / Type-C to Type-C',name:title+' - '+colour+' / Type-C to Type-C',product:{id:product},variant:{...line.variant,title:colour+' / Type-C to Type-C',product:{id:product},selectedOptions:[{name:'Colour',value:colour},{name:'Connector',value:'Type-C to Type-C'}]}});
 }
 const old=current.lineItems.nodes.find(line=>!line.currentQuantity),added=current.lineItems.nodes.find(line=>line.sku==='4711299273667');
 let saleId=100;
 const sale=(line,actionType,quantity)=>({__typename:'ProductSale',id:'gid://shopify/Sale/'+saleId++,actionType,quantity,lineItem:clone(line)});
 const group=(id,happenedAt,sales,type='OrderEditAgreement')=>({__typename:type,id:'gid://shopify/SalesAgreement/'+id,happenedAt,reason:type==='OrderEditAgreement'?'ORDER_EDIT':'ORDER',sales:connection(sales)});
 const placement=group(1,'2026-10-28T01:00:00Z',current.lineItems.nodes.filter(line=>line.id!==added.id).map(line=>sale(line,'ORDER',1)),'OrderAgreement'),edit=group(2,'2026-10-29T03:00:00Z',[sale(old,'RETURN',-1),sale(added,'ORDER',1)]);
 current.agreements={edges:[{cursor:'AGREEMENT-1',node:placement},{cursor:'AGREEMENT-2',node:edit}],pageInfo:{hasNextPage:false,endCursor:'AGREEMENT-2'}};
 return {...result,old,added,edit,placement,sale,group};
}
module.exports={fixture,connection,table,profile,preparation,response,shop};
