import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transform } from 'esbuild';
import * as XLSX from 'xlsx';
import * as intake from '../src/utils/marketplaceIntake.mjs';
import * as unified from '../src/utils/unifiedMarketplace.mjs';
import * as workbook from '../src/utils/marketplaceWorkbook.mjs';
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
function workbookFile(sheets, name = 'multi-sheet.xlsx') {
    const book = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
    const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    return { name, size: bytes.length, arrayBuffer: async () => bytes };
}
const secondRows = [headers,
    ['SECOND-ORDER', '一般品', '00077', 'Second order product', '4', '7', '28', '28', '0', '0', '28', '已付款', '未出貨'],
];

// Execute the real file/confirmation/download callbacks against SheetJS and the
// real parser. Replace only the lazy module boundary; no network/server is used.
const storeProfile = { id: 1, platform: '1Shop', store: 'Saved Store', settings: { store: 'Saved Store', customerCode: '00020', customerName: 'Saved Customer', warehouseCode: '003', currency: 'TWD', taxMode: 'erp_inclusive', taxType: '11', taxConfirmed: true } };
async function converter({ flag = 'dev', role = 'admin', denied = false, resolved = null, profiles = [storeProfile], previewError = null, authoritative = null, saveError = null, verification = {}, barcodeConflicts = [], barcodeConfirmationError = null } = {}) {
    const { code } = await transform(source.replaceAll("import('xlsx')", '__loadXlsx()'), { loader: 'jsx', format: 'cjs', define: { 'import.meta.env.VITE_DEPLOY_ENV': JSON.stringify(flag) } });
    const hooks = [], effects = [], downloads = [], requests = [], writes = [], listeners = new Map();
    const user = { id: 7, role };
    const storage = new Map([['wms_token', JSON.stringify('synthetic-token')], ['wms_user', JSON.stringify(user)]]);
    let cursor = 0, dirty = false, tree, mounted = true, lateUpdates = 0;
    const confirmedBarcodes = new Set();
    const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } }),
        useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { if (!mounted) lateUpdates++; const next = typeof value === 'function' ? value(hooks[i].value) : value; if (!Object.is(next, hooks[i].value)) { hooks[i].value = next; dirty = true; } }]; },
        useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
        useMemo(callback, deps) { const i = cursor++; if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { deps, value: callback() }; return hooks[i].value; },
        useEffect(callback, deps) { const i = cursor++; if (!hooks[i] || !same(hooks[i].deps, deps)) { const cleanup = hooks[i]?.cleanup; hooks[i] = { deps }; effects.push(() => { cleanup?.(); hooks[i].cleanup = callback(); }); } },
    };
    const api = { get: async () => { if (denied) throw Error('Forbidden'); return { data: { intakes: [], profiles } }; }, post: async (url, body) => {
        requests.push({url,body});
        if(url==='/api/marketplace-intakes/store-profiles')return {data:{id:9,platform:body.platform,store:body.settings.store,settings:body.settings}};
        if(url.endsWith('/download-link'))return {data:{url:'/api/marketplace-files/1/ecount'}};
        if (denied) throw Error('Forbidden');
        if (url === '/api/marketplace-intakes/barcode-confirmations') {
            if (barcodeConfirmationError) throw Object.assign(Error(barcodeConfirmationError), {response:{data:{message:barcodeConfirmationError}}});
            confirmedBarcodes.add(body.confirmation.fingerprint);
            return {data:{confirmed:true}};
        }
        if (url === '/api/marketplace-intakes/preview') {
            if (previewError) throw typeof previewError === 'string' ? Error(previewError) : Object.assign(Error(previewError.message), {response:{data:previewError}});
            const source = unified.parseUnifiedMarketplace(body.rows);
            const available = profiles.filter(profile => profile.platform === source.parsed.platform);
            const profile = body.profileId ? available.find(profile => String(profile.id) === String(body.profileId)) : available.length === 1 ? available[0] : null;
            const effectiveSettings = { ...body.settings, ...(profile?.settings || {}), taxConfirmed: true, discountAllocationConfirmed: true };
            const raw = authoritative ? authoritative(source.parsed) : source.parsed;
            const products = resolved?.products || Object.fromEntries(raw.items.map(item => [item.sku, {status:'matched',matches:[{erp_sku:item.sku,product_name:item.productName,barcode:item.sku,spec:''}]}]));
            effectiveSettings.skuMappings = {...body.settings.skuMappings};
            for (const [sku, item] of Object.entries(products)) if (item.status === 'matched') {
                const matched = item.matches[0];
                const provided = effectiveSettings.skuMappings[sku] || {};
                const apiBarcode = barcodeConflicts.find(conflict => conflict.sourceSku === sku)?.sourceBarcode;
                effectiveSettings.skuMappings[sku] = {...provided,erpSku:matched.erp_sku,erpName:matched.product_name,barcode:matched.barcode || apiBarcode || provided.barcode || '',confirmed:true,barcodeConfirmed:!!matched.barcode || !!apiBarcode || provided.barcodeConfirmed === true};
            }
            const prepared = unified.prepareUnifiedMarketplace(raw,effectiveSettings);
            return {data:{...prepared,source:source.source,raw,effectiveSettings,profiles,profileId:profile?.id,catalog:{sync:resolved?.sync || null,products},verification:{currentFingerprint:'verified-current-order-v1',...verification},barcodeConflicts:barcodeConflicts.filter(conflict=>!confirmedBarcodes.has(conflict.fingerprint))}};
        }
        if (saveError) throw Object.assign(Error(saveError.message), { response: { data: saveError } });
        const built=unified.buildUnifiedConversion(body.rows,body.settings);
        return {data:{id:1,batchNumber:body.settings.batchNumber,headers:built.output.headers,rows:built.output.rows}};
    } };
    const imports = { '../../api/origin': {API_ORIGIN:''}, '@/api/api.js': api, '../../utils/unifiedMarketplace.mjs': unified, '../../utils/marketplaceWorkbook.mjs': workbook, react, 'react-router-dom': { Link: 'Link', Navigate: 'Navigate' }, '../../ui': { Button: 'Button', PageHeader: 'PageHeader' }, '../../utils/importBatches': sessions, '../../utils/marketplaceIntake.mjs': intake, 'lucide-react': {}, './MarketplaceBatchManager': 'MarketplaceBatchManager' };
    const module = { exports: {} };
    vm.runInNewContext(code, {
        module, exports: module.exports, require: name => { if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name]; },
        __loadXlsx: async () => ({ ...XLSX, writeFile: (book, name) => downloads.push({ book, name }) }),
        sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (...args) => writes.push(args), removeItem: (...args) => writes.push(args) },
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
    const change = async (name, value) => { const control = find(label(name), node => ['input', 'select'].includes(node.type)); assert.ok(control, `Control ${name}`); await control.props.onChange({ target: { value, checked: value } }); render(); const refreshed = find(label(name), node => ['input', 'select'].includes(node.type)); if (refreshed?.props.onBlur) await refreshed.props.onBlur(); return render(); };
    const select = async (...files) => { await find(render(), node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files, value: 'selected' } }); render(); };
    render();
    for (let i=0;i<5;i++) await Promise.resolve();
    render();
    return { render, find, text, all, button, change, select, downloads, requests, writes, storage, listeners, unmount: () => { mounted = false; hooks.forEach(h => h?.cleanup?.()); }, lateUpdates: () => lateUpdates };
}


