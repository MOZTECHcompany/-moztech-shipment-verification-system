(() => {
  'use strict';
  const channel = 'corely.ecount-assistant.v1';
  const origins = ['https://wms.corely.cc', 'https://corely-wms-249593319772.asia-east1.run.app'];
  if (window !== window.top || !origins.includes(location.origin)) return;
  let nonce = null;
  const pending = new Set();
  const permitted = new Set(['HELLO','PING','GET_CAPABILITIES','READ_DOCUMENT','PREVIEW_PLAN','SAVE_PLAN','READ_BACK']);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const credentialKey=(value,depth=0)=>depth>24||!!value&&typeof value==='object'&&Object.entries(value).some(([key,nested])=>/^(?:authorization|token|access_?token|refresh_?token|auth_?token|id_?token|jwt|cookie|password|session_?id|session_?url|ec_req_sid)$/i.test(key)||credentialKey(nested,depth+1));
  window.addEventListener('message', async event => {
    if(location.pathname!=='/settings/ecount-assistant'){nonce=null;pending.clear();return;}
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || !data || data.channel !== channel || data.direction !== 'page-to-extension' || !permitted.has(data.type) || !uuid.test(data.requestId || '') || !/^[0-9a-f]{32}$/i.test(data.nonce || '')) return;
    try { if (credentialKey(data.payload) || new TextEncoder().encode(JSON.stringify(data)).length > 196608) return; } catch { return; }
    if (data.type === 'HELLO') { if (pending.size) return; nonce = data.nonce; }
    if (!nonce || data.nonce !== nonce || pending.has(data.requestId) || pending.size > 8) return;
    pending.add(data.requestId);
    try {
      const reply = await chrome.runtime.sendMessage({ channel, nonce, requestId: data.requestId, type: data.type, payload: data.payload ?? null });
      if (nonce !== data.nonce || location.pathname!=='/settings/ecount-assistant') return;
      window.postMessage({ channel, direction:'extension-to-page', nonce, requestId:data.requestId, type:'RESULT', payload:reply }, location.origin);
    } catch {
      if(nonce!==data.nonce||location.pathname!=='/settings/ecount-assistant')return;
      window.postMessage({ channel, direction:'extension-to-page', nonce, requestId:data.requestId, type:'RESULT', payload:{ ok:false, errorCode:'EXTENSION_DISCONNECTED' } }, location.origin);
    } finally { pending.delete(data.requestId); }
  });
  // No credentials are requested/read, and no ERP data is broadcast until the controller starts a nonce-bound handshake.
})();
