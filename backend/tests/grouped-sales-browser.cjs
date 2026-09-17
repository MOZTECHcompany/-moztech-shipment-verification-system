const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),xlsx=require('xlsx');
module.exports=async function({base,id,user,token,output}){
 const {chromium}=require(process.env.WMS_PLAYWRIGHT_MODULE||'playwright');
 const root=path.resolve(__dirname,'../..'),cwd=process.cwd();let vite,browser;
 try{
  process.chdir(root+'/frontend');
  const {createServer}=await import(path.join(path.dirname(require.resolve('vite',{paths:[root+'/frontend/node_modules']})),'dist/node/index.js'));
  vite=await createServer({root:root+'/frontend',configFile:root+'/frontend/vite.config.js',logLevel:'error',server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:base},'/socket.io':{target:base,ws:true}}}});await vite.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.WMS_CHROME_EXECUTABLE});
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),page=await context.newPage();
  await page.addInitScript(({user,token})=>{localStorage.setItem('wms_user',JSON.stringify(user));localStorage.setItem('wms_token',JSON.stringify(token));},{user,token});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+vite.httpServer.address().port+'/admin/marketplace-converter?batch='+id+'#batch-detail');
  await page.getByText('彙總銷貨（3 列，每列最多 200 件）',{exact:true}).click();
  const table=page.locator('details').filter({has:page.locator('summary',{hasText:'彙總銷貨（3 列'})}).locator('table');
  assert.deepEqual(await table.locator('tbody tr td:nth-child(3)').allTextContents(),['200','200','50']);
  await page.getByText('其他下載',{exact:true}).click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#batch-detail').getByRole('button',{name:'下載銷貨檔',exact:true}).click()]);
  const book=xlsx.readFile(await download.path());const rows=xlsx.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
  assert.equal(rows[0].length,27);assert.deepEqual(rows.slice(1).map(r=>r[rows[0].indexOf('數量')]),[200,200,50]);
  fs.mkdirSync(output,{recursive:true});await page.screenshot({path:output+'/grouped-sales-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  await page.screenshot({path:output+'/grouped-sales-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);fs.writeFileSync(output+'/grouped-browser-result.json',JSON.stringify({desktop:true,mobile:true,downloadQuantities:[200,200,50],downloadColumns:27,errors}));
 }finally{await browser?.close();await vite?.close();process.chdir(cwd);}
};
