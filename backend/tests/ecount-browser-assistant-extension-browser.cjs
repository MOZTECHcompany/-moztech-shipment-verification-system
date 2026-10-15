// Installs the actual MV3 loopback test build in a disposable Chrome profile.
// The visible ERP document is synthetic and deliberately cannot be saved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

(async()=>{
    if(process.env.WMS_ASSISTANT_LOCAL_TEST!=='1')throw Error('Explicit isolated synthetic opt-in required');
    const root=path.resolve(__dirname,'../..'),output=process.env.WMS_ASSISTANT_TEST_OUTPUT;
    if(!output||!path.isAbsolute(output)||output.startsWith(root+path.sep))throw Error('Evidence must be outside product checkout');
    const port=Number(process.env.WMS_ASSISTANT_TEST_PORT||55642);if(!Number.isInteger(port)||port<55000||port>55999)throw Error('Dedicated loopback port required');
    fs.mkdirSync(output,{recursive:true});
    const origin=`http://127.0.0.1:${port}`,controller=origin+'/settings/ecount-assistant',erp='https://loginib.ecount.com/ec56/view/erp';
    const pkg=spawnSync(process.execPath,[root+'/tools/ecount-browser-assistant/package.mjs','--output',output,'--real-ecount-test','--loopback-origin',origin],{encoding:'utf8'});
    if(pkg.status!==0)throw Error(pkg.stderr||'Package failed');
    const packaged=JSON.parse(pkg.stdout.trim());
    // Use the actual exact-origin test package unchanged. Every ERP network request below is
    // intercepted, so this package installation is still solely synthetic acceptance evidence.
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'corely-ecount-extension-validation-'));
    const owner={owner:'/root/ecount_assistant_validation',scope:'disposable local Chrome MV3 fixture only; no user browser or production writes',profile,port,startedAt:new Date().toISOString()};
    fs.writeFileSync(path.join(output,'extension-browser-owner.json'),JSON.stringify(owner,null,2));
    const server=http.createServer((req,res)=>{
        if(req.url==='/ecountAssistant.mjs'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(root+'/frontend/src/utils/ecountAssistant.mjs'));}
        res.setHeader('Content-Type','text/html; charset=utf-8');
        if(req.url?.startsWith('/ec56/view/erp'))return res.end('<!doctype html><html><body><h1>輸入銷貨單(修改)</h1><p>Isolated synthetic fixture. No ECOUNT connection or save.</p><table><thead><tr><th>品號</th><th>數量</th><th>WMS箱號明細</th></tr></thead><tbody><tr><td>TEST-SKU</td><td>25</td><td><textarea readonly>Original note</textarea></td></tr></tbody></table></body></html>');
        res.end('<!doctype html><html><body><h1>WMS isolated assistant controller</h1><script type="module">import {createAssistantBridge} from "/ecountAssistant.mjs";window.testBridge=createAssistantBridge({timeoutMs:20000});</script></body></html>');
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    const {chromium}=require(process.env.WMS_PLAYWRIGHT_MODULE||'playwright');
    const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${packaged.packageDir}`,`--load-extension=${packaged.packageDir}`,'--disable-background-networking'],viewport:{width:1200,height:850}});
    const syntheticErp='<!doctype html><html><body><h1>輸入銷貨單(修改)</h1><p>Isolated synthetic fixture. No ECOUNT connection or save.</p><table><thead><tr><th>品號</th><th>數量</th><th>WMS箱號明細</th></tr></thead><tbody><tr><td>TEST-SKU</td><td>25</td><td><textarea readonly>Original note</textarea></td></tr></tbody></table></body></html>';
    await context.route('https://loginib.ecount.com/**',route=>route.request().url()===erp?route.fulfill({contentType:'text/html; charset=utf-8',body:syntheticErp}):route.abort());
    const report={scope:owner.scope,chromeMV3Installation:false,synthetic:true,realEcountAcceptance:false,realEcountNetworkRequests:0,package:packaged,checks:[],pageErrors:[],rpcTimings:[],startedAt:owner.startedAt,allPassed:false};
    const write=()=>fs.writeFileSync(path.join(output,'extension-browser-acceptance.json'),JSON.stringify(report,null,2));
    const step=async(name,work)=>{try{await work();report.checks.push({name,passed:true});write();console.log('PASS '+name);}catch(error){report.checks.push({name,passed:false,error:String(error.message).slice(0,2000)});write();throw error;}};
    let page,popup,erpPage;
    try{
        const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:20000});
        const extensionId=new URL(worker.url()).host;report.chromeMV3Installation=true;report.extensionId=extensionId;
        write();
        popup=await context.newPage();popup.on('pageerror',e=>report.pageErrors.push('Popup: '+e.message));await popup.goto(`chrome-extension://${extensionId}/popup.html`);
        page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
        await page.goto(controller);await page.waitForFunction(()=>!!window.testBridge);
        const cdp=await context.newCDPSession(page);report.executionContexts=[];cdp.on('Runtime.executionContextCreated',event=>report.executionContexts.push({id:event.context.id,origin:event.context.origin,name:event.context.name,auxData:event.context.auxData}));await cdp.send('Runtime.enable');
        const isolated=report.executionContexts.find(c=>c.origin===`chrome-extension://${extensionId}`);
        if(isolated)await cdp.send('Runtime.evaluate',{contextId:isolated.id,expression:"window.__diagnosticMessages=[];window.addEventListener('message',e=>window.__diagnosticMessages.push({at:performance.now(),origin:e.origin,sameSource:e.source===window,type:e.data?.type,direction:e.data?.direction,nonce:e.data?.nonce,requestId:e.data?.requestId,channel:e.data?.channel,payload:e.data?.payload}));true",returnByValue:true});
        const request=async(type,payload={})=>{await page.bringToFront();return page.evaluate(async([type,payload])=>{try{return {ok:true,result:await window.testBridge.request(type,payload)};}catch(e){return {ok:false,code:e.code,message:e.message};}},[type,payload]);};
        await step('actual MV3 worker/content-script bridge loads and requires a fresh actor handshake',async()=>{
            const hello=await request('HELLO',{actorId:1,actorLabel:'Isolated manager'});
            if(!hello.ok){report.popupStatus=await popup.evaluate(()=>Promise.race([chrome.runtime.sendMessage({type:'POPUP_STATUS'}),new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),5000))]));if(isolated)report.isolatedMessages=await cdp.send('Runtime.evaluate',{contextId:isolated.id,expression:'({path:location.pathname,origin:location.origin,runtimeId:chrome.runtime.id,messages:window.__diagnosticMessages})',returnByValue:true});write();}
            assert.equal(hello.ok,true,JSON.stringify(hello));assert.equal(hello.result.protocolVersion,1);const ping=await request('PING');
            if(!ping.ok){report.pingFailure=ping;if(isolated)report.isolatedMessages=await cdp.send('Runtime.evaluate',{contextId:isolated.id,expression:'({path:location.pathname,origin:location.origin,runtimeId:chrome.runtime.id,messages:window.__diagnosticMessages})',returnByValue:true});write();}
            assert.equal(ping.ok,true,JSON.stringify(ping));
            assert.equal((await request('GET_CAPABILITIES')).result.bound,false);
        });
        erpPage=await context.newPage();await erpPage.goto(erp,{waitUntil:'networkidle'});
        await step('native popup binds exactly one synthetic ERP tab to the explicit WMS controller',async()=>{
            await popup.bringToFront();const tabs=await popup.evaluate(()=>Promise.race([chrome.tabs.query({}),new Promise((_,reject)=>setTimeout(()=>reject(Error('chrome.tabs.query timeout')),10000))]));const controllerTab=tabs.find(t=>t.url?.startsWith('http://127.0.0.1:')&&t.url.includes('/settings/ecount-assistant'));
            const erpTab=tabs.find(t=>t.url===erp);assert.ok(controllerTab);assert.ok(erpTab);assert.equal(erpTab.status,'complete');
            await popup.evaluate(id=>Promise.race([chrome.tabs.update(id,{active:true}),new Promise((_,reject)=>setTimeout(()=>reject(Error('chrome.tabs.update timeout')),10000))]),erpTab.id);
            const directProbe=await popup.evaluate(async tabId=>{const started=performance.now(),result=await Promise.race([chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func:()=>({origin:location.origin,ready:document.readyState})}),new Promise((_,reject)=>setTimeout(()=>reject(Error('direct script probe timeout')),20000))]);return {elapsedMs:performance.now()-started,result};},erpTab.id);
            report.rpcTimings.push({operation:'direct-native-probe',elapsedMs:directProbe.elapsedMs});assert.equal(directProbe.result[0].result.origin,'https://loginib.ecount.com');
            const readerProbe=await popup.evaluate(async tabId=>{const {inspectEcountDocument}=await import(chrome.runtime.getURL('src/dom-adapter.mjs'));const started=performance.now(),result=await Promise.race([chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func:inspectEcountDocument,args:[{operation:'probe'}]}),new Promise((_,reject)=>setTimeout(()=>reject(Error('direct actual reader probe timeout')),20000))]);return {elapsedMs:performance.now()-started,result};},erpTab.id);
            report.rpcTimings.push({operation:'direct-actual-reader-probe',elapsedMs:readerProbe.elapsedMs});assert.equal(readerProbe.result[0].result.ok,true);write();
            const bound=await popup.evaluate(async controllerTabId=>{const started=performance.now(),binding=await Promise.race([chrome.runtime.sendMessage({type:'POPUP_BIND',controllerTabId}),new Promise((_,reject)=>setTimeout(()=>reject(Error('POPUP_BIND timeout')),20000))]);return {binding,elapsedMs:performance.now()-started};},controllerTab.id);
            report.rpcTimings.push({operation:'POPUP_BIND',elapsedMs:bound.elapsedMs});const binding=bound.binding;assert.equal(binding.ok,true,JSON.stringify(binding));
            const capabilities=await request('GET_CAPABILITIES');assert.equal(capabilities.ok,true);assert.equal(capabilities.result.bound,true);assert.equal(capabilities.result.recognizedTitle,true);assert.equal(capabilities.result.metadataColumnCount,1);assert.equal(capabilities.result.saveEnabled,false);
        });
        await step('unverified vendor adapter blocks READ and SAVE instead of inventing a business snapshot',async()=>{
            const original=await erpPage.locator('textarea').inputValue();
            assert.equal((await request('READ_DOCUMENT',{companyCode:'SYNTHETIC',voucherNumber:'2026/10/16-1'})).code,'DOCUMENT_ADAPTER_NOT_VERIFIED');
            const noSave=await request('SAVE_PLAN',{jobId:'11111111-1111-4111-8111-111111111111',planFingerprint:'a'.repeat(64),permit:{saveAllowed:true}});
            assert.equal(noSave.result.outcome,'not_attempted');assert.equal(noSave.result.saveAttempted,false);assert.equal(noSave.result.errorCode,'PREVIEW_REQUIRED');
            assert.equal(await erpPage.locator('textarea').inputValue(),original);
            await erpPage.screenshot({path:path.join(output,'extension-synthetic-erp-readonly.png'),fullPage:true});
        });
        await step('a normally stopped MV3 service worker restores the same document binding without another HELLO',async()=>{
            await page.bringToFront();await cdp.send('ServiceWorker.enable');
            await cdp.send('ServiceWorker.stopAllWorkers');
            const restored=await request('GET_CAPABILITIES');assert.equal(restored.ok,true,JSON.stringify(restored));assert.equal(restored.result.bound,true);
            const popupRestored=await popup.evaluate(()=>Promise.race([chrome.runtime.sendMessage({type:'POPUP_STATUS'}),new Promise((_,reject)=>setTimeout(()=>reject(Error('cold popup timeout')),20000))]));
            assert.equal(popupRestored.ok,true,JSON.stringify(popupRestored));
        });
        await step('cross-tab controller cannot use another tab binding and account change invalidates it',async()=>{
            const other=await context.newPage();await other.goto(controller);await other.waitForFunction(()=>!!window.testBridge);
            const handshake=await other.evaluate(()=>window.testBridge.request('HELLO',{actorId:1}));assert.equal(handshake.protocolVersion,1);
            const otherCapabilities=await other.evaluate(()=>window.testBridge.request('GET_CAPABILITIES'));assert.equal(otherCapabilities.bound,false);await other.close();
            assert.equal((await request('HELLO',{actorId:5,actorLabel:'Different manager'})).ok,true);assert.equal((await request('GET_CAPABILITIES')).result.bound,false);
        });
        await step('reloading a controller cannot inherit its predecessor document binding or nonce',async()=>{
            await page.reload();await page.waitForFunction(()=>!!window.testBridge);
            assert.equal((await request('HELLO',{actorId:1})).ok,true);assert.equal((await request('GET_CAPABILITIES')).result.bound,false);
        });
        await step('popup is usable with local scripts under MV3 CSP and contains no remote code',async()=>{
            await popup.bringToFront();await popup.reload();await popup.getByRole('heading',{name:'ECOUNT 箱號助手'}).waitFor();
            const source=fs.readFileSync(path.join(packaged.packageDir,'popup.html'),'utf8');assert.ok(!/https?:\/\/[^"']+\.js/.test(source));
            await popup.screenshot({path:path.join(output,'extension-popup-isolated-chrome.png'),fullPage:true});
            assert.deepEqual(report.pageErrors,[]);
        });
        report.allPassed=true;report.finishedAt=new Date().toISOString();write();
        console.log(JSON.stringify({passed:report.checks.length,synthetic:true,realEcountAcceptance:false}));
    }finally{
        await context.close();await new Promise(resolve=>server.close(resolve));
        fs.writeFileSync(path.join(output,'extension-browser-cleanup.json'),JSON.stringify({...owner,chromeClosed:true,httpStopped:true,profilePreserved:true,finishedAt:new Date().toISOString()},null,2));
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
