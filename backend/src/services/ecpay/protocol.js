'use strict';
const { createHash, timingSafeEqual } = require('node:crypto');
class LogisticsError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function fields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LogisticsError('INVALID_FIELDS', '物流資料格式不正確');
  const result = Object.create(null), seen = new Set();
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || seen.has(key.toLowerCase())) throw new LogisticsError('INVALID_FIELDS', '物流欄位重複或不正確');
    seen.add(key.toLowerCase());
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw new LogisticsError('INVALID_FIELDS', '物流欄位必須是文字或數字');
    result[key] = String(value);
  }
  return result;
}
function mac(input, credentials) {
  const data = fields(input);
  if (!credentials?.hashKey || !credentials?.hashIv) throw new LogisticsError('CREDENTIALS_MISSING', '物流金鑰尚未配置', 503);
  const pairs = Object.keys(data).filter(k => k.toLowerCase() !== 'checkmacvalue').sort((a,b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1).map(k => `${k}=${data[k]}`).join('&');
  const encoded = encodeURIComponent(`HashKey=${credentials.hashKey}&${pairs}&HashIV=${credentials.hashIv}`).replace(/%20/g, '+').replace(/~/g, '%7e').toLowerCase();
  return createHash('md5').update(encoded).digest('hex').toUpperCase();
}
function verify(input, credentials) {
  const provided = input?.CheckMacValue;
  if (typeof provided !== 'string' || !/^[A-Fa-f0-9]{32}$/.test(provided)) return false;
  try { return timingSafeEqual(Buffer.from(provided.toUpperCase()), Buffer.from(mac(input, credentials))); } catch { return false; }
}
function parseForm(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536 || !text.includes('=')) throw new LogisticsError('INVALID_PROVIDER_RESPONSE', '綠界回覆格式不正確', 502);
  const result = Object.create(null), seen = new Set();
  for (const [k,v] of new URLSearchParams(text.trim())) {
    if (seen.has(k.toLowerCase())) throw new LogisticsError('INVALID_PROVIDER_RESPONSE', '綠界回覆含重複欄位', 502);
    seen.add(k.toLowerCase()); result[k] = v;
  }
  return fields(result);
}
module.exports = { LogisticsError, fields, mac, verify, parseForm };
