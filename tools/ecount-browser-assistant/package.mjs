import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2), testMode=args.includes('--loopback-test'),realEcountTest=args.includes('--real-ecount-test');
if(testMode&&realEcountTest)throw new Error('Synthetic loopback and real ECOUNT tests are mutually exclusive.');
const originIndex=args.indexOf('--loopback-origin');
let loopbackOrigin;
if(testMode||realEcountTest){
  if(originIndex<0||!args[originIndex+1])throw new Error('Test package requires exact --loopback-origin http://127.0.0.1:PORT');
  const url=new URL(args[originIndex+1]);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('Only an exact loopback origin is allowed for isolated tests.');
  loopbackOrigin=url.origin;
}
if(originIndex>=0&&!testMode&&!realEcountTest)throw new Error('A loopback origin requires an explicit test-package mode.');
const outputArg=args.indexOf('--output');
if (outputArg < 0 || !args[outputArg+1]) throw new Error('Specify an absolute --output directory outside the repository.');
const destination=path.resolve(args[outputArg+1]);
if (destination===root || destination.startsWith(root+path.sep)) throw new Error('Output must be outside extension source.');
const packageDir=path.join(destination,realEcountTest?'corely-ecount-assistant-real-ecount-test':testMode?'corely-ecount-assistant-loopback-test':'corely-ecount-assistant');
await mkdir(destination,{recursive:true});
await rm(packageDir,{recursive:true,force:true});
await mkdir(packageDir,{recursive:true});
for(const name of ['manifest.json','popup.html','popup.css','README.md','src']) await cp(path.join(root,name),path.join(packageDir,name),{recursive:true});
if(testMode) {
  const manifest=JSON.parse(await readFile(path.join(packageDir,'manifest.json'),'utf8'));
  manifest.name+='（隔離測試）';
  // Test build is deliberately a separate extension. It is never published as a production package.
  manifest.host_permissions.push('http://127.0.0.1/*');
  manifest.content_scripts.push({matches:['http://127.0.0.1/*'],js:['src/wms-bridge-test.js'],run_at:'document_start',all_frames:false});
  await writeFile(path.join(packageDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const bridge=await readFile(path.join(root,'src/wms-bridge.js'),'utf8');
  await writeFile(path.join(packageDir,'src/wms-bridge-test.js'),bridge.replace("const origins = ['https://wms.corely.cc', 'https://corely-wms-249593319772.asia-east1.run.app'];",`const origins = [${JSON.stringify(loopbackOrigin)}];`));
  const policy=await readFile(path.join(root,'src/policy.mjs'),'utf8');
  await writeFile(path.join(packageDir,'src/policy.mjs'),policy.replace("export const WMS_ORIGINS = Object.freeze(['https://wms.corely.cc', 'https://corely-wms-249593319772.asia-east1.run.app']);",`export const WMS_ORIGINS = Object.freeze([${JSON.stringify(loopbackOrigin)}]);`).replace("export const ERP_ORIGINS = Object.freeze(['https://loginib.ecount.com']);",`export const ERP_ORIGINS = Object.freeze([${JSON.stringify(loopbackOrigin)}]);`));
  const adapter=await readFile(path.join(root,'src/dom-adapter.mjs'),'utf8');
  await writeFile(path.join(packageDir,'src/dom-adapter.mjs'),adapter.replace("location.origin !== 'https://loginib.ecount.com'",`location.origin !== ${JSON.stringify(loopbackOrigin)}`));
  const company=await readFile(path.join(root,'src/company-evidence.mjs'),'utf8');
  await writeFile(path.join(packageDir,'src/company-evidence.mjs'),company.replace("location.origin!=='https://loginib.ecount.com'",`location.origin!==${JSON.stringify(loopbackOrigin)}`));
}
if(realEcountTest){
  const manifest=JSON.parse(await readFile(path.join(packageDir,'manifest.json'),'utf8'));
  manifest.name+='（真實 ECOUNT 指定測試單）';
  manifest.description='僅限指定 TEST 銷貨單驗收：本機 WMS 測試控制頁＋真實 ECOUNT。正式自動寫回未啟用，需當次安裝確認。';
  manifest.host_permissions=['https://loginib.ecount.com/*','http://127.0.0.1/*'];
  manifest.content_scripts=[{matches:['http://127.0.0.1/*'],js:['src/wms-bridge.js'],run_at:'document_start',all_frames:false}];
  await writeFile(path.join(packageDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const bridge=await readFile(path.join(root,'src/wms-bridge.js'),'utf8');
  const bridgeOrigins="const origins = ['https://wms.corely.cc', 'https://corely-wms-249593319772.asia-east1.run.app'];";
  if(!bridge.includes(bridgeOrigins))throw new Error('WMS bridge origin contract changed; refusing real test package.');
  await writeFile(path.join(packageDir,'src/wms-bridge.js'),bridge.replace(bridgeOrigins,`const origins = [${JSON.stringify(loopbackOrigin)}];`));
  const policy=await readFile(path.join(root,'src/policy.mjs'),'utf8');
  const policyOrigins="export const WMS_ORIGINS = Object.freeze(['https://wms.corely.cc', 'https://corely-wms-249593319772.asia-east1.run.app']);";
  if(!policy.includes(policyOrigins))throw new Error('WMS policy origin contract changed; refusing real test package.');
  await writeFile(path.join(packageDir,'src/policy.mjs'),policy.replace(policyOrigins,`export const WMS_ORIGINS = Object.freeze([${JSON.stringify(loopbackOrigin)}]);`));
  // ERP policy, DOM writer, company-verifier and every exact TEST/save gate remain byte-for-byte source copies.
}
const zip=packageDir+'.zip';
await rm(zip,{force:true});
const packed=spawnSync('/usr/bin/zip',['-q','-r',zip,path.basename(packageDir)],{cwd:destination,encoding:'utf8'});
if(packed.status!==0) throw new Error('Packaging failed');
const sha256=createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(zip+'.sha256',`${sha256}  ${path.basename(zip)}\n`);
process.stdout.write(JSON.stringify({packageDir,zip,sha256,testMode,realEcountTest,status:'preliminary-test-only',realEcountAcceptance:false,productionWriteEnabled:false,...(realEcountTest?{requiresActionTimeInstallApproval:true,controllerOrigin:loopbackOrigin,erpOrigin:'https://loginib.ecount.com'}:{})})+'\n');
