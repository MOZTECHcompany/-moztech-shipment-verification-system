function isVerifiedFulfilledOrder(order){
 return order?.fulfillmentStatus==='fulfilled'&&order.cancelled===false&&!order.cancelledAt&&
  Number.isSafeInteger(order.currentQuantity)&&order.currentQuantity>0&&order.remainingQuantity===0;
}

function verifiedFulfilledOrderNumbers(verification){
 if(verification?.version!=='shopify-current-v2'||verification.platform!=='Shopify'||!Array.isArray(verification.orders))return [];
 const counts=new Map();
 for(const {number} of verification.orders)counts.set(number,(counts.get(number)||0)+1);
 return verification.orders.filter(order=>typeof order.number==='string'&&order.number&&counts.get(order.number)===1&&isVerifiedFulfilledOrder(order)).map(order=>order.number).sort();
}

module.exports={isVerifiedFulfilledOrder,verifiedFulfilledOrderNumbers};
