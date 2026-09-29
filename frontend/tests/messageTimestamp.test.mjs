import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { formatMessageTimestamp, parseMessageTimestamp } from '../src/utils/messageTimestamp.js';

for (const value of ['2026-09-29T05:53:59.263438', '2026-09-29 05:53:59.263438', '2026-09-29T05:53:59.263Z', '2026-09-29T13:53:59.263+08:00']) {
    test(`card and conversation share the same Taiwan time for ${value}`, () => {
        assert.equal(formatMessageTimestamp(value), '2026/09/29 13:53');
        assert.equal(parseMessageTimestamp(value).toISOString(), '2026-09-29T05:53:59.263Z');
    });
}

test('Taiwan midnight and invalid message dates remain explicit', () => {
    assert.equal(formatMessageTimestamp('2026-12-31T16:00:00'), '2027/01/01 00:00');
    assert.equal(formatMessageTimestamp('2026-09-29T23:53:00+08:00'), '2026/09/29 23:53');
    for (const value of [null, undefined, '', 'not a timestamp']) {
        assert.equal(formatMessageTimestamp(value), '時間未知');
        assert.equal(parseMessageTimestamp(value), null);
    }
});

for (const tz of ['UTC', 'Asia/Taipei', 'America/Los_Angeles']) {
    test(`legacy and current comments display and sort consistently on a ${tz} workstation`, () => {
        const script = `
            import assert from 'node:assert/strict';
            import {formatMessageTimestamp} from ${JSON.stringify(new URL('../src/utils/messageTimestamp.js', import.meta.url).href)};
            import {flattenCommentPages} from ${JSON.stringify(new URL('../src/api/commentPages.js', import.meta.url).href)};
            assert.equal(formatMessageTimestamp('2026-09-29T05:53:59.263438'),'2026/09/29 13:53');
            assert.equal(formatMessageTimestamp('2026-09-29T05:53:59.263Z'),'2026/09/29 13:53');
            assert.deepEqual(flattenCommentPages({pages:[{items:[
                {id:2,created_at:'2026-09-29T05:54:00Z'},
                {id:1,created_at:'2026-09-29T05:53:59.263438'}
            ]}]}).map(x=>x.id),[1,2]);
        `;
        execFileSync(process.execPath, ['--input-type=module', '-e', script], {env:{...process.env,TZ:tz}});
    });
}
