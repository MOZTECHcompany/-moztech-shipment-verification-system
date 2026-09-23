import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transform } from 'esbuild';
import * as XLSX from 'xlsx';
import * as intake from '../src/utils/marketplaceIntake.mjs';
import * as unified from '../src/utils/unifiedMarketplace.mjs';
import * as sessions from '../src/utils/importBatches.js';

const source = await readFile(new URL('../src/components/admin/MarketplaceConverter.jsx', import.meta.url), 'utf8');
const headers = ['訂單編號', '名稱', '產品SKU', '產品', '產品數量', '單價', '小計', '訂單金額(不含金/物流手續費)', '訂單金流手續費', '訂單運費', '總計金額', '金流狀態', '物流狀態'];
const fixtureRows = [headers,
    ['TST6091550133', '一般品', '00123', 'TEST product A', '1', '10', '10', '10', '0', '0', '10', '已付款', '未出貨'],
    ['TST6091550109', '一般品', '00124', 'TEST product B', '2', '20', '40', '40', '0', '0', '40', '已付款', '未出貨'],
    ['NOT-AUTHORIZED', '一般品', 'PRIVATE-EXCLUDED', 'EXCLUDED ITEM', '1', '10', '10', '10', '0', '0', '10', '已付款', '已出貨'],
];
function file(rows = fixtureRows, name = 'synthetic.csv') {
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Source');
    const bytes = name.endsWith('.csv') ? Buffer.from(XLSX.utils.sheet_to_csv(book.Sheets.Source)) : XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    return { name, size: bytes.length, arrayBuffer: async () => bytes };
}

// Execute the real file/confirmation/download callbacks against SheetJS and the
// real parser. Replace only the lazy module boundary; no network/server is used.
async function converter({ flag = 'dev', role = 'admin', denied = false, resolved = null, profiles = [] } = {}) {
    const { code } = await transform(source.replaceAll("import('xlsx')", '__loadXlsx()'), { loader: 'jsx', format: 'cjs', define: { 'import.meta.env.VITE_DEPLOY_ENV': JSON.stringify(flag) } });
    const hooks = [], effects = [], downloads = [], requests = [], writes = [], listeners = new Map();
    const user = { id: 7, role };
    const storage = new Map([['wms_token', JSON.stringify('synthetic-token')], ['wms_user', JSON.stringify(user)]]);
    let cursor = 0, dirty = false, tree, mounted = true, lateUpdates = 0;
    const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } }),
        useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { if (!mounted) lateUpdates++; const next = typeof value === 'function' ? value(hooks[i].value) : value; if (!Object.is(next, hooks[i].value)) { hooks[i].value = next; dirty = true; } }]; },
        useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
        useMemo(callback, deps) { const i = cursor++; if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { deps, value: callback() }; return hooks[i].value; },
        useEffect(callback, deps) { const i = cursor++; if (!hooks[i] || !same(hooks[i].deps, deps)) { const cleanup = hooks[i]?.cleanup; hooks[i] = { deps }; effects.push(() => { cleanup?.(); hooks[i].cleanup = callback(); }); } },
    };
    const api = { get: async () => { if (denied) throw Error('Forbidden'); return { data: { intakes: [], profiles } }; }, post: async (url, body) => { requests.push({url,body}); if(url==='/api/marketplace-intakes/store-profiles')return {data:{id:9,platform:body.platform,store:body.settings.store,settings:body.settings}}; if(url==='/api/marketplace-products/resolve')return {data:resolved||{sync:null,products:{}}}; if(url.endsWith('/download-link'))return {data:{url:'/api/marketplace-files/1/ecount'}}; if (denied) throw Error('Forbidden'); const built=unified.buildUnifiedConversion(body.rows,body.settings); return {data:{id:1,batchNumber:body.settings.batchNumber,headers:built.output.headers,rows:built.output.rows}}; } };
    const imports = { '../../api/origin': {API_ORIGIN:''}, '@/api/api.js': api, '../../utils/unifiedMarketplace.mjs': unified, react, 'react-router-dom': { Link: 'Link', Navigate: 'Navigate' }, '../../ui': { Button: 'Button', PageHeader: 'PageHeader' }, '../../utils/importBatches': sessions, '../../utils/marketplaceIntake.mjs': intake, 'lucide-react': {}, './MarketplaceBatchManager': 'MarketplaceBatchManager' };
    const module = { exports: {} };
    vm.runInNewContext(code, {
        module, exports: module.exports, require: name => { if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name]; },
        __loadXlsx: async () => ({ ...XLSX, writeFile: (book, name) => downloads.push({ book, name }) }),
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (...args) => writes.push(args), removeItem: (...args) => writes.push(args) },
        window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) },
        fetch: (...args) => { requests.push(args); throw new Error('Converter must not issue requests'); },
        document:{body:{appendChild(){}},createElement:()=>({href:'',download:'',click(){downloads.push({url:this.href});},remove(){}})},
        console, crypto: webcrypto, TextDecoder,
    });
    const expand = node => {
        if (Array.isArray(node)) return node.map(expand);
        if (!node || typeof node !== 'object') return node;
        if (typeof node.type === 'function') return expand(node.type(node.props));
        return { ...node, props: { ...node.props, children: (node.props?.children || []).map(expand) } };
    };
    const render = () => {
        if (!mounted) return tree;
        for (let i = 0; i < 10; i++) { cursor = 0; dirty = false; tree = expand(module.exports.MarketplaceConverter({ user })); while (effects.length) effects.shift()(); if (!dirty) return tree; }
        throw new Error('Render did not settle');
    };
    function find(node, predicate) { if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return undefined; } if (!node || typeof node !== 'object') return undefined; if (predicate(node)) return node; return find(node.props?.children || [], predicate); }
    const text = node => Array.isArray(node) ? node.map(text).join(' ') : node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : text(node.props?.children || []);
    const all = predicate => { const result = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; if (predicate(node)) result.push(node); walk(node.props?.children || []); }; walk(render()); return result; };
    const button = label => find(render(), node => node.type === 'Button' && text(node).includes(label));
    const label = value => find(render(), node => node.type === 'label' && text(node).trim().startsWith(value));
    const change = (name, value) => { const control = find(label(name), node => ['input', 'select'].includes(node.type)); assert.ok(control, `Control ${name}`); control.props.onChange({ target: { value, checked: value } }); render(); };
    const select = async (...files) => { await find(render(), node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files, value: 'selected' } }); render(); };
    render();
    for (let i=0;i<5;i++) await Promise.resolve();
    render();
    return { render, find, text, all, button, change, select, downloads, requests, writes, storage, listeners, unmount: () => { mounted = false; hooks.forEach(h => h?.cleanup?.()); }, lateUpdates: () => lateUpdates };
}

