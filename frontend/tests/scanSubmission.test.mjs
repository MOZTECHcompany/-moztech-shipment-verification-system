import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanSubmission } from '../src/utils/scanSubmission.js';

test('rapid input has one request and explicit rejection details for every pending barcode', async () => {
    const gate = createScanSubmission();
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const sent = [];
    const operation = async code => { sent.push(code); await pending; };
    const first = gate.submit('SN-000', operation);
    const rejected = [];
    for (let i = 1; i <= 100; i++) rejected.push(gate.submit(`SN-${i}`, operation));
    await Promise.resolve();
    assert.deepEqual(sent, ['SN-000']);
    assert.equal(rejected.length, 100);
    rejected.forEach((result, index) => assert.deepEqual(result, { accepted: false, reason: 'busy', scanValue: `SN-${index + 1}` }));
    finish();
    await first.completion;
    assert.deepEqual(sent, ['SN-000']); // No automatic replay.
    const explicitResubmit = gate.submit('SN-1', operation);
    assert.equal(explicitResubmit.accepted, true);
    await explicitResubmit.completion;
    assert.deepEqual(sent, ['SN-000', 'SN-1']);
});

test('uncertain request remains blocked after its promise settles', async () => {
    const gate = createScanSubmission();
    const first = gate.submit('SN-1', async () => { gate.requireReview(); });
    await first.completion;
    let calls = 0;
    const retry = gate.submit('SN-1', () => { calls++; });
    assert.deepEqual(retry, { accepted: false, reason: 'review', scanValue: 'SN-1' });
    assert.equal(calls, 0);
});

test('a rejected operation releases the synchronous lock without retrying it', async () => {
    const gate = createScanSubmission();
    let calls = 0;
    const result = gate.submit('SN-1', async () => { calls++; throw new Error('rejected'); });
    await assert.rejects(result.completion, /rejected/);
    assert.equal(gate.isBusy(), false);
    assert.equal(calls, 1);
});
