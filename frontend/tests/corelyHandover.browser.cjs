// Local-only UI exercise. APIs are synthetic; no employee or cloud sessions.
const { build } = require('esbuild');
const { createServer } = require('node:http');
const { readFileSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
async function main() {
    const { chromium } = require(process.env.WMS_PLAYWRIGHT_MODULE || 'playwright');
    const frontend = resolve(__dirname, '..');
    const result = await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import Component from './src/components/CorelyHandover.jsx';sessionStorage.setItem('wms_token',JSON.stringify('local-ui'));createRoot(document.getElementById('root')).render(<Component id={1} user={{id:1,role:'dispatcher'}} token='local-ui'/>);",resolveDir:frontend,loader:'jsx'},bundle:true,write:false,format:'iife',plugins:[{name:'local-fixtures',setup(b){
        b.onResolve({filter:/^@\/api\/api.js$/},()=>({path:'api',namespace:'fixture'}));b.onResolve({filter:/^@\/ui$/},()=>({path:join(frontend,'src/ui/Button.jsx')}));
        b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='api'?"async function call(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.message),{response:{status:r.status,data}});return{data}}export default{get:p=>call(p),post:(p,b)=>call(p,b)}":"import React from 'react';export function Button({children,variant,...p}){return React.createElement('button',{...p,className:'rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-40'},children)}",loader:'js',resolveDir:frontend}));
    }}]});
    const cssFile=readdirSync(join(frontend,'dist/assets')).find(n=>/^main-.*\.css$/.test(n));const css=readFileSync(join(frontend,'dist/assets',cssFile));
    const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');return res.end(result.outputFiles[0].contents);}if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');return res.end(css);}res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root" style="max-width:1100px;margin:20px auto"></div><script src="/app.js"></script>');});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
    try {
        browser=await chromium.launch({headless:true,executablePath:process.env.WMS_CHROME_EXECUTABLE || chromium.executablePath()});
        const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
        let qty=0,loseReply=true;const bodies=[],shipments=[];
        await page.route('**/api/corely-intakes/**',async route=>{
            const req=route.request();if(req.method()==='GET')return route.fulfill({json:{blocker:null,lines:[{salesOrderLineId:'line-A',productId:'product',sku:'000123',name:'測試商品',orderedQuantity:100,packedQuantity:100,handedOverQuantity:qty,availableQuantity:100-qty}],shipments}});
            const b=req.postDataJSON();bodies.push(b);
            let s=shipments.find(x=>x.commandId===b.commandId);if(!s){qty+=b.lines[0].quantity;s={id:'shipment-'+shipments.length,commandId:b.commandId,occurredAt:new Date().toISOString(),...b.handover,status:'handed_over',deliveryStatus:'pending',lines:b.lines.map(l=>({...l,sku:'000123',shipmentLineId:'ship-line-'+shipments.length}))};shipments.push(s);}
            if(loseReply){loseReply=false;return route.abort('failed');}return route.fulfill({json:s});
        });
        await page.goto('http://127.0.0.1:'+server.address().port);await page.getByLabel('本次數量').fill('60');await page.getByLabel('箱號',{exact:true}).fill('BOX-1');await page.getByLabel('承運商').fill('測試物流');await page.getByLabel('交接清單編號').fill('TEST-MANIFEST');await page.getByRole('checkbox').check();
        await page.screenshot({path:'/tmp/wms-handover-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/wms-handover-mobile-form.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.setViewportSize({width:1280,height:1000});await page.getByRole('button',{name:'確認本批已交運'}).click();await page.getByRole('button',{name:'重試原交運確認'}).waitFor();
        await page.reload();await page.getByRole('button',{name:'重試原交運確認'}).click();await page.getByText('交運已記錄，待 ERP 收件與核銷。',{exact:true}).waitFor();assert.deepEqual(bodies[0],bodies[1]);assert.equal(qty,60);
        await page.getByLabel('本次數量').fill('40');await page.getByLabel('箱號',{exact:true}).fill('BOX-2');await page.getByLabel('承運商').fill('測試物流');await page.getByLabel('交接清單編號').fill('TEST-MANIFEST-2');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'確認本批已交運'}).click();await page.getByText('目前沒有尚未交運的已裝箱商品。').waitFor();assert.equal(qty,100);assert.equal(shipments.length,2);
        shipments[0].deliveryStatus='acknowledged';await page.getByRole('button',{name:'更新交運狀態'}).click();await page.getByText('ERP 已收件，待核銷',{exact:true}).waitFor();
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/wms-handover-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.deepEqual(errors,[]);
        console.log(JSON.stringify({passed:true,partialShipments:[60,40],sameCommandAfterLostReply:true,ackMeansPendingReview:true,mobileNoOverflow:true,screenshots:['/tmp/wms-handover-desktop.png','/tmp/wms-handover-mobile.png']}));
    } finally {await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