const previewCalls = view => view.requests.filter(request => request.url === '/api/marketplace-intakes/preview');
const downloadSales = view => view.button('下載銷貨檔');

test('converter route guard preserves authorized roles across deployment environments', async () => {
    for (const flag of ['production', '']) for (const role of ['admin', 'superadmin', 'dispatcher']) assert.equal((await converter({ flag, role })).render().type, 'main');
    for (const role of ['picker', 'packer', 'unknown']) assert.equal((await converter({ role })).render().type, 'Navigate');
});

test('upload uses authoritative server preview and automatically applies the unique platform profile', async () => {
    const view = await converter(); await view.select(file());
    assert.match(view.text(view.render()), /2\s+筆訂單 ·\s+3\s+件商品/);
    assert.match(view.text(view.render()), /00020\s+Saved Customer/);
    assert.doesNotMatch(view.text(view.render()), /PRIVATE-EXCLUDED|EXCLUDED ITEM/);
    assert.equal(downloadSales(view).props.disabled, false);
    assert.equal(previewCalls(view).length, 1);
    assert.equal(view.requests[0].url, '/api/marketplace-intakes/preview');
    assert.match(JSON.stringify(view.requests[0].body.rows), /NOT-AUTHORIZED/);
    assert.equal(view.writes.length, 0); assert.equal(view.downloads.length, 0);
    assert.doesNotMatch(view.text(view.render()), /已確認本次金額為 TWD|剩餘折扣按/);
});

