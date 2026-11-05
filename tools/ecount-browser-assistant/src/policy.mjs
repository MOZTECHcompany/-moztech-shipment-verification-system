export const CHANNEL = 'corely.ecount-assistant.v1';
export const PROTOCOL_VERSION = 1;
export const WMS_ORIGINS = Object.freeze(['https://wms.corely.cc', 'https://corely-wms-249593319772.asia-east1.run.app']);
export const ERP_ORIGINS = Object.freeze(['https://loginib.ecount.com']);
export const CONTROLLER_PATH = '/settings/ecount-assistant';
export const MAX_MESSAGE_BYTES = 192 * 1024;
export const REQUEST_TYPES = Object.freeze(['HELLO', 'PING', 'GET_CAPABILITIES', 'READ_DOCUMENT', 'PREVIEW_PLAN', 'SAVE_PLAN', 'READ_BACK']);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const NONCE = /^[0-9a-f]{32}$/i;
export function containsCredentialKey(value,depth=0){
  if(depth>24)return true;
  if(!value||typeof value!=='object')return false;
  return Object.entries(value).some(([key,nested])=>/^(?:authorization|token|access_?token|refresh_?token|auth_?token|id_?token|jwt|cookie|password|session_?id|session_?url|ec_req_sid)$/i.test(key)||containsCredentialKey(nested,depth+1));
}

export function isControllerUrl(value, origins = WMS_ORIGINS) {
  try { const url = new URL(value); return origins.includes(url.origin) && url.pathname === CONTROLLER_PATH && !url.username && !url.password; } catch { return false; }
}
export function isErpUrl(value, origins = ERP_ORIGINS) {
  try { const url = new URL(value); return origins.includes(url.origin) && url.pathname.toLowerCase() === '/ec56/view/erp' && !url.username && !url.password; } catch { return false; }
}
export function allowedBridgeMessage(event, { windowObject, origin, nonce, types = REQUEST_TYPES }) {
  const data = event.data;
  if (event.source !== windowObject || event.origin !== origin || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.channel !== CHANNEL || data.direction !== 'page-to-extension' || !NONCE.test(data.nonce || '') || (nonce && data.nonce !== nonce)) return false;
  if (!UUID.test(data.requestId || '') || !types.includes(data.type)) return false;
  try { return !containsCredentialKey(data.payload) && new TextEncoder().encode(JSON.stringify(data)).length <= MAX_MESSAGE_BYTES; } catch { return false; }
}
