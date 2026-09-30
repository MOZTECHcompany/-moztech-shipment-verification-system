const {orderChangeNoticeDetails:details}=require('../src/services/orderChangeNoticeDetails');
const change=(quantityChange,extra={})=>({barcode:'4712345678901',productName:'測試商品',quantityChange,...extra});
const exception=(items,extra={})=>({type:'order_change',snapshot:{baselineItems:[{barcode:'4712345678901',quantity:2}],proposal:{items},...extra}});
test('requested duplicate barcode changes are sequential and include SN evidence',()=>{
    const result=details({phase:'requested',exception:exception([change(-1,{removedSnList:['OLD']}),change(1,{snList:['NEW']})])});
    expect(result.heading).toContain('待審核');
    expect(result.lines).toEqual(['測試商品 · 4712345678901 · 2 → 1 件','移除 SN：OLD','測試商品 · 4712345678901 · 1 → 2 件','新增 SN：NEW']);
});
test('approval uses actual applied quantities and actual removed serials',()=>{
    const result=details({phase:'approved',exception:exception([change(-1)],{applyResult:{changesApplied:[{barcode:'4712345678901',previousTotalQuantity:8,newTotalQuantity:7,removedSerialNumbers:['ACTUAL']} ]}})});
    expect(result.heading).toBe('已套用的異動');expect(result.lines[0]).toContain('8 → 7');expect(result.lines[1]).toBe('移除 SN：ACTUAL');
});
test('absent legacy baseline is not guessed; captured baseline proves a new barcode starts at zero',()=>{
    expect(details({phase:'rejected',exception:{type:'order_change',snapshot:{proposal:{items:[change(3)]}}}}).lines[0]).toContain('數量 +3');
    expect(details({phase:'requested',exception:exception([change(3,{barcode:'NEW'})])}).lines[0]).toContain('0 → 3 件');
});
test('deletion proposal is clearly distinguished from a completed void',()=>{
    const source={type:'order_change',snapshot:{previousStatus:'packing'}};
    expect(details({phase:'requested',deletion:true,exception:source}).lines).toEqual(['裝箱中 → 已作廢（核准後生效）']);
    expect(details({phase:'rejected',deletion:true,exception:source}).lines[0]).toContain('未執行');
    expect(details({phase:'voided',previousStatus:'picked'}).lines).toEqual(['待裝箱 → 已作廢']);
});
test('SN replacements carry both serials and product identification',()=>{
    expect(details({phase:'sn_replaced',exception:{snapshot:{oldSn:'OLD',newSn:'NEW',product:{name:'商品',barcode:'CODE'}}}}).lines).toEqual(['商品 · CODE','SN：OLD → NEW']);
});
test('handling updates show prior explanation and changed action without implying stock changes',()=>{
    const source={type:'stockout',snapshot:{proposal:{resolutionAction:'restock',note:'明日補貨',newSn:'NEW'}},resolution_action:'other',resolution_note:'已聯繫'};
    const result=details({phase:'requested',exception:source,previousProposal:{resolutionAction:'short_ship',note:'原短出'}});
    expect(result.lines).toEqual(['例外類型：缺貨','處理方式：短出 → 補貨','處理說明：明日補貨','原處理說明：原短出','擬更換 SN：NEW']);
    expect(details({phase:'resolved',exception:source}).lines).toContain('處理說明：已聯繫');
});