test('API preview failure never falls back to a locally exportable CSV', async () => {
    const view = await converter({ previewError: 'Shopify 查核連線失敗' }); await view.select(file());
    assert.match(view.text(view.render()), /Shopify 查核連線失敗/);
    assert.equal(downloadSales(view), undefined);
    assert.ok(view.button('重新核對訂單'));
    assert.equal(view.downloads.length, 0);
});

const barcodeConflict = { fingerprint: 'specific-variant-barcode-review', platform: '1Shop', shop: 'Saved Store', sourceSku: '00123', sourceBarcode: 'NEW00123', erpSku: '00123', erpBarcode: '00123', erpName: 'ERP product without film tool', spec: 'iPhone X/Xs/11Pro', sourceName: '商城商品（無貼膜神器）', variantId: 'specific-variant', canConfirm: true };

test('barcode conflict displays fixed source and ERP values without an automatic confirmation or sales bypass', async () => {
    const view = await converter({barcodeConflicts:[barcodeConflict]}); await view.select(file());
    assert.match(view.text(view.render()), /商品條碼待核對/);
    assert.match(view.text(view.render()), /NEW00123/);
    assert.match(view.text(view.render()), /商城商品（無貼膜神器）/);
    assert.match(view.text(view.render()), /ERP product without film tool/);
    assert.match(view.text(view.render()), /iPhone X\/Xs\/11Pro/);
    assert.equal(downloadSales(view).props.disabled, true, 'conflicts block even an otherwise valid output');
    assert.equal(view.button('保存商品對照').props.disabled, true);
    assert.equal(view.all(node=>node.type==='input' && node.props.type==='checkbox' && node.props.checked).length, 0);
    assert.equal(view.all(node=>node.type==='input' && ['00123','NEW00123'].includes(node.props.value)).length, 0, 'conflicting identifiers are not editable');
    await view.button('保存商品對照').props.onClick();
    await downloadSales(view).props.onClick();
    assert.equal(view.requests.filter(request=>request.url==='/api/marketplace-intakes/barcode-confirmations').length,0);
    assert.equal(view.requests.filter(request=>request.url==='/api/marketplace-intakes').length,0);
    assert.equal(view.downloads.length,0);
});

test('explicit barcode confirmation saves only the server fingerprint and reruns the authoritative preview', async () => {
    const view = await converter({barcodeConflicts:[barcodeConflict]}); await view.select(file());
    await view.change('已核對實物與 ERP',true);
    assert.equal(view.button('保存商品對照').props.disabled,false);
    await view.button('保存商品對照').props.onClick(); view.render();
    const saved = view.requests.find(request=>request.url==='/api/marketplace-intakes/barcode-confirmations');
    assert.equal(saved.body.profileId,'1');
    assert.equal(saved.body.verificationFingerprint,'verified-current-order-v1');
    assert.deepEqual(JSON.parse(JSON.stringify(saved.body.confirmation)),{fingerprint:barcodeConflict.fingerprint,confirmed:true});
    assert.equal(saved.body.sourceSku,undefined); assert.equal(saved.body.erpSku,undefined);
    assert.match(JSON.stringify(saved.body.rows), /00123/);
    assert.equal(previewCalls(view).length,2);
    assert.doesNotMatch(view.text(view.render()), /商品條碼待核對/);
    assert.match(view.text(view.render()), /商品對照已保存/);
    assert.equal(downloadSales(view).props.disabled,false);
    assert.equal(view.requests.filter(request=>request.url==='/api/marketplace-intakes').length,0);
});

test('barcode confirmation requires a store and failure keeps sales blocked until a fresh preview', async () => {
    const noStore = await converter({profiles:[],barcodeConflicts:[barcodeConflict]}); await noStore.select(file());
    assert.match(noStore.text(noStore.render()), /請先選擇店鋪/);
    await noStore.change('已核對實物與 ERP',true);
    await noStore.button('保存商品對照').props.onClick();
    assert.equal(noStore.requests.filter(request=>request.url==='/api/marketplace-intakes/barcode-confirmations').length,0);
    assert.equal(downloadSales(noStore).props.disabled,true);

    const failed = await converter({barcodeConflicts:[barcodeConflict],barcodeConfirmationError:'商品條碼已變更，請重新核對'}); await failed.select(file());
    await failed.change('已核對實物與 ERP',true);
    await failed.button('保存商品對照').props.onClick(); failed.render();
    assert.match(failed.text(failed.render()), /商品條碼已變更/);
    assert.equal(downloadSales(failed).props.disabled,true);
    assert.equal(failed.button('保存商品對照').props.disabled,true);
    assert.equal(failed.downloads.length,0);
    await failed.button('重新核對').props.onClick(); failed.render();
    assert.equal(failed.button('保存商品對照').props.disabled,true,'fresh preview requires a new physical confirmation');
});

