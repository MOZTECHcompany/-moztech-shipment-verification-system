import { AssistantError, businessSnapshot, fingerprint } from '../src/engine.mjs';
export const clone=value=>JSON.parse(JSON.stringify(value));
export function voucher({quantity=25,sn=[],rows}={}) {
  return {
    schemaVersion:1,companyCode:'TEST-COMPANY',voucherNumber:'2026/10/16-1',versionToken:'native:1',capturedAt:'2026-10-16T00:00:00.000Z',customerCode:'TEST-CUSTOMER',warehouseCode:'TEST-WAREHOUSE',currencyCode:'TWD',approvalStatus:'registered',linkedDocuments:['TEST-ORIGIN-1'],totals:{netAmount:'0.00',taxAmount:'0.00',grossAmount:'0.00'},otherBusinessFields:{salesperson:'TEST-OPERATOR',note:'keep original header'},
    rows:rows || [{rowId:'line-1',itemCode:'TEST-PRODUCT',sourceLineId:'SOURCE-1',quantity:String(quantity),unitPrice:'0.00',netAmount:'0.00',taxAmount:'0.00',grossAmount:'0.00',warehouseCode:'TEST-WAREHOUSE',actualSN:sn,metadata:'原有備註'}]
  };
}
export function nativeFixture(initial=voucher()) {
  let current=clone(initial), locked=false, loggedIn=true, nextFailure=null;
  const events=[];
  const adapter={
    async read(){if(!loggedIn)throw new AssistantError('LOGGED_OUT');return clone(current);},
    async capabilities(){return {loggedIn,existingVoucher:true,identityLocked:true,temporaryDraft:false,atomicMetadataOnlyUpdate:true,optimisticConcurrency:true,metadataLengthAccepted:true,metadataMaxLength:10000,versionToken:current.versionToken};},
    async saveMetadata({expectedVersionToken,expectedBusinessFingerprint,rows}) {
      if(!loggedIn)throw new AssistantError('LOGGED_OUT');
      // This is a native, atomic fixture transaction, not a client-side hash used as a substitute for vendor locking.
      if(locked || current.versionToken!==expectedVersionToken || await fingerprint(businessSnapshot(current))!==expectedBusinessFingerprint)throw new AssistantError('NATIVE_CAS_CONFLICT');
      locked=true;
      try{
        for(const update of rows){const row=current.rows.find(row=>row.rowId===update.rowId);if(!row||row.metadata!==update.previousMetadata)throw new AssistantError('METADATA_CONFLICT');}
        const next=clone(current);
        for(const update of rows)next.rows.find(row=>row.rowId===update.rowId).metadata=update.metadata;
        next.versionToken=`native:${Number(current.versionToken.split(':')[1])+1}`;
        current=next;
        events.push({type:'metadata-update',fields:rows.map(row=>`${row.rowId}.metadata`)});
        if(nextFailure){const code=nextFailure;nextFailure=null;throw new AssistantError(code);}
      }finally{locked=false;}
    }
  };
  return {adapter,events,get document(){return clone(current);},set document(value){current=clone(value);},setLoggedIn(value){loggedIn=value;},failAfterNextSave(code='CONNECTION_LOST'){nextFailure=code;},inventoryPostings:[]};
}
export function memoryReceipts(){const data=new Map();return {get:async key=>clone(data.get(key)||null),set:async(key,value)=>{data.set(key,clone(value));},data};}