test('converter route guard preserves authorized roles across deployment environments', async () => {
    for (const flag of ['production', '']) for (const role of ['admin', 'superadmin', 'dispatcher']) assert.equal((await converter({ flag, role })).render().type, 'main');
    for (const role of ['picker', 'packer', 'unknown']) assert.equal((await converter({ role })).render().type, 'Navigate');
    for (const role of ['admin', 'superadmin', 'dispatcher']) assert.equal((await converter({ role })).render().type, 'main');
});

test('file selection automatically detects 1Shop and excludes fulfilled orders from selected products and preserves CSV identifiers while resolving products without saving orders', async () => {
    const view = await converter(); await view.select(file());
    assert.match(view.text(view.render()), /本批納入\s+2\s+筆、\s*2\s+商品列、\s*3\s+件/);
    assert.match(view.text(view.render()), /00123/); assert.match(view.text(view.render()), /已付款/);
    assert.doesNotMatch(view.text(view.render()), /PRIVATE-EXCLUDED|EXCLUDED ITEM/);
    assert.equal(view.button('銷貨檔 → 上傳 ECOUNT').props.disabled, true);
    assert.equal(view.requests.length, 1); assert.equal(view.requests[0].url,'/api/marketplace-products/resolve'); assert.equal(view.writes.length, 0); assert.equal(view.downloads.length, 0);
});

test('invalid file inputs are rejected before parsing or download', async () => {
    const view = await converter();
    for (const files of [[{ name: 'x.pdf', size: 10 }], [{ name: 'x.csv', size: 0 }], [{ name: 'x.csv', size: 10 * 1024 * 1024 + 1 }], [file(), file()]]) {
        await view.select(...files); assert.match(view.text(view.render()), /一個非空白的 Excel 或 CSV/);
    }
    assert.equal(view.requests.length, 0); assert.equal(view.downloads.length, 0);
});