test('new upload clears physical barcode confirmation and does not reuse another batch decision', async () => {
    const view = await converter({barcodeConflicts:[barcodeConflict]}); await view.select(file());
    await view.change('已核對實物與 ERP',true);
    assert.equal(view.button('保存商品對照').props.disabled,false);
    await view.select(file());
    assert.equal(view.button('保存商品對照').props.disabled,true);
    assert.equal(downloadSales(view).props.disabled,true);
    assert.equal(view.requests.filter(request=>request.url==='/api/marketplace-intakes/barcode-confirmations').length,0);
});

test('incomplete source identity remains blocked without incorrectly blaming multiple valid versions', async () => {
    const view = await converter({barcodeConflicts:[{...barcodeConflict,sourceBarcode:'',canConfirm:false,variantId:'',variantIds:['variant-a','variant-b']}]}); await view.select(file());
    assert.match(view.text(view.render()), /商品版本或條碼資料不完整，請核對商城商品設定/);
    assert.doesNotMatch(view.text(view.render()), /同貨號有多個版本/);
    await view.change('已核對實物與 ERP',true);
    assert.equal(view.button('保存商品對照').props.disabled,true);
    await view.button('保存商品對照').props.onClick();
    assert.equal(view.requests.filter(request=>request.url==='/api/marketplace-intakes/barcode-confirmations').length,0);
    assert.equal(downloadSales(view).props.disabled,true);
});

const shopifyBarcodeRows = [
    ['Name','Lineitem quantity','Lineitem sku','Lineitem name','Lineitem price','Financial Status','Fulfillment Status','Currency','Subtotal','Shipping','Taxes','Total','Discount Amount','Refunded Amount'],
    ['#REVIEW-1',1,'4711299274732','iPhone 18 Pro 系列抗藍光保護貼',100,'paid','unfulfilled','TWD',100,0,0,100,0,0],
    ['#REVIEW-2',2,'4711299274732','iPhone 18 Pro 抗藍光保護貼',100,'paid','unfulfilled','TWD',200,0,0,200,0,0],
];
const shopifyBarcodeConflict = {
    ...barcodeConflict, platform:'Shopify',shop:'example.myshopify.com',sourceSku:'4711299274732',sourceBarcode:'4711299274732',
    erpSku:'4711299274732',erpBarcode:'',erpName:'ERP 抗藍光保護貼',spec:'iPhone 6.3 18 Pro',sourceName:'iPhone 18 Pro 系列抗藍光保護貼',
    variantId:'',variantIds:['gid://shopify/ProductVariant/1001','gid://shopify/ProductVariant/1002'],reviewReason:'ERP_BARCODE_MISSING',
    relatedOrders:[
        {orderNumber:'#REVIEW-1',orderId:'9001',sourceLineId:'line-1',variantId:'gid://shopify/ProductVariant/1001',productName:'iPhone 18 Pro 系列抗藍光保護貼',quantity:1},
        {orderNumber:'#REVIEW-2',orderId:'gid://shopify/Order/9002',sourceLineId:'line-2',variantId:'gid://shopify/ProductVariant/1002',productName:'iPhone 18 Pro 抗藍光保護貼',quantity:2},
    ],
};

