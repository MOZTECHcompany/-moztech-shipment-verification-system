const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),xlsx=require('xlsx');
module.exports=async function({base,id,user,token,receipt,output}){
 const {chromium}=require(process.env.WMS_PLAYWRIGHT_MODULE||'playwright');
 const root=path.resolve(__dirname,'../..'),cwd=process.cwd();let vite,browser;
 try{
  process.chdir(root+'/frontend');
  const {createServer}=await import(path.join(path.dirname(require.resolve('vite',{paths:[root+'/frontend/node_modules']})),'dist/node/index.js'));
  vite=await createServer({root:root+'/frontend',configFile:root+'/frontend/vite.config.js',logLevel:'error',server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:base},'/socket.io':{target:base,ws:true}}}});await vite.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.WMS_CHROME_EXECUTABLE});
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({user,token})=>{localStorage.setItem('wms_user',JSON.stringify(user));localStorage.setItem('wms_token',JSON.stringify(token));window.__prints=[];setInterval(()=>{const f=document.getElementById('printWindow');if(f?.contentWindow)f.contentWindow.print=()=>window.__prints.push({text:f.contentDocument.body.innerText,html:f.contentDocument.documentElement.outerHTML,svg:f.contentDocument.querySelectorAll('svg').length});},20);},{user,token});
  await page.goto('http://127.0.0.1:'+vite.httpServer.address().port+'/warehouse-intakes/'+id);
  await page.getByRole('heading',{name:'ECOUNT 銷貨結果核對'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'領單並列印',exact:true}).isDisabled(),true);
  const book=xlsx.utils.book_new();xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(receipt),'銷貨回傳');
  await page.locator('input[type=file]').setInputFiles({name:'local-only-receipt.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:xlsx.write(book,{type:'buffer',bookType:'xlsx'})});
  await page.getByText('這是 ECOUNT 已儲存的銷貨明細，已確認單據存在；不是待上傳的檔案。',{exact:true}).click();
  await page.getByRole('button',{name:'核對銷貨結果並建立待預揀任務',exact:true}).click();
  await page.getByText('銷貨明細核對通過',{exact:true}).waitFor();
  await page.getByRole('button',{name:'領單並列印',exact:true}).click();await page.waitForFunction(()=>window.__prints.length===1);
  await page.getByRole('button',{name:'重印',exact:true}).waitFor();await page.getByLabel('列印內容',{exact:true}).selectOption('orders');
  await page.getByRole('button',{name:'重印',exact:true}).click();await page.waitForFunction(()=>window.__prints.length===2);
  const papers=await page.evaluate(()=>window.__prints);assert.equal(papers[0].svg,1);assert.equal(papers[1].svg,4);assert.match(papers[0].text,/領單人：admin/);assert.match(papers[1].text,/TEST-A/);assert.match(papers[1].text,/TEST-B/);assert.match(papers[1].text,/須核對 1 組 SN/);
  await page.getByLabel('預揀人員',{exact:true}).selectOption({label:'picker（picker）'});await page.getByRole('button',{name:'指派／轉交預揀',exact:true}).click();await page.getByText('預揀人員：picker · 待核對',{exact:true}).waitFor();
  fs.mkdirSync(output,{recursive:true});await page.screenshot({path:output+'/warehouse-flow-desktop.png',fullPage:true});
  for(let i=0;i<papers.length;i++){const p=await context.newPage();await p.setContent(papers[i].html);await p.pdf({path:output+`/local-only-paper-${i}.pdf`,format:'A4',printBackground:true});await p.close();}
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);await page.screenshot({path:output+'/warehouse-flow-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);fs.writeFileSync(output+'/browser-result.json',JSON.stringify({prints:papers.map(p=>({text:p.text,barcodes:p.svg})),errors,desktop:true,mobile:true},null,2));
 }finally{await browser?.close();await vite?.close();process.chdir(cwd);}
};
