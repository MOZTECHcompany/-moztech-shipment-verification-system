// Executed in Chrome's isolated world. Uses visible document structure only; never page JS state,
// hidden tokens, cookies, localStorage, session URLs or internal ECOUNT HTTP endpoints.
export async function inspectEcountDocument(input = {}) {
  const error = code => ({ ok:false, errorCode:code });
  const visible = element => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const interactable=element=>{
    element.scrollIntoView({block:'nearest',inline:'nearest'});
    const rect=element.getBoundingClientRect(),x=Math.min(innerWidth-1,Math.max(0,rect.left+rect.width/2)),y=Math.min(innerHeight-1,Math.max(0,rect.top+rect.height/2)),hit=document.elementFromPoint(x,y);
    return rect.width>0&&rect.height>0&&!!hit&&(element===hit||element.contains(hit));
  };
  if (window !== window.top) return error('TOP_FRAME_REQUIRED');
  if (location.origin !== 'https://loginib.ecount.com' || location.pathname.toLowerCase() !== '/ec56/view/erp') return error('ERP_ORIGIN_NOT_ALLOWED');
  const titles=[...document.querySelectorAll('[data-item-key="menu_name_header_data_model"],h1,h2,h3,[role="heading"],.page-header,.title')].filter(visible).filter(node => /輸入銷貨單\s*[（(]修改[）)]/.test(node.textContent.trim()));
  const title=titles[0]?.textContent.trim()||'';
  const containers=[...document.querySelectorAll('[id^="IInventoryInputPage_"]')].filter(visible).filter(node=>titles.some(title=>node.contains(title)));
  const form=containers.filter(node=>!containers.some(other=>other!==node&&node.contains(other)))[0]||null;
  // A normal toolbar may contain a "臨時保存" button. Only a visible restore/unfinished-draft
  // warning counts; never click its apply/delete controls on the operator's behalf.
  const exactDraft=/輸入銷貨單\s*[（(]修改[）)]\s*中有臨時儲存的資料[。.]?/;
  const leafDraft=[...document.querySelectorAll('div,p,span')].filter(visible).some(node=>node.textContent.length<180&&exactDraft.test(node.textContent)&&![...node.children].some(child=>exactDraft.test(child.textContent||'')));
  const temporaryDraft = leafDraft||[...document.querySelectorAll('[role="alert"],[role="dialog"],dialog,.alert,.message-box,.message-bar')].filter(visible).some(node=>/(?:暫存|臨時|暫時).{0,40}(?:資料|恢復|套用|繼續|刪除)|(?:上次|未儲存|存在).{0,40}(?:暫存|臨時|暫時)/s.test(node.textContent||''));
  const metadataHeaders = [...document.querySelectorAll('[data-item-key="inv_m$txt_001_salesXdetail_thead"],th,[role="columnheader"]')].filter(visible).filter(node => node.textContent.trim() === 'WMS箱號明細');
  const capabilities = { loggedIn:!!title, existingVoucher:!!title, identityLocked:false, temporaryDraft, atomicMetadataOnlyUpdate:false, optimisticConcurrency:false, metadataLengthAccepted:false, metadataMaxLength:null, versionToken:null, acceptanceTestExclusiveDocument:false,testMetadataMaxLength:200,documentNavigationSupported:false };
  const diagnostic = { adapterVersion:1, recognizedTitle:!!title,formId:form?.id||null, metadataColumnCount:metadataHeaders.length, capabilities,
    blockers:['原單公司、鎖定單號與完整業務欄位仍需實際 DOM 驗證','原生並行修改保護尚未驗收','文字欄伺服器長度上限尚未驗收'] };
  if (temporaryDraft) return { ...error('TEMPORARY_DRAFT'), diagnostic };
  if(input.operation==='locate'){
    if([...document.querySelectorAll('[id^="IInventoryInputPage_"]')].some(visible))return {...error('EXISTING_FORM_MUST_BE_CLOSED_BY_OPERATOR'),diagnostic};
    const evidence=input.companyEvidence,expected=input.expected;
    if(!evidence?.erpDocumentId||evidence.basis!=='visible-company-name-and-readonly-tax-id'||evidence.companyCode!==expected?.companyCode||!/^\d{4}\/\d{2}\/\d{2}-\d+$/.test(expected?.voucherNumber||''))return {...error('COMPANY_ID_NOT_VERIFIED'),diagnostic};
    const matches=[...document.querySelectorAll('a[data-item-key="data_dt_no_salesXlist"]')].filter(visible).filter(node=>[...node.querySelectorAll('span')].some(span=>span.textContent.replace(/\s/g,'')===expected.voucherNumber));
    if(matches.length!==1)return {...error(matches.length?'AMBIGUOUS_SALES_QUERY_RESULT':'OPEN_EXACT_SALES_QUERY_RESULT'),diagnostic};
    const target=matches[0];
    if(!interactable(target))return {...error('QUERY_RESULT_NOT_INTERACTABLE'),diagnostic};
    target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}));target.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));target.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse'}));target.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));target.click();
    return {ok:true,opening:true};
  }
  if (input.operation === 'probe'&&!form) return { ok:true, diagnostic };
  if (!title) return { ...error('OPEN_EXISTING_SALES_VOUCHER'), diagnostic };
  if(!form)return { ...error('DOCUMENT_ADAPTER_NOT_VERIFIED'),diagnostic };
  const one=(root,selector)=>{const nodes=[...root.querySelectorAll(selector)].filter(visible);if(nodes.length!==1)throw new Error('AMBIGUOUS_FORM_FIELD');return nodes[0];};
  const text=node=>node.matches('input,textarea,select')?node.value:node.textContent.trim();
  const value=(root,key)=>text(one(root,`[data-item-key="${key}"]`));
  const decimal=raw=>{const normalized=raw.replaceAll(',','').trim();if(!/^-?\d+(?:\.\d+)?$/.test(normalized))throw new Error('UNSUPPORTED_DECIMAL_FORMAT');return normalized;};
  const orderedObject=value=>Array.isArray(value)?value.map(orderedObject):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,orderedObject(value[key])])):value;
  const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(orderedObject(value))))),n=>n.toString(16).padStart(2,'0')).join('');
  const rendered=node=>{
    if(node.nodeType===3)return node.textContent;
    if(node.nodeType!==1||!visible(node))return '';
    if(node.matches('input,textarea,select'))return node.type==='hidden'?'':node.value;
    return [...node.childNodes].map(rendered).join('');
  };
  const readVoucher=()=>{
    const date=one(form,'[data-item-key="data_dt_no_salesXmaster"]'),dateText=rendered(date).replaceAll('\u00a0','').replace(/\s/g,'');
    const match=dateText.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})-(\d+)$/);
    if(!match)throw new Error('LOCKED_VOUCHER_ID_NOT_READABLE');
    const controls=[...date.querySelectorAll('input,select,textarea')].filter(visible);
    if(!controls.length||controls.some(node=>!node.disabled&&!node.readOnly))throw new Error('VOUCHER_ID_NOT_LOCKED');
    return `${match[1]}/${match[2].padStart(2,'0')}/${match[3].padStart(2,'0')}-${Number(match[4])}`;
  };
  try{
    if(input.operation==='ensure-format'){
      if(!input.companyEvidence?.erpDocumentId||input.companyEvidence.companyCode!==input.expected?.companyCode||readVoucher()!==input.expected?.voucherNumber)throw new Error('WRONG_DOCUMENT');
      const already=[...form.querySelectorAll('[data-item-key="inv_m$txt_001_salesXdetail_thead"]')].filter(visible);
      if(already.length)return {ok:true,formatSelected:true};
      const button=one(form,'button[data-item-key="template_list_header_data_model"]');
      if(button.disabled||!interactable(button))throw new Error('FORMAT_BUTTON_NOT_INTERACTABLE');
      button.click();
      for(let attempts=0;attempts<15;attempts++){
        const links=[...document.querySelectorAll('ul.dropdown-menu-item.show li[data-item-key="layer_item"] > a')].filter(visible).filter(node=>node.textContent.trim()==='WMS箱號出貨對照');
        if(links.length>1)throw new Error('AMBIGUOUS_WMS_FORMAT');
        if(links.length===1){if(!interactable(links[0]))throw new Error('FORMAT_OPTION_NOT_INTERACTABLE');links[0].click();return {ok:true,formatSelected:true};}
        await new Promise(resolve=>setTimeout(resolve,30));
      }
      throw new Error('WMS_FORMAT_NOT_FOUND');
    }
    const tables=[...form.querySelectorAll('table.table-grid-input')].filter(visible).filter(table=>[...table.querySelectorAll('[data-item-key="prod_salesXdetail"]')].some(node=>text(node)));
    if(tables.length!==1)throw new Error('AMBIGUOUS_ITEM_GRID');
    const table=tables[0],required=['prod','prod_nm','serial_array','spec_nm','qty','apply_price_amt','vat_apply_price_amt','supply_amt','vat_amt','remark','atxt_001','atxt_002','atxt_003','atxt_004','amt','txt_001'];
    for(const key of required)one(table,`[data-item-key="inv_m$${key}_salesXdetail_thead"]`);
    const rowNodes=[...table.querySelectorAll('tr')].filter(row=>[...row.querySelectorAll('[data-item-key="prod_salesXdetail"]')].some(node=>text(node)));
    if(!rowNodes.length||rowNodes.length>1000)throw new Error('INVALID_ITEM_GRID');
    const seen=new Set(),rows=[],rowBusiness={};
    for(const node of rowNodes){
      const fields=Object.fromEntries(required.map(key=>[key,value(node,`${key}_salesXdetail`)]));
      if(seen.has(fields.prod))throw new Error('AMBIGUOUS_SAME_ITEM_ROWS');seen.add(fields.prod);
      if(fields.serial_array)throw new Error('SERIAL_DETAIL_NOT_VERIFIED');
      if(!/^\d+$/.test(fields.qty)||Number(fields.qty)<1||!Number.isSafeInteger(Number(fields.qty)))throw new Error('UNSUPPORTED_QUANTITY_FORMAT');
      const rowId=`item:${fields.prod}`;
      rows.push({rowId,itemCode:fields.prod,sourceLineId:fields.atxt_004||null,quantity:fields.qty,unitPrice:decimal(fields.apply_price_amt),netAmount:decimal(fields.supply_amt),taxAmount:decimal(fields.vat_amt),grossAmount:decimal(fields.amt),warehouseCode:'',actualSN:[],metadata:fields.txt_001});
      rowBusiness[rowId]=Object.fromEntries(Object.entries(fields).filter(([key])=>key!=='txt_001'));
    }
    const voucherNumber=readVoucher();
    const customer=one(form,'[data-item-key="cust_salesXmaster-input"]'),warehouse=one(form,'[data-item-key="wh_salesXmaster-input"]');
    if(!customer.value||!warehouse.value)throw new Error('HEADER_IDENTITY_NOT_READABLE');
    const approval=value(form,'confirm_header_data_model');
    if(!['取消批准','批准'].includes(approval))throw new Error('APPROVAL_STATUS_NOT_VERIFIED');
    const currency=value(form,'foreign_currency_salesXmaster');
    const totalsRows=[...table.querySelectorAll('tr.muted')].filter(visible);
    if(totalsRows.length!==1)throw new Error('TOTALS_NOT_VERIFIED');
    // Summary cells are mapped by the verified header positions, never by a guessed numeric index.
    const header=one(table,'[data-item-key="inv_m$prod_salesXdetail_thead"]').closest('tr');
    const headers=[...header.children],summary=[...totalsRows[0].children];
    const totalFor=key=>{const col=one(table,`[data-item-key="inv_m$${key}_salesXdetail_thead"]`).closest('td,th');const index=headers.indexOf(col);if(index<0||!summary[index])throw new Error('TOTALS_NOT_VERIFIED');return decimal(summary[index].textContent);};
    const totals={netAmount:totalFor('supply_amt'),taxAmount:totalFor('vat_amt'),grossAmount:totalFor('amt')};
    diagnostic.capabilities.identityLocked=true;
    diagnostic.observedForm={voucherNumber,rowCount:rows.length,hasOnlyUniqueItems:true,hasOnlyEmptySerialCells:true};
    // Evidence comes only from the extension popup's read of the company's name + readonly tax ID,
    // matched to explicit TEST configuration, then pinned by Chrome's native documentId. Never job.expected.
    const evidence=input.companyEvidence;
    const companyCode=evidence?.basis==='visible-company-name-and-readonly-tax-id'&&typeof evidence.companyCode==='string'&&evidence.companyCode&&typeof evidence.companyName==='string'&&/^\d{8}$/.test(evidence.taxId||'')&&evidence.erpDocumentId?evidence.companyCode:null;
    if(!companyCode){diagnostic.blockers=['尚未核實目前 ECOUNT 畫面可見的公司代碼',...diagnostic.blockers.slice(1)];if(input.operation==='probe')return {ok:true,diagnostic};return {...error('COMPANY_ID_NOT_VERIFIED'),diagnostic};}
    const headerControls=[...form.querySelectorAll('input,select,textarea')].filter(visible).filter(node=>node.type!=='hidden'&&node.type!=='password'&&!table.contains(node)).map(node=>{
      const key=node.getAttribute('data-item-key')||node.closest('[data-item-key]')?.getAttribute('data-item-key')||node.id;
      if(!key||/token|password|cookie|session|authorization/i.test(key))throw new Error('UNVERIFIED_HEADER_CONTROL');
      if(/txt_001_salesXdetail/.test(key))return null;
      return {key,kind:node.tagName,type:node.type||'',value:node.value,...(['checkbox','radio'].includes(node.type)?{checked:node.checked}:{})};
    }).filter(Boolean);
    const otherBusinessFields={rowBusiness,headerControls,approvalButton:approval,currencyButton:currency,companyIdentity:{companyName:evidence.companyName,taxId:evidence.taxId}};
    const snapshot={schemaVersion:1,companyCode,voucherNumber,versionToken:'pending',capturedAt:new Date().toISOString(),customerCode:customer.value,warehouseCode:warehouse.value,currencyCode:'',approvalStatus:approval==='取消批准'?'approved':'unapproved',linkedDocuments:[],totals,otherBusinessFields,rows};
    snapshot.versionToken='observed:'+await hash({...snapshot,capturedAt:null,versionToken:null});
    const exactExpected=input.expected?.companyCode===companyCode&&input.expected?.voucherNumber===voucherNumber;
    diagnostic.capabilities.versionToken=snapshot.versionToken;
    diagnostic.capabilities.acceptanceTestExclusiveDocument=exactExpected&&voucherNumber==='2026/10/16-2'&&snapshot.customerCode==='TEST-WMS-20261016'&&rows.every(row=>row.itemCode==='TEST-WMS-20261016'&&row.quantity==='25'&&Number(row.unitPrice)===0)&&Object.values(totals).every(total=>Number(total)===0);
    if(input.operation==='probe')return {ok:true,diagnostic};
    if(input.expected&&!exactExpected)return {...error('WRONG_DOCUMENT'),diagnostic};
    if(input.operation==='read')return {ok:true,snapshot,capabilities:diagnostic.capabilities,uiEvidence:{formId:form.id}};
    if(input.operation!=='save')return {...error('UNSUPPORTED_OPERATION'),diagnostic};
    const permit=input.permit;
    if(!permit?.saveAllowed||permit.mode!=='test'||permit.testSaveAllowed!==true||permit.testWriteEnabled!==true||!Number.isFinite(permit.expiresAt)||permit.expiresAt<=Date.now()||permit.expiresAt>Date.now()+300000||permit.companyCode!==companyCode||permit.voucherNumber!==voucherNumber||!diagnostic.capabilities.acceptanceTestExclusiveDocument)return {...error('SAVE_DISABLED_VENDOR_ACCEPTANCE_PENDING'),diagnostic};
    const business=({capturedAt,versionToken,...source})=>({...source,rows:source.rows.map(({metadata,...row})=>row)});
    if(snapshot.versionToken!==input.expectedVersionToken||await hash(business(snapshot))!==input.expectedBusinessFingerprint)return {...error('BUSINESS_CONFLICT'),diagnostic};
    if(!Array.isArray(input.rows)||input.rows.length!==rows.length||new Set(input.rows.map(row=>row.rowId)).size!==rows.length)return {...error('ROW_MISMATCH'),diagnostic};
    for(const update of input.rows){
      const existing=rows.find(row=>row.rowId===update.rowId);
      if(!existing||existing.itemCode!==update.itemCode||existing.quantity!==update.expectedQuantity||existing.metadata!==update.previousMetadata||typeof update.metadata!=='string'||update.metadata.length>200)return {...error('METADATA_CONFLICT'),diagnostic};
    }
    // Only the real WMS metadata field may enter edit mode. Never manipulate provider state or other inputs.
    for(const update of input.rows){
      const node=rowNodes.find(row=>value(row,'prod_salesXdetail')===update.itemCode),field=one(node,'[data-item-key="txt_001_salesXdetail"]');
      const cell=field.closest('td');if(!cell)return {...error('METADATA_EDITOR_NOT_VERIFIED'),diagnostic};
      if(!interactable(cell))return {...error('METADATA_CELL_NOT_INTERACTABLE'),diagnostic};
      cell.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}));cell.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));cell.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse'}));cell.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));cell.click();
      let editor;
      for(let tries=0;tries<15;tries++){
        const editors=[...node.querySelectorAll('textarea[data-item-key="txt_001_salesXdetail"][data-focusable="true"]')].filter(visible);
        if(editors.length===1){editor=editors[0];break;}
        await new Promise(resolve=>setTimeout(resolve,30));
      }
      if(!editor||editor.disabled||editor.readOnly||editor.value!==update.previousMetadata||editor.maxLength>0&&update.metadata.length>editor.maxLength)return {...error('METADATA_EDITOR_NOT_VERIFIED'),diagnostic};
      editor.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,update.metadata);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:null}));editor.dispatchEvent(new Event('change',{bubbles:true}));editor.blur();
    }
    const recheck=await inspectEcountDocument({...input,operation:'read'});
    if(!recheck.ok||await hash(business(recheck.snapshot))!==input.expectedBusinessFingerprint||recheck.snapshot.rows.some(row=>row.metadata!==input.rows.find(update=>update.rowId===row.rowId)?.metadata))return {...error('PRE_SAVE_RECHECK_FAILED'),diagnostic};
    if(permit.expiresAt<=Date.now())return {...error('SAVE_PERMIT_EXPIRED'),diagnostic};
    const save=one(form,'button[data-item-key="save_footer_toolbar"]');
    if(save.disabled||save.getAttribute('aria-disabled')==='true')return {...error('SAVE_BUTTON_DISABLED'),diagnostic};
    if(!interactable(save))return {...error('SAVE_BUTTON_NOT_INTERACTABLE'),diagnostic};
    // Exactly one normal save click, never save+print, copy, return, delete or approval actions.
    save.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}));save.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));save.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse'}));save.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));save.click();
    for(let tries=0;tries<60;tries++){
      if(!document.contains(form)||!visible(form))return {ok:true,saveAttempted:true,originalFormClosed:true};
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return {...error('SAVE_UI_CONFIRMATION_PENDING'),saveAttempted:true,diagnostic};
  }catch(caught){
    const code=/^[A-Z_]+$/.test(caught.message)?caught.message:'DOCUMENT_ADAPTER_NOT_VERIFIED';
    diagnostic.blockers=[code,...diagnostic.blockers];
    return input.operation==='probe'?{ok:true,diagnostic}:{...error(code),diagnostic};
  }
}
