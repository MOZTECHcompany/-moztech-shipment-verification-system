const { boundedLimit,dateRange }=require('../utils/queryLimits');
test('query size and date validation prevents unbounded or invalid caller values',()=>{
    expect(boundedLimit('99999999')).toBe(1000);
    for(const value of ['-1','NaN','0','1.5',['2']])expect(()=>boundedLimit(value)).toThrow();
    expect(()=>dateRange('2026-02-30','2026-03-01')).toThrow();
    expect(()=>dateRange('2026-03-02','2026-03-01')).toThrow();
    expect(dateRange('2026-03-01','2026-03-01',true)).toEqual({start:'2026-03-01',end:'2026-03-01'});
});