test('ECOUNT download requires ERP, customer, tax and unpaid-test confirmation but not a barcode; ERP edits invalidate mapping', async () => {
    const view = await converter(); await view.select(file(fixtureRows, 'synthetic.xlsx'));
    let cards = view.all(node => node.type === 'div' && node.props.className === 'rounded-lg border border-slate-200 p-4');
    for (let index = 0; index < cards.length; index++) {
        const fields = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; if (node.type === 'input') fields.push(node); walk(node.props.children); }; walk(cards[index]);
        fields[0].props.onChange({ target: { value: `ERP-${index}` } }); view.render();
        cards = view.all(node => node.type === 'div' && node.props.className === 'rounded-lg border border-slate-200 p-4');
        view.find(cards[index], node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); view.render();
    }
    view.change('商城店鋪', '合成店鋪'); view.change('ECOUNT 銷貨客戶編碼', '00027'); view.change('已確認本次金額為 TWD', true);
    assert.equal(view.button('銷貨檔 → 上傳 ECOUNT').props.disabled, false, view.text(view.find(view.render(), node => node.props?.['aria-label'] === '轉檔檢查結果')));
    await view.button('銷貨檔 → 上傳 ECOUNT').props.onClick(); view.render();
    assert.equal(view.downloads.length, 1);
    assert.equal(view.downloads[0].url,'/api/marketplace-files/1/ecount');
    assert.match(view.text(view.render()),/銷貨檔已下載/);
    assert.ok(view.find(view.render(), node => node.props?.to === "?batch=1&view=return#batch-detail"));
    view.change('ECOUNT 品項編碼', 'CHANGED'); assert.equal(view.button('銷貨檔 → 上傳 ECOUNT').props.disabled, true);
    assert.equal(view.requests.length, 3); assert.equal(view.requests[1].url, '/api/marketplace-intakes'); assert.equal(view.requests[2].url,'/api/marketplace-intakes/1/download-link'); assert.equal(view.writes.length, 0);
});

test('draft audit downloads without customer, tax, payment release or barcode confirmation and preserves numeric money', async () => {
    const view = await converter(); await view.select(file());
    assert.equal(view.button('銷貨檔 → 上傳 ECOUNT').props.disabled, true);
    assert.equal(view.button('預揀與金額核對表').props.disabled, false);
    await view.button('預揀與金額核對表').props.onClick(); view.render();
    assert.equal(view.downloads.length, 1);
    const book = view.downloads[0].book;
    assert.deepEqual(book.SheetNames, ['承辦人', '預揀總表', '訂單金額核對', '來源商品對照', '本批納入與排除', 'ECOUNT成交核對']);
    const summary = XLSX.utils.sheet_to_json(book.Sheets['預揀總表'], { header: 1 });
    assert.match(JSON.stringify(summary), /待核對/); assert.match(JSON.stringify(summary), /00123/);
    const items = XLSX.utils.sheet_to_json(book.Sheets['來源商品對照'], { header: 1 });
    assert.equal(items[1][3], '00123'); assert.equal(items[1][6], 10);
    assert.equal(view.requests.length, 1); assert.equal(view.requests[0].url,'/api/marketplace-products/resolve'); assert.equal(view.writes.length, 0);
});

test('non-UTF-8 CSV rejects undecodable text instead of silently replacing identifiers', async () => {
    const view = await converter();
    await view.select({ name: 'invalid-encoding.csv', size: 2, arrayBuffer: async () => Uint8Array.from([0xff, 0xfe]) });
    assert.match(view.text(view.render()), /CSV 請使用 UTF-8/);
    assert.equal(view.button('銷貨檔 → 上傳 ECOUNT'), undefined); assert.equal(view.downloads.length, 0);
});

test('account changes remove the preview and cannot export the previous account draft', async () => {
    const view = await converter(); await view.select(file());
    view.storage.set('wms_user', JSON.stringify({ id: 8, role: 'admin' })); view.listeners.get('storage')();
    assert.doesNotMatch(view.text(view.render()), /00123/); assert.match(view.text(view.render()), /登入人員已變更/);
    assert.equal(view.button('選擇訂單檔').props.disabled, true); assert.equal(view.downloads.length, 0);
});

