// Display/queue filtering only. Executable reads still use assertUploadScope,
// including its exact manifest, identity and fingerprint checks.
function currentScopePredicate(alias='i'){
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))throw new TypeError('Invalid scope SQL identifier');
 return `(CASE WHEN ${alias}.snapshot ? 'uploadScope' THEN
  jsonb_typeof(${alias}.snapshot->'uploadScope'->'sourceManifest')='array'
  AND EXISTS(SELECT 1 FROM marketplace_intake_scope_orders sm WHERE sm.intake_id=${alias}.id)
  AND (SELECT COUNT(*) FROM marketplace_intake_scope_orders sm WHERE sm.intake_id=${alias}.id)=jsonb_array_length(CASE WHEN jsonb_typeof(${alias}.snapshot->'uploadScope'->'sourceManifest')='array' THEN ${alias}.snapshot->'uploadScope'->'sourceManifest' ELSE '[]'::jsonb END)
  AND NOT EXISTS(SELECT 1 FROM marketplace_intake_scope_orders sm
   LEFT JOIN marketplace_intake_orders so ON so.id=sm.intake_order_id
   LEFT JOIN marketplace_intakes owner ON owner.id=so.intake_id
   WHERE sm.intake_id=${alias}.id AND (so.id IS NULL OR owner.id IS NULL OR so.draft_active IS NOT TRUE OR owner.archived_at IS NOT NULL OR so.draft_version<>sm.source_version))
 ELSE NOT EXISTS(SELECT 1 FROM marketplace_intake_scope_orders sm JOIN marketplace_intake_orders so ON so.id=sm.intake_order_id WHERE so.intake_id=${alias}.id) END)`;
}
module.exports={currentScopePredicate};
