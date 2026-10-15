// Isolated-world read of the actual company-basic-information form. No login fields or hidden state.
export function inspectEcountCompany(){
  const visible=node=>!!node&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden';
  if(window!==window.top||location.origin!=='https://loginib.ecount.com'||location.pathname.toLowerCase()!=='/ec56/view/erp')return {ok:false,errorCode:'ERP_ORIGIN_NOT_ALLOWED'};
  const containers=[...document.querySelectorAll('[id^="EMG004M_"]')].filter(visible).filter(node=>node.querySelector('#tabBasic')&&node.textContent.includes('公司基本資訊'));
  if(containers.length!==1)return {ok:false,errorCode:'OPEN_COMPANY_BASIC_INFORMATION'};
  const form=containers[0],names=[...form.querySelectorAll('input[data-cid="COM_DES"]')].filter(visible),taxes=[...form.querySelectorAll('input[data-cid="BUSINESS_NO"]')].filter(visible);
  if(names.length!==1||taxes.length!==1||taxes[0].readOnly!==true||!/^\d{8}$/.test(taxes[0].value)||!names[0].value||names[0].value.length>255)return {ok:false,errorCode:'COMPANY_ID_NOT_VERIFIED'};
  return {ok:true,companyName:names[0].value,taxId:taxes[0].value};
}
export function validateCompanyMappings(value){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>20)throw new Error('INVALID_COMPANY_MAPPING');
  const codes=new Set(),names=new Set(),taxIds=new Set();
  return value.map(row=>{
    if(!row||Object.keys(row).some(key=>!['companyCode','companyName','taxId'].includes(key))||typeof row.companyCode!=='string'||!row.companyCode||row.companyCode.length>64||typeof row.companyName!=='string'||!row.companyName||row.companyName.length>128||typeof row.taxId!=='string'||!/^\d{8}$/.test(row.taxId)||/[\u0000-\u001f\u007f]/.test(row.companyCode+row.companyName))throw new Error('INVALID_COMPANY_MAPPING');
    if(codes.has(row.companyCode)||names.has(row.companyName)||taxIds.has(row.taxId))throw new Error('AMBIGUOUS_COMPANY_MAPPING');
    codes.add(row.companyCode);names.add(row.companyName);taxIds.add(row.taxId);
    return {companyCode:row.companyCode,companyName:row.companyName,taxId:row.taxId};
  });
}