test('unmounted asynchronous file reads do not reveal or store the completed result', async () => {
    const view = await converter(); let resolve;
    const selected = file(); const bytes = await selected.arrayBuffer(); selected.arrayBuffer = () => new Promise(done => { resolve = done; });
    const pending = view.select(selected); for (let i = 0; i < 10 && !resolve; i++) await Promise.resolve();
    view.unmount(); resolve(bytes); await pending;
    assert.equal(view.lateUpdates(), 0); assert.equal(view.downloads.length, 0); assert.equal(view.writes.length, 0);
});

test('server permission denial disables file conversion before any input', async()=>{ const view=await converter({denied:true}); assert.equal(view.button('選擇訂單檔').props.disabled,true); assert.match(view.text(view.render()),/無法確認轉檔權限/); });


test('compact converter keeps one primary download before collapsed details and groups blocking errors without warnings', async () => {
    const view = await converter(); await view.select(file());
    const nodes = view.all(() => true);
    const download = nodes.findIndex(n => n.type === 'Button' && view.text(n).includes('銷貨檔 → 上傳 ECOUNT'));
    const table = nodes.findIndex(n => n.type === 'table');
    assert.ok(download >= 0 && download < table);
    assert.equal(view.all(n => n.type === 'Button' && view.text(n).includes('銷貨檔 → 上傳 ECOUNT')).length, 1);
    for (const title of ['商品對照（', 'ECOUNT 設定', '訂單明細與納入／排除', '其他下載與轉檔說明']) {
        const details = view.all(n => n.type === 'details').find(n => view.text(n.props.children[0]).includes(title));
        assert.ok(details, title); assert.ok(!details.props.open, title);
    }
    const problems = view.all(n => n.props['aria-label'] === '待處理問題')[0];
    assert.match(view.text(problems), /2 項商品需確認 ECOUNT 對照/);
    assert.doesNotMatch(view.text(problems), /條碼待確認/);
    assert.match(view.text(problems), /00123/); assert.match(view.text(problems), /00124/);
    assert.equal(view.button('銷貨檔 → 上傳 ECOUNT').props.disabled, true);
    assert.equal(view.requests.length, 1);
});


test('unique ECOUNT reference automatically resolves source SKU while stopped suffix is never rewritten', async()=>{
 const resolved={sync:{product_count:3,created_at:'2026-09-16T00:00:00Z'},products:{'00123':{status:'matched',matches:[{erp_sku:'NEW00123',product_name:'ERP product',spec:'',barcode:'00123'}]},'00124':{status:'inactive',matches:[{erp_sku:'00124',product_name:'Retired'}]}}};
 const view=await converter({resolved});await view.select(file());
 assert.match(view.text(view.render()),/00124：ECOUNT 已中止使用/);
 const codes=view.all(n=>n.type==='input').map(n=>n.props.value);assert.ok(codes.includes('NEW00123'));assert.ok(codes.includes('00124'));
 assert.equal(view.button('銷貨檔 → 上傳 ECOUNT').props.disabled,true);assert.equal(view.requests.length,1);
});


test('selecting a stored profile fills customer and tax settings only for the uploaded platform',async()=>{
 const profiles=[{id:1,platform:'1Shop',store:'Saved Store',settings:{store:'Saved Store',customerCode:'00020',customerName:'Saved Customer',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true}},{id:2,platform:'Shopify',store:'Other',settings:{store:'Other',customerCode:'WRONG'}}];
 const c=await converter({profiles});await c.select(file());
 c.change('店鋪','1');assert.match(c.text(c.render()),/00020\s+·\s+Saved Customer/);
 const options=c.all(n=>n.type==='option').map(n=>c.text(n));assert.ok(!options.includes('Other · WRONG'));
 await c.select(file());
 const stores=c.all(n=>n.type==='input').filter(n=>n.props.value==='Saved Store');assert.equal(stores.length,0,'new file must select its store explicitly');
 c.change('店鋪','2');assert.doesNotMatch(c.text(c.render()),/銷貨客戶： WRONG/);
});
