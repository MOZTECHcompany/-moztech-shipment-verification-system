const { boundedLimit,dateRange }=require('../utils/queryLimits');
test('query size and date validation prevents unbounded or invalid caller values',()=>{
    expect(boundedLimit('99999999')).toBe(1000);
    for(const value of ['-1','NaN','0','1.5',['2']])expect(()=>boundedLimit(value)).toThrow();
    expect(()=>dateRange('2026-02-30','2026-03-01')).toThrow();
    expect(()=>dateRange('2026-03-02','2026-03-01')).toThrow();
    expect(dateRange('2026-03-01','2026-03-01',true)).toEqual({start:'2026-03-01',end:'2026-03-01'});
});
test('legacy scan-error ISO instants remain valid while malformed timestamps and reversed ranges are rejected', () => {
    const { logDateRange } = require('../utils/queryLimits');
    expect(logDateRange('2026-09-06T21:18:03.770Z','2026-09-13T21:18:03.770Z').start).toBe('2026-09-06T21:18:03.770Z');
    expect(logDateRange('2026-09-14T00:00:00+08:00','2026-09-13T16:00:00Z').end).toBe('2026-09-13T16:00:00Z');
    for (const value of ['2026-02-30T00:00:00Z','2026-09-14T24:00:00Z','2026-09-14T00:00:00','garbage',[]]) expect(() => logDateRange(value)).toThrow();
    expect(() => logDateRange('2026-09-14T00:00:01+08:00','2026-09-13T16:00:00Z')).toThrow();
    expect(() => dateRange('2026-09-14T00:00:00Z')).toThrow();
});
