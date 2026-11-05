import { CHANNEL, NONCE, UUID, MAX_MESSAGE_BYTES, REQUEST_TYPES, isControllerUrl, isErpUrl, containsCredentialKey } from './policy.mjs';
import { inspectEcountDocument } from './dom-adapter.mjs';
import { createEngine, AssistantError, fingerprint } from './engine.mjs';
import { inspectEcountCompany,validateCompanyMappings } from './company-evidence.mjs';

const controllers = new Map();
const running = new Set();
let bindingMutation=false;
const activeReceipts = new Map();
const replyError = code => ({ ok:false, errorCode:code });
const controllerKey=id=>`controller:${id}`;
async function getController(id){
  if(controllers.has(id))return controllers.get(id);
  const key=controllerKey(id),saved=(await chrome.storage.session.get(key))[key];
  if(!saved||!Number.isSafeInteger(saved.actorId)||saved.actorId<1||!NONCE.test(saved.nonce||'')||typeof saved.documentId!=='string'||!saved.documentId||!isControllerUrl(saved.origin+'/settings/ecount-assistant'))return null;
  try{const companyMappings=validateCompanyMappings(saved.companyMappings);const controller={...saved,companyMappings};controllers.set(id,controller);return controller;}catch{return null;}
}
async function clearController(id){controllers.delete(id);activeReceipts.delete(id);await chrome.storage.session.remove(controllerKey(id));}
async function registeredControllers(){
  const saved=await chrome.storage.session.get(null),ids=new Set([...controllers.keys(),...Object.keys(saved).filter(key=>/^controller:\d+$/.test(key)).map(key=>Number(key.slice(11)))]);
  const result=[];
  for(const id of ids){const controller=await getController(id),tab=await chrome.tabs.get(id).catch(()=>null);if(!controller||!tab){await clearController(id);continue;}result.push([id,controller]);}
  return result;
}
const receiptsFor=actorId=>({
  async get(id) { const key=`receipt:${actorId}:${id}`;return (await chrome.storage.local.get(key))[key] || null; },
  async set(id, value) { await chrome.storage.local.set({ [`receipt:${actorId}:${id}`]:value }); }
});
const bindingIdentityKeys=Object.freeze(['bindingId','erpTabId','erpDocumentId','controllerTabId','controllerDocumentId','controllerNonce','actorId']);
async function assertCurrentBinding(binding){
  const current=(await chrome.storage.session.get('operatorBinding')).operatorBinding;
  if(!UUID.test(binding?.bindingId||'')||!current||bindingIdentityKeys.some(key=>current[key]!==binding[key])||JSON.stringify(current.companyEvidence)!==JSON.stringify(binding.companyEvidence))throw new AssistantError('BIND_ECOUNT_TAB_FIRST');
}
async function rejectedBeforeEngine(actorId,jobId,errorCode){
  if(!UUID.test(jobId||''))return replyError(errorCode);
  const receipt=await receiptsFor(actorId).get(jobId);
  return receipt?replyError(errorCode):{ok:true,result:{outcome:'not_attempted',saveAttempted:false,errorCode}};
}
async function bindingFor(sender, nonce) {
  const controller = await getController(sender.tab.id);
  const binding = (await chrome.storage.session.get('operatorBinding')).operatorBinding;
  if (!controller || controller.nonce !== nonce || controller.documentId !== sender.documentId || !binding || !UUID.test(binding.bindingId||'') || binding.controllerTabId !== sender.tab.id || binding.actorId !== controller.actorId || binding.controllerDocumentId !== sender.documentId || binding.controllerNonce!==controller.nonce) throw new AssistantError('BIND_ECOUNT_TAB_FIRST');
  const tab = await chrome.tabs.get(binding.erpTabId).catch(() => null);
  if (!tab || !isErpUrl(tab.url)) throw new AssistantError('BOUND_TAB_NOT_AVAILABLE');
  return binding;
}
async function inspect(binding, input) {
  const controller=await getController(binding.controllerTabId);
  const controllerTab=await chrome.tabs.get(binding.controllerTabId).catch(()=>null);
  // WMS host permission is deliberately absent. Existence + the nonce-bound, browser-supplied
  // sender document identity is sufficient; do not request broad tabs access just to read its URL.
  if(!controller||controller.actorId!==binding.actorId||controller.documentId!==binding.controllerDocumentId||controller.nonce!==binding.controllerNonce||!controllerTab)throw new AssistantError('HANDSHAKE_REQUIRED');
  const erpTab=await chrome.tabs.get(binding.erpTabId).catch(()=>null);
  if(!erpTab||!isErpUrl(erpTab.url))throw new AssistantError('BOUND_TAB_NOT_AVAILABLE');
  if(!binding.erpDocumentId)throw new AssistantError('BIND_ECOUNT_TAB_FIRST');
  // Read the current singleton binding immediately before every injection. A popup rebind or
  // unbind invalidates captured work, including a rebind to the same actor and native document.
  await assertCurrentBinding(binding);
  const results = await chrome.scripting.executeScript({ target:{ tabId:binding.erpTabId, documentIds:[binding.erpDocumentId] }, world:'ISOLATED', func:inspectEcountDocument, args:[{...input,companyEvidence:binding.companyEvidence||null}] });
  // Discard an in-flight read/probe result if the operator changed the binding while Chrome ran it.
  // If this was a save injection, its durable intent remains uncertain and may only be read back.
  await assertCurrentBinding(binding);
  if(results.length!==1||results[0].documentId!==binding.erpDocumentId)throw new AssistantError('ERP_DOCUMENT_CHANGED');
  const result = results.length === 1 ? results[0].result : null;
  if (!result) throw new AssistantError('DOCUMENT_NOT_READABLE');
  return result;
}
const formProofKey=(binding,jobId)=>`form-proof:${binding.actorId}:${jobId}`;
async function readWithExpectedFormat(binding,expected){
  let read=await inspect(binding,{operation:'read',expected});
  if(read.ok||read.errorCode!=='AMBIGUOUS_FORM_FIELD'||!binding.companyEvidence)return read;
  const format=await inspect(binding,{operation:'ensure-format',expected});
  if(!format.ok)return format;
  for(let attempts=0;attempts<20;attempts++){
    await new Promise(resolve=>setTimeout(resolve,100));
    read=await inspect(binding,{operation:'read',expected});
    if(read.ok||!['AMBIGUOUS_FORM_FIELD','DOCUMENT_ADAPTER_NOT_VERIFIED','OPEN_EXISTING_SALES_VOUCHER'].includes(read.errorCode))return read;
  }
  return read;
}
async function readOriginalDocument(binding,expected,jobId){
  const proofKey=UUID.test(jobId||'')?formProofKey(binding,jobId):null;
  const proof=proofKey?(await chrome.storage.local.get(proofKey))[proofKey]:null;
  let freshInstanceProven=false;
  if(proof?.requiresFreshRead){
    const probe=await inspect(binding,{operation:'probe',expected});
    const currentFormId=probe.diagnostic?.formId;
    if(currentFormId){
      // Changing input format rebuilds a provider form from client state and is NOT a server read.
      // Only a newly company-verified native Chrome document is usable here, once. Otherwise the
      // operator must close the form so the assistant can reopen the normal query result itself.
      const newNativeDocument=!!proof.erpDocumentId&&binding.erpDocumentId!==proof.erpDocumentId&&proof.lastReadDocumentId!==binding.erpDocumentId&&proof.freshReadDocumentId!==binding.erpDocumentId;
      freshInstanceProven=!!binding.companyEvidence&&newNativeDocument;
      if(!freshInstanceProven)throw new AssistantError('READBACK_REOPEN_ORIGINAL_REQUIRED');
    }
  }
  const first=await readWithExpectedFormat(binding,expected);
  if(first.ok){
    if(proof?.requiresFreshRead){
      if(!freshInstanceProven||!first.uiEvidence?.formId)throw new AssistantError('READBACK_REOPEN_ORIGINAL_REQUIRED');
      await chrome.storage.local.set({[proofKey]:{...proof,lastReadFormId:first.uiEvidence.formId,lastReadDocumentId:binding.erpDocumentId,freshReadAt:Date.now()}});
    }
    return first;
  }
  if(!['DOCUMENT_ADAPTER_NOT_VERIFIED','OPEN_EXISTING_SALES_VOUCHER'].includes(first.errorCode))throw new AssistantError(first.errorCode);
  if(!binding.companyEvidence)throw new AssistantError(first.errorCode);
  // Open only a unique, already-visible query result for the exact voucher. Never synthesize URLs,
  // search broad company data, close a dirty form or click through a draft/confirmation dialog.
  const located=await inspect(binding,{operation:'locate',expected});
  if(!located.ok)throw new AssistantError(located.errorCode);
  for(let attempts=0;attempts<40;attempts++){
    await new Promise(resolve=>setTimeout(resolve,100));
    const read=await readWithExpectedFormat(binding,expected);
    if(read.ok){
      if(proofKey&&proof?.requiresFreshRead){
        if(!read.uiEvidence?.formId)throw new AssistantError('FRESH_FORM_IDENTITY_NOT_VERIFIED');
        // Consume this fresh view before returning it. Later edits of the same open form cannot
        // reuse an earlier fresh-read decision, even when the first readback did not match.
        await chrome.storage.local.set({[proofKey]:{...proof,lastReadFormId:read.uiEvidence.formId,lastReadDocumentId:binding.erpDocumentId,freshReadAt:Date.now()}});
      }
      return read;
    }
    if(!['DOCUMENT_ADAPTER_NOT_VERIFIED','OPEN_EXISTING_SALES_VOUCHER'].includes(read.errorCode))throw new AssistantError(read.errorCode);
  }
  throw new AssistantError('ORIGINAL_DOCUMENT_NOT_OPENED');
}
function engineFor(binding, context={}) {
  return createEngine({ receipts:receiptsFor(binding.actorId), adapter:{
    async capabilities() { const probe = await inspect(binding, { operation:'probe',expected:context.expected }); if (!probe.ok) throw new AssistantError(probe.errorCode); return probe.diagnostic.capabilities; },
    async read() { return (await readOriginalDocument(binding,context.expected,context.jobId)).snapshot; },
    async saveMetadata(input) {
      if(!UUID.test(context.jobId||''))throw new AssistantError('INVALID_JOB');
      const before=await inspect(binding,{operation:'read',expected:context.expected});
      if(!before.ok||!before.uiEvidence?.formId)throw new AssistantError(before.errorCode||'FORM_IDENTITY_NOT_VERIFIED');
      // Persist a UI proof barrier before changing the editable DOM. A filled but unsaved form
      // is never accepted as readback, even after service-worker restart or a lost response.
      const proofKey=formProofKey(binding,context.jobId);
      await chrome.storage.local.set({[proofKey]:{requiresFreshRead:true,sourceFormId:before.uiEvidence.formId,erpDocumentId:binding.erpDocumentId,companyCode:context.expected.companyCode,voucherNumber:context.expected.voucherNumber,startedAt:Date.now()}});
      const saved=await inspect(binding,{operation:'save',permit:context.permit,expected:context.expected,...input});
      if(!saved.ok)throw new AssistantError(saved.errorCode);
      if(saved.originalFormClosed!==true)throw new AssistantError('FRESH_READBACK_REQUIRED');
    }
  } });
}
async function handlePage(message, sender) {
  if (!sender.tab || sender.frameId !== 0 || !isControllerUrl(sender.url) || !sender.documentId || message.channel !== CHANNEL || !NONCE.test(message.nonce || '') || !UUID.test(message.requestId || '') || !REQUEST_TYPES.includes(message.type) || containsCredentialKey(message.payload) || new TextEncoder().encode(JSON.stringify(message)).length > MAX_MESSAGE_BYTES) return replyError('UNTRUSTED_CONTROLLER');
  if (message.type === 'HELLO') {
    const actorId = message.payload?.actorId;
    if (!Number.isSafeInteger(actorId) || actorId < 1) return replyError('ACTOR_REQUIRED');
    const previous = await getController(sender.tab.id);
    if (previous && (previous.nonce !== message.nonce || previous.actorId !== actorId || previous.documentId !== sender.documentId)) { activeReceipts.delete(sender.tab.id); await chrome.storage.session.remove('operatorBinding'); }
    let companyMappings;
    try{companyMappings=validateCompanyMappings(message.payload?.companyMappings);}catch(error){return replyError(error.message);}
    if(previous&&JSON.stringify(previous.companyMappings)!==JSON.stringify(companyMappings)){activeReceipts.delete(sender.tab.id);await chrome.storage.session.remove('operatorBinding');}
    const record={ nonce:message.nonce, actorId, documentId:sender.documentId,origin:new URL(sender.url).origin, label:String(message.payload?.actorLabel || actorId).slice(0,80),companyMappings };
    controllers.set(sender.tab.id,record);await chrome.storage.session.set({[controllerKey(sender.tab.id)]:record});
    return { ok:true, result:{ protocolVersion:1, mode:'preview', saveEnabled:false } };
  }
  const controller = await getController(sender.tab.id);
  if (!controller || controller.nonce !== message.nonce || controller.documentId !== sender.documentId) return replyError('HANDSHAKE_REQUIRED');
  if (message.type === 'PING') return { ok:true, result:{ protocolVersion:1 } };
  if (message.type === 'GET_CAPABILITIES') {
    let binding;
    try { binding = await bindingFor(sender, message.nonce); } catch { return { ok:true, result:{ bound:false, mode:'preview', saveEnabled:false } }; }
    const probe = await inspect(binding, { operation:'probe' });
    return { ok:true, result:{ bound:true,companyVerified:!!binding.companyEvidence, mode:'preview', saveEnabled:false, ...probe.diagnostic, errorCode:probe.ok ? null : probe.errorCode } };
  }
  if (running.has(sender.tab.id)||bindingMutation) return replyError('ASSISTANT_BUSY');
  running.add(sender.tab.id);
  let engineStarted=false;
  try {
    const binding = await bindingFor(sender, message.nonce);
    if (message.type === 'READ_DOCUMENT') {
      const read = await readOriginalDocument(binding,{companyCode:message.payload?.companyCode,voucherNumber:message.payload?.voucherNumber});
      return { ok:true, result:{ before:read.snapshot, capabilities:read.capabilities } };
    }
    if (message.type === 'PREVIEW_PLAN') {
      const { jobId, plan, planFingerprint } = message.payload || {};
      if (!UUID.test(jobId || '') || !/^[a-f0-9]{64}$/.test(planFingerprint || '')) return replyError('INVALID_PLAN');
      const result = await engineFor(binding,{jobId,expected:{companyCode:plan.companyCode,voucherNumber:plan.voucherNumber}}).preview({ jobId, plan });
      if (result.preview.planFingerprint !== planFingerprint) return replyError('PLAN_FINGERPRINT_MISMATCH');
      activeReceipts.set(sender.tab.id, { jobId, preview:result.preview, binding,plan });
      return { ok:true, result };
    }
    if (message.type === 'READ_BACK') {
      let active = activeReceipts.get(sender.tab.id);
      const {jobId,planFingerprint,plan}=message.payload||{};
      if(!UUID.test(jobId||'')||!/^[a-f0-9]{64}$/.test(planFingerprint||''))return replyError('INVALID_PLAN');
      if (!active || active.jobId!==jobId || active.binding.erpTabId!==binding.erpTabId || active.preview.planFingerprint!==planFingerprint) {
        const receipt=await receiptsFor(binding.actorId).get(jobId);
        if(!receipt||receipt.planFingerprint!==planFingerprint||!plan||await fingerprint(plan)!==planFingerprint||plan.companyCode!==receipt.companyCode||plan.voucherNumber!==receipt.voucherNumber)return replyError('NO_SAVE_TO_RECOVER');
        active={jobId,binding,plan,preview:{jobId,companyCode:plan.companyCode,voucherNumber:plan.voucherNumber,planFingerprint,beforeFingerprint:receipt.businessFingerprint,versionToken:plan.expectedVersionToken,rows:plan.rows}};
      }
      return { ok:true, result:await engineFor(binding,{jobId,expected:{companyCode:active.preview.companyCode,voucherNumber:active.preview.voucherNumber}}).recover(active) };
    }
    if(message.type==='SAVE_PLAN'){
      const active=activeReceipts.get(sender.tab.id),{jobId,planFingerprint,permit}=message.payload||{};
      if(!active||active.jobId!==jobId||active.preview.planFingerprint!==planFingerprint||active.binding.erpTabId!==binding.erpTabId)return rejectedBeforeEngine(controller.actorId,jobId,'PREVIEW_REQUIRED');
      if(active.plan.saveAllowed!==true||permit?.mode!==active.plan.mode||permit?.testWriteEnabled!==active.plan.testWriteEnabled||permit?.mode==='live'&&!/^[a-f0-9]{64}$/.test(active.plan.acceptanceProof||''))return rejectedBeforeEngine(controller.actorId,jobId,'SAVE_DISABLED_VENDOR_ACCEPTANCE_PENDING');
      engineStarted=true;
      const result=await engineFor(binding,{jobId,permit,expected:{companyCode:active.preview.companyCode,voucherNumber:active.preview.voucherNumber}}).apply({jobId,preview:active.preview,permit});
      return {ok:true,result:result.outcome==='saved'&&permit.mode==='test'?{...result,outcome:'test_verified'}:result};
    }
    return replyError('UNSUPPORTED_OPERATION');
  } catch(error){
    if(message.type==='SAVE_PLAN'&&!engineStarted)return rejectedBeforeEngine(controller.actorId,message.payload?.jobId,error.code||'PRE_SAVE_REJECTED');
    throw error;
  } finally { running.delete(sender.tab.id); }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = async () => {
    if (sender.id !== chrome.runtime.id) return replyError('UNTRUSTED_EXTENSION');
    const popupSender=sender.url===`chrome-extension://${chrome.runtime.id}/popup.html`&&(!sender.tab||sender.frameId===0);
    // A DOM save already dispatched to Chrome cannot be recalled. Do not allow another binding
    // to start a second writer, or imply that disconnecting could cancel that external action.
    const changesBinding=popupSender&&['POPUP_BIND','POPUP_UNBIND','POPUP_VERIFY_COMPANY'].includes(message?.type);
    if(changesBinding){if(running.size||bindingMutation)return replyError('ASSISTANT_BUSY');bindingMutation=true;}
    try{
    if (message?.type === 'POPUP_STATUS' && popupSender) {
      const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
      return { ok:true, result:{ canBind:!!tab && isErpUrl(tab.url), controllers:(await registeredControllers()).map(([tabId,c]) => ({ tabId, actorId:c.actorId, label:c.label,canVerifyCompany:c.companyMappings.length>0 })), bound:(await chrome.storage.session.get('operatorBinding')).operatorBinding || null } };
    }
    if (message?.type === 'POPUP_BIND' && popupSender) {
      const controller = await getController(message.controllerTabId);
      const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
      if (!controller || !tab || !isErpUrl(tab.url)) return replyError('SELECT_VALID_ECOUNT_TAB');
      const probes=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:inspectEcountDocument,args:[{operation:'probe'}]});
      if(probes.length!==1||!probes[0].documentId)return replyError('ERP_DOCUMENT_NOT_READY');
      if(controllers.get(message.controllerTabId)!==controller)return replyError('HANDSHAKE_REQUIRED');
      await chrome.storage.session.set({ operatorBinding:{ bindingId:crypto.randomUUID(),erpTabId:tab.id,erpDocumentId:probes[0].documentId, controllerTabId:message.controllerTabId, actorId:controller.actorId, controllerDocumentId:controller.documentId,controllerNonce:controller.nonce,companyEvidence:null } });
      return { ok:true };
    }
    if(message?.type==='POPUP_VERIFY_COMPANY'&&popupSender){
      const binding=(await chrome.storage.session.get('operatorBinding')).operatorBinding;
      const controller=binding&&await getController(binding.controllerTabId);
      const [activeTab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!binding||!controller||controller.actorId!==binding.actorId||controller.documentId!==binding.controllerDocumentId||controller.nonce!==binding.controllerNonce||activeTab?.id!==binding.erpTabId||!controller.companyMappings.length)return replyError('BIND_COMPANY_MAPPING_FIRST');
      const evidence=await chrome.scripting.executeScript({target:{tabId:binding.erpTabId,documentIds:[binding.erpDocumentId]},world:'ISOLATED',func:inspectEcountCompany});
      const result=evidence.length===1&&evidence[0].documentId===binding.erpDocumentId?evidence[0].result:null;
      if(!result?.ok)return replyError(result?.errorCode||'COMPANY_ID_NOT_VERIFIED');
      const mappings=controller.companyMappings.filter(row=>row.companyName===result.companyName&&row.taxId===result.taxId);
      if(mappings.length!==1)return replyError('COMPANY_MAPPING_MISMATCH');
      const latest=(await chrome.storage.session.get('operatorBinding')).operatorBinding;
      if(controllers.get(binding.controllerTabId)!==controller||!latest||bindingIdentityKeys.some(key=>latest[key]!==binding[key]))return replyError('HANDSHAKE_REQUIRED');
      const companyEvidence={...mappings[0],erpDocumentId:binding.erpDocumentId,observedAt:new Date().toISOString(),basis:'visible-company-name-and-readonly-tax-id'};
      await chrome.storage.session.set({operatorBinding:{...binding,companyEvidence}});
      return {ok:true,result:{companyCode:companyEvidence.companyCode,companyName:companyEvidence.companyName,taxId:companyEvidence.taxId}};
    }
    if (message?.type === 'POPUP_UNBIND' && popupSender) { await chrome.storage.session.remove('operatorBinding'); activeReceipts.clear(); return { ok:true }; }
    return handlePage(message || {}, sender);
    }finally{if(changesBinding)bindingMutation=false;}
  };
  task().then(sendResponse, error => sendResponse(replyError(error.code || 'ASSISTANT_FAILED')));
  return true;
});
chrome.tabs.onRemoved.addListener(async id => {
  await clearController(id);
  const binding = (await chrome.storage.session.get('operatorBinding')).operatorBinding;
  if (binding && [binding.erpTabId,binding.controllerTabId].includes(id)) await chrome.storage.session.remove('operatorBinding');
});
chrome.tabs.onUpdated.addListener(async (id, change) => {
  if (change.status==='loading'||change.url&&!isControllerUrl(change.url))await clearController(id);
  if(change.status==='loading'){
    const binding=(await chrome.storage.session.get('operatorBinding')).operatorBinding;
    if(binding&&[binding.erpTabId,binding.controllerTabId].includes(id)){await chrome.storage.session.remove('operatorBinding');activeReceipts.delete(binding.controllerTabId);}
  }
});