test('valid multiple Shopify variants with a blank ERP barcode allow explicit review and show the exact related orders', async () => {
    const profile = {...storeProfile,platform:'Shopify'};
    const view = await converter({profiles:[profile],barcodeConflicts:[shopifyBarcodeConflict],resolved:{products:{'4711299274732':{status:'matched',matches:[{erp_sku:'4711299274732',product_name:'ERP 抗藍光保護貼',barcode:'',spec:'iPhone 6.3 18 Pro'}]}}}});
    await view.select(file(shopifyBarcodeRows));
    assert.match(view.text(view.render()), /尚未登錄條碼/);
    assert.doesNotMatch(view.text(view.render()), /同貨號有多個版本|商品版本或條碼資料不完整/);
    const details = view.all(node => node.type === 'details').find(node => /相關訂單（\s*2\s*筆）/.test(view.text(node.props.children[0])));
    assert.ok(details); assert.ok(!details.props.open, 'source evidence is available on demand');
    const rows = view.all(node => node.type === 'tr').filter(row => view.text(row).includes('#REVIEW-'));
    assert.equal(rows.length,4, 'two evidence rows and two ordinary source order rows');
    for (const item of shopifyBarcodeConflict.relatedOrders) {
        const row = view.find(details,node => node.type === 'tr' && view.text(node).includes(item.orderNumber));
        const cells = row.props.children.flat();
        assert.equal(view.text(cells[1]),item.productName);
        assert.equal(view.text(cells[2]),String(item.quantity));
    }
    const links = view.all(node => node.type === 'a' && node.props.href?.startsWith('https://example.myshopify.com/'));
    assert.deepEqual(links.map(link => link.props.href),['https://example.myshopify.com/admin/orders/9001','https://example.myshopify.com/admin/orders/9002']);
    assert.ok(links.every(link => link.props.target === '_blank' && link.props.rel === 'noopener noreferrer'));
    assert.equal(view.button('保存商品對照').props.disabled,true);
    assert.equal(downloadSales(view).props.disabled,true);
    await view.change('已核對實物與 ERP',true);
    assert.equal(view.button('保存商品對照').props.disabled,false);
    await view.button('保存商品對照').props.onClick(); view.render();
    assert.equal(view.requests.filter(request => request.url === '/api/marketplace-intakes/barcode-confirmations').length,1);
    assert.equal(downloadSales(view).props.disabled,false);
});

