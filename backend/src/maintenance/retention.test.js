const { retentionPolicy, runRetention, main } = require('./retention');
test('requires an explicit target and rejects unsafe periods before connecting', async () => {
  await expect(main({})).rejects.toThrow('WMS_TARGET_DATABASE_REQUIRED');
  for (const value of ['0', '-1', '30days', '1.5', '999999999']) expect(() => retentionPolicy({ WMS_TARGET_DATABASE: 'test', RETENTION_LOGS_DAYS: value })).toThrow('INVALID_RETENTION_POLICY');
});
test('database mismatch rolls back without calling the purge function', async () => {
  const statements = [];
  const client = { query: async sql => { statements.push(sql); return { rows: [{ database: 'another_system' }] }; } };
  await expect(runRetention({ client, env: { WMS_TARGET_DATABASE: 'wms', WMS_RETENTION_APPLY: 'true' } })).rejects.toThrow('TARGET_DATABASE_MISMATCH');
  expect(statements.at(-1)).toBe('ROLLBACK');
  expect(statements.some(sql => sql.includes('run_all_purge'))).toBe(false);
});
test('default is a read-only preview; explicit apply is required for deletion', async () => {
  for (const apply of [undefined, 'true']) {
    const statements = [];
    const client = { query: async sql => { statements.push(sql); return { rows: [{ database: 'wms', result: {} }] }; } };
    const result = await runRetention({ client, env: { WMS_TARGET_DATABASE: 'wms', WMS_RETENTION_APPLY: apply } });
    expect(statements[0]).toBe(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    expect(statements.some(sql => sql.includes('run_all_purge'))).toBe(Boolean(apply));
    expect(result.mode).toBe(apply ? 'applied' : 'preview');
  }
});
