const { describe, test, expect } = require('@jest/globals');
const { normalizeSerialScanInput } = require('../utils/serialNumber');

describe('normalizeSerialScanInput', () => {
    test('strips SN: prefix and uppercases', () => {
        const r = normalizeSerialScanInput(' SN:B19b52004754 ');
        expect(r.normalized).toBe('B19B52004754');
        expect(r.hadSnPrefix).toBe(true);
        expect(r.isDigitsOnly).toBe(false);
        expect(r.digitsOnly).toBe('52004754');
    });

    test('keeps digits-only input and digitsOnly equals itself', () => {
        const r = normalizeSerialScanInput('52004754');
        expect(r.normalized).toBe('52004754');
        expect(r.isDigitsOnly).toBe(true);
        expect(r.digitsOnly).toBe('52004754');
    });

    test('handles SN：fullwidth colon', () => {
        const r = normalizeSerialScanInput('SN：B19B52004735');
        expect(r.normalized).toBe('B19B52004735');
        expect(r.hadSnPrefix).toBe(true);
    });
});