test('related order evidence never turns unvalidated shops or order identifiers into links', async () => {
    for (const [shop,orderId,platform] of [['example.myshopify.com.evil.test','9001','Shopify'],['example.myshopify.com','9001/../../','Shopify'],['https://example.myshopify.com','9001','Shopify'],['example.myshopify.com','9001','1Shop']]) {
        const conflict = {...shopifyBarcodeConflict,shop,platform,relatedOrders:[{...shopifyBarcodeConflict.relatedOrders[0],orderId}]};
        const view = await converter({barcodeConflicts:[conflict]}); await view.select(file());
        const details = view.all(node => node.type === 'details').find(node => view.text(node.props.children[0]).includes('相關訂單'));
        assert.ok(details);
        assert.equal(view.find(details,node => node.type === 'a'),undefined);
        assert.match(view.text(details),/#REVIEW-1/);
    }
});

test('per-order preview and save errors identify the order without duplicating an existing prefix', async () => {
    const preview = await converter({previewError:{orderNumber:'#154230',message:'商品數量無法核對'}});
    await preview.select(file());
    assert.match(preview.text(preview.render()),/#154230：商品數量無法核對/);
    assert.equal(downloadSales(preview),undefined);

    const save = await converter({saveError:{orderNumber:'#154230',message:'#154230：Shopify 金額已變更'}});
    await save.select(file()); await downloadSales(save).props.onClick(); save.render();
    const alert = save.all(node=>node.props.role==='alert')[0];
    assert.equal((save.text(alert).match(/#154230/g)||[]).length,1);
    assert.match(save.text(alert),/#154230：Shopify 金額已變更/);
    assert.equal(save.downloads.length,0);
});

test('displayed totals and products come from current server orders rather than stale uploaded rows', async () => {
    const view = await converter({ authoritative: raw => {
        const order = raw.orders[0];
        return {...raw,orders:[order],items:raw.items.filter(item=>item.sourceOrderNumber===order.sourceOrderNumber)};
    }});
    await view.select(file());
    assert.match(view.text(view.render()), /1\s+筆訂單 ·\s+1\s+件商品/);
    assert.doesNotMatch(view.text(view.render()), /TEST product B|00124/);
    assert.match(JSON.stringify(previewCalls(view)[0].body.rows), /00124/, 'original CSV is retained for server traceability');
});

test('save revalidates original source with preview fingerprint and download uses server immutable batch link', async () => {
    const view = await converter(); await view.select(file());
    await downloadSales(view).props.onClick(); view.render();
    const save = view.requests.find(request => request.url === '/api/marketplace-intakes');
    assert.equal(save.body.previewFingerprint, 'verified-current-order-v1');
    assert.equal(save.body.profileId, '1');
    assert.match(JSON.stringify(save.body.rows), /NOT-AUTHORIZED/);
    assert.equal(view.downloads.length, 1);
    assert.equal(view.downloads[0].url, '/api/marketplace-files/1/ecount');
    assert.match(view.text(view.render()), /已保存・待 ECOUNT 匯入/);
    assert.ok(view.find(view.render(), node => node.props?.to === '?batch=1&view=return#batch-detail'));
    assert.equal(view.requests.filter(request => request.url === '/api/marketplace-intakes/store-profiles').length, 1, 'validated store settings are saved without another action');
    assert.equal(view.writes.length, 0);
});

test('unmatched store opens only required first setup and prevents download', async () => {
    const view = await converter({ profiles: [] }); await view.select(file());
    assert.match(view.text(view.render()), /首次店鋪設定/);
    assert.equal(downloadSales(view).props.disabled, true);
    await view.change('商城店鋪', 'Warehouse test store');
    await view.change('ECOUNT 銷貨客戶編碼', '00020');
    assert.equal(downloadSales(view).props.disabled, false);
    assert.equal(view.button('保存此店鋪設定'), undefined);
    assert.doesNotMatch(view.text(view.render()), /已確認本次金額為 TWD|剩餘折扣按/);
});

test('an order changed after preview refreshes totals without saving or downloading stale data', async () => {
    const view = await converter({saveError:{code:'SHOPIFY_PREVIEW_CHANGED',message:'Shopify 訂單已變更'}});
    await view.select(file()); await downloadSales(view).props.onClick(); view.render();
    assert.equal(previewCalls(view).length,2);
    assert.equal(view.requests.filter(request=>request.url==='/api/marketplace-intakes').length,1,'save is not automatically repeated after refresh');
    assert.equal(view.downloads.length,0);
    assert.match(view.text(view.render()),/已更新核對結果/);
    assert.equal(downloadSales(view).props.disabled,false,'only a completed fresh preview enables another explicit download');
});

test('multiple same-platform profiles require a store choice, excluding other platform profiles', async () => {
    const profiles = [storeProfile, {...storeProfile,id:2,store:'Second Store',settings:{...storeProfile.settings,store:'Second Store',customerCode:'00022'}}, {id:3,platform:'Shopify',store:'Other',settings:{store:'Other',customerCode:'WRONG'}}];
    const view = await converter({ profiles }); await view.select(file());
    assert.equal(downloadSales(view).props.disabled, true);
    await view.change('店鋪', '2');
    assert.match(view.text(view.render()), /Second Store\s+00022/);
    assert.doesNotMatch(view.text(view.render()), /Other · WRONG/);
    assert.equal(downloadSales(view).props.disabled, false);
});

test('draft audit uses the verified preview and preserves numeric money and full identifiers', async () => {
    const view = await converter(); await view.select(file());
    await view.button('下載金額核對表').props.onClick(); view.render();
    assert.equal(view.downloads.length, 1);
    const book = view.downloads[0].book;
    assert.deepEqual(book.SheetNames, ['承辦人', '預揀總表', '訂單金額核對', '來源商品對照', '本批納入與排除', 'ECOUNT成交核對']);
    const items = XLSX.utils.sheet_to_json(book.Sheets['來源商品對照'], { header: 1 });
    assert.equal(items[1][3], '00123'); assert.equal(items[1][6], 10);
    assert.equal(view.requests.filter(request => request.url === '/api/marketplace-intakes').length, 0);
});

test('invalid file inputs reject before parsing, API preview or download', async () => {
    const view = await converter();
    for (const files of [[{ name: 'x.pdf', size: 10 }], [{ name: 'x.csv', size: 0 }], [{ name: 'x.csv', size: 10 * 1024 * 1024 + 1 }], [file(), file()]]) {
        await view.select(...files); assert.match(view.text(view.render()), /一個非空白的 Excel 或 CSV/);
    }
    assert.equal(view.requests.length, 0); assert.equal(view.downloads.length, 0);
});

test('non-UTF-8 CSV rejects undecodable identifiers', async () => {
    const view = await converter();
    await view.select({ name: 'invalid-encoding.csv', size: 2, arrayBuffer: async () => Uint8Array.from([0xff, 0xfe]) });
    assert.match(view.text(view.render()), /CSV 請使用 UTF-8/);
    assert.equal(downloadSales(view), undefined); assert.equal(view.downloads.length, 0);
});

test('account change removes the preview and disables previous-account downloads', async () => {
    const view = await converter(); await view.select(file());
    view.storage.set('wms_user', JSON.stringify({ id: 8, role: 'admin' })); view.listeners.get('storage')();
    assert.doesNotMatch(view.text(view.render()), /00123/); assert.match(view.text(view.render()), /登入人員已變更/);
    assert.equal(view.button('選擇訂單檔').props.disabled, true); assert.equal(view.downloads.length, 0);
});

test('unmounted asynchronous file reads do not reveal or store completed results', async () => {
    const view = await converter(); let resolve;
    const selected = file(); const bytes = await selected.arrayBuffer(); selected.arrayBuffer = () => new Promise(done => { resolve = done; });
    const pending = view.select(selected); for (let index = 0; index < 10 && !resolve; index++) await Promise.resolve();
    view.unmount(); resolve(bytes); await pending;
    assert.equal(view.lateUpdates(), 0); assert.equal(view.downloads.length, 0); assert.equal(view.writes.length, 0);
});

test('server permission denial disables conversion before input', async () => {
    const view = await converter({ denied: true });
    assert.equal(view.button('選擇訂單檔').props.disabled, true); assert.match(view.text(view.render()), /無法確認轉檔權限/);
});

test('usual successful flow has one main download, no product confirmation panel, and collapsed details', async () => {
    const view = await converter(); await view.select(file());
    const nodes = view.all(() => true);
    const download = nodes.findIndex(node => node.type === 'Button' && view.text(node).includes('下載銷貨檔'));
    const table = nodes.findIndex(node => node.type === 'table');
    assert.ok(download >= 0 && download < table);
    assert.equal(view.all(node => node.type === 'Button' && view.text(node).includes('下載銷貨檔')).length, 1);
    assert.doesNotMatch(view.text(view.render()), /待對照商品|保存 B 批次|保存此店鋪設定|回匯時需/);
    for (const title of ['訂單明細', '進階設定與核對表']) {
        const details = view.all(node => node.type === 'details').find(node => view.text(node.props.children[0]).includes(title));
        assert.ok(details, title); assert.ok(!details.props.open, title);
    }
});

test('inactive ERP code stays unchanged and blocks sales despite a matched companion product', async () => {
    const resolved = {products:{'00123':{status:'matched',matches:[{erp_sku:'NEW00123',product_name:'ERP product',barcode:'00123'}]},'00124':{status:'inactive',matches:[{erp_sku:'00124',product_name:'Retired'}]}}};
    const view = await converter({resolved}); await view.select(file());
    assert.match(view.text(view.render()), /00124：ECOUNT 已中止使用/);
    assert.match(view.text(view.render()), /NEW00123/);
    assert.equal(downloadSales(view).props.disabled,true);
});

test('matched ERP identifiers and master barcodes are display-only while a missing physical barcode remains editable', async () => {
    const known = await converter(); await known.select(file());
    assert.equal(known.all(node => node.type === 'input' && ['00123','00124'].includes(node.props.value)).length,0);
    assert.doesNotMatch(known.text(known.render()),/確認實物條碼/);

    const resolved = {products:{'00123':{status:'matched',matches:[{erp_sku:'00123',product_name:'Product A',barcode:''}]},'00124':{status:'matched',matches:[{erp_sku:'00124',product_name:'Product B',barcode:'00124'}]}}};
    const missing = await converter({resolved}); await missing.select(file());
    await missing.change('商品掃描條碼','4711299270024');
    assert.match(missing.text(missing.render()),/確認實物條碼/);
    await missing.change('確認實物條碼',true);
    await missing.button('套用設定').props.onClick(); missing.render();
    assert.ok(missing.all(node=>node.type==='input').some(node=>node.props.value==='4711299270024'));
    assert.equal(downloadSales(missing).props.disabled,false);
});

test('second workbook after download selects its only order sheet and starts a fresh verified batch', async () => {
    const view = await converter(); await view.select(file());
    await downloadSales(view).props.onClick(); view.render();
    const firstSave = view.requests.find(request => request.url === '/api/marketplace-intakes');
    await view.select(workbookFile({'空白頁':[], '使用說明':[['請使用平台原始訂單資料']], '第二批訂單':secondRows},'second-batch.xlsx'));
    const text = view.text(view.render());
    assert.match(text,/Second order product|00077/); assert.match(text,/1\s+筆訂單 ·\s+4\s+件商品/);
    assert.doesNotMatch(text,/TEST product A|TST6091550133|已保存・待 ECOUNT 匯入|請使用單一訂單工作表/);
    assert.equal(view.downloads.length,1,'second upload previews without saving or downloading');
    assert.equal(downloadSales(view).props.disabled,false,'the same verified store profile is reusable');
    await downloadSales(view).props.onClick(); view.render();
    const saves = view.requests.filter(request => request.url === '/api/marketplace-intakes');
    assert.equal(saves.length,2); assert.notEqual(saves[1].body.settings.batchNumber,firstSave.body.settings.batchNumber);
    assert.match(JSON.stringify(saves[1].body.rows),/SECOND-ORDER/); assert.doesNotMatch(JSON.stringify(saves[1].body.rows),/TST6091550133|00123/);
    assert.equal(view.downloads.length,2);
});

test('scientific notation blocks second workbook before API and subsequent valid upload recovers', async () => {
    const view = await converter(); await view.select(file());
    const damaged = secondRows.map(row => [...row]); damaged[1][2] = '4.71E+12';
    await view.select(workbookFile({'說明':[['訂單匯出資料']], '訂單':damaged},'damaged-second.xlsx'));
    assert.match(view.text(view.render()),/科學記號/); assert.doesNotMatch(view.text(view.render()),/00123|TEST product A/);
    assert.equal(downloadSales(view),undefined); assert.equal(previewCalls(view).length,1);
    await view.select(workbookFile({'空白':[], '訂單':secondRows},'recovered.xlsx'));
    assert.match(view.text(view.render()),/Second order product|00077/); assert.doesNotMatch(view.text(view.render()),/科學記號|00123|TEST product A/);
    assert.equal(previewCalls(view).length,2); assert.equal(view.downloads.length,0);
});

test('multiple order sheets require selection and switching replaces the server preview completely', async () => {
    const view = await converter();
    await view.select(workbookFile({'第一批':fixtureRows, '說明':[['訂單資料']], '第二批':secondRows}));
    assert.match(view.text(view.render()),/請選擇工作表/); assert.equal(downloadSales(view),undefined); assert.equal(view.requests.length,0);
    await view.change('訂單工作表','第一批'); assert.match(view.text(view.render()),/00123|TEST product A/);
    await view.change('訂單工作表','第二批'); const text = view.text(view.render());
    assert.match(text,/Second order product|00077/); assert.doesNotMatch(text,/TEST product A|TST6091550133|00123/);
    assert.equal(previewCalls(view).length,2); assert.equal(view.downloads.length,0);
});


test('zero eligible orders show their cancellation reasons before collapsed details and retain the download gate', async () => {
    const view = await converter({ authoritative: raw => ({ ...raw, orders: raw.orders.map(order => ({ ...order, cancelled: true, currentQuantity: 0 })), items: [] }) });
    await view.select(file());
    const problems = view.find(view.render(), node => node.props?.['aria-label'] === '待處理問題');
    assert.match(view.text(problems), /TST6091550133\s*：\s*Shopify 已取消訂單/);
    assert.match(view.text(problems), /TST6091550109\s*：\s*Shopify 已取消訂單/);
    assert.doesNotMatch(view.text(problems), /沒有可轉換的商品明細/);
    assert.match(view.text(view.render()), /已讀取 3 筆・可銷貨 0 筆/);
    assert.equal(downloadSales(view).props.disabled, true);
    assert.equal(view.downloads.length, 0);
});

test('preview distinguishes API verification from file-only checks and uses the verified platform', async () => {
    const fromFile = await converter({ verification: { mode: 'file', platform: '1Shop' } }); await fromFile.select(file());
    assert.match(fromFile.text(fromFile.render()), /檔案核對通過/);
    assert.doesNotMatch(fromFile.text(fromFile.render()), /API 已核對/);
    const fromApi = await converter({ verification: { mode: 'api', platform: '1Shop' } }); await fromApi.select(file());
    assert.match(fromApi.text(fromApi.render()), /1Shop API 已核對/);
    assert.doesNotMatch(fromApi.text(fromApi.render()), /Shopify API 已核對/);
});
