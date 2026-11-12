export function marketplacePreviewError(error) {
  const code = error.response?.data?.code || error.code;
  if (['ECONNABORTED', 'ETIMEDOUT', 'SHOPIFY_TIMEOUT', 'MARKETPLACE_VERIFICATION_TIMEOUT'].includes(code)) {
    return '訂單核對逾時。檔案已保留，請重新核對。';
  }
  if (code === 'SHOPIFY_THROTTLED') {
    return 'Shopify 讀單繁忙。檔案已保留，可稍後重新核對。';
  }
  if (code === 'WMS_NATIVE_RESULT_UNKNOWN') {
    return '暫時無法取得訂單核對結果。檔案已保留，請重新核對。';
  }
  return '';
}
