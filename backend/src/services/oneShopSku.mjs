export const ONESHOP_CAMPAIGN_SKU_FORMAT = '1shop-barcode-campaign-v1';

// This is the confirmed 1Shop naming convention, not a general SKU cleanup.
// Keep the full source SKU for API comparisons and line identity. The final
// hyphen separates the round, so hyphens inside the campaign name survive.
export function parseOneShopSku(value) {
  const match = String(value ?? '').trim().match(/^(\d{13})-(.+)-([^-]+)$/);
  if (!match) return null;
  const campaignGroupName = match[2].trim(), campaignRound = match[3].trim();
  if (!campaignGroupName || !campaignRound) return null;
  return { sourceBarcode: match[1], campaignGroupName, campaignRound, sourceSkuFormat: ONESHOP_CAMPAIGN_SKU_FORMAT };
}
