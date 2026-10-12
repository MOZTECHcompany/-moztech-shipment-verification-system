const {parseOrderRows}=require('../services/orderImportParser');
const {pickExactSerial,parseExactSerialList,normalizeSerialScanInput}=require('../utils/serialNumber');
const rows=(name='實際SN',sns='Vendor-a02,Vendor-A02')=>[['憑證號碼：AUDIT-EXACT'],['國際條碼','品項名稱','數量',name],['AUDIT-EAN','AUDIT [AUDIT-SKU]',2,sns]];
test.each(['實際SN','actualSN','actual_sn'])('explicit %s preserves vendor case, symbols and exact quantity',name=>{
 expect(parseOrderRows(rows(name)).items[0]).toMatchObject({serials:['Vendor-a02','Vendor-A02'],serialMode:'exact',quantity:2});
 expect(parseOrderRows(rows(name,'0001/A02\n0001-a02')).items[0].serials).toEqual(['0001/A02','0001-a02']);
});
test.each(['Vendor-a02','Vendor-a02,Vendor-a02','Vendor a02,Vendor-A02','ctn-A02,Vendor-A02','Vendor-a02,','A'.repeat(101)+',Vendor-A02'])('unsafe or incomplete actual list rejects %s',value=>{
 expect(()=>parseOrderRows(rows('實際SN',value))).toThrow(/實際SN/);
});
test('exact duplicates across products reject while case-distinct IDs stay distinct',()=>{
 const data=rows();data.push(['AUDIT-OTHER','AUDIT Other',1,'Vendor-a02']);expect(()=>parseOrderRows(data)).toThrow(/其他品項已出現/);
});
test('old summary and dedicated SN grammar stays canonical while exact/legacy disagreement rejects',()=>{
 expect(parseOrderRows(rows('SN列表','vendor000001 vendor000002')).items[0].serials).toEqual(['VENDOR000001','VENDOR000002']);
 const data=rows();data[1].push('SN列表');data[2].push('VENDOR000001 VENDOR000002');expect(()=>parseOrderRows(data)).toThrow(/不一致/);
 expect(normalizeSerialScanInput('SN: vendor000001').normalized).toBe('VENDOR000001');
});
test('unit resolver prefers raw exact identity, then legacy prefix exact, and refuses canonical ambiguity',()=>{
 const units=[{id:1,serial_number:'Vendor-a02'},{id:2,serial_number:'Vendor-A02'}];
 expect(pickExactSerial(units,'Vendor-a02')).toMatchObject({instance:units[0],ambiguous:false,match:'exact'});
 expect(pickExactSerial(units,'SN:Vendor-A02')).toMatchObject({instance:units[1],ambiguous:false,match:'prefixed-exact'});
 expect(pickExactSerial(units,'vendor-a02')).toMatchObject({instance:null,ambiguous:true,match:'canonical'});
 expect(pickExactSerial([{id:3,serial_number:'VENDOR000001'}],'vendor000001')).toMatchObject({instance:{id:3},ambiguous:false,match:'canonical'});
 expect(pickExactSerial([...units,{id:4,serial_number:'Vendor-a02'}],'Vendor-a02').ambiguous).toBe(true);
 expect(pickExactSerial(units,'UNKNOWN').match).toBe('none');
 const literal={id:5,serial_number:'SN:Vendor-a02'};expect(pickExactSerial([literal,...units],literal.serial_number).instance).toBe(literal);
});
test('array lists preserve identities and never generate a missing SN',()=>{
 expect(parseExactSerialList(['Vendor-a02','Vendor-A02'],2)).toEqual(['Vendor-a02','Vendor-A02']);
 expect(()=>parseExactSerialList(['Vendor-a02'],2)).toThrow(/筆數/);
});
test('EC source detail exact list preserves source line and internal identity',()=>{
 const data=[['理貨單號','商城訂單編號','平台','店鋪','來源明細號','品項編碼','品項名稱','國際條碼','數量','內部掃描碼','來源SKU','實際SN'],['AUDIT-EC-PICK','AUDIT-ORDER','1Shop','AUDIT Store','AUDIT-LINE','AUDIT-SKU','AUDIT Product','',2,'ITM-AUDIT','AUDIT-full-SKU','Vendor-a02,Vendor-A02']];
 expect(parseOrderRows(data).items[0]).toMatchObject({serials:['Vendor-a02','Vendor-A02'],serialMode:'exact',sourceLineId:'AUDIT-LINE',sourceSku:'AUDIT-full-SKU',internationalBarcode:null,internalScanCode:'ITM-AUDIT'});
});
