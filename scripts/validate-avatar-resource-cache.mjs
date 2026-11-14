// Avatar-only FILE:// browser mechanism proof. Synthetic CDP-fulfilled HTTP only;
// no app shell/server, real user profile/account files or external network.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const review = path.resolve(repo, '../dsh-session-account-review');
const artifacts = path.join(review, 'ui-validation', 'avatar-cache');
await fs.mkdir(artifacts, {recursive:true});
const shellFile = path.join(review, 'installed/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BgUyXZcc.js');
const shell = await fs.readFile(shellFile, 'utf8');
const requireFixture = createRequire(path.join(review, 'installed/dsh/package.json'));
const acorn = requireFixture('acorn');
const ast = acorn.parse(shell, {ecmaVersion:'latest',sourceType:'module'});
// Exact installed CJS factories only. Do not execute shell bootstrap or import
// its vendor graph; these isolated declarations have only browser-global deps.
const names = new Set(['S0','De','qh','uk','Jh','U2','I0','Ls','Gh','hk','Yh','pk','z0','Wt','j0','E0','Xh','vk','Qh','yk','ep','_k','tp','s7','v1','np','bk']);
const found = new Set();
const nodes = ast.body.filter(node => {
  const ids = node.type==='FunctionDeclaration'?[node.id.name]:node.type==='VariableDeclaration'?node.declarations.map(d=>d.id.name):[];
  if(!ids.some(id=>names.has(id)))return false;
  if(ids.some(id=>!names.has(id)))throw new Error('Installed runtime declaration layout changed');
  ids.forEach(id=>found.add(id));return true;
});
if(found.size!==names.size)throw new Error('Installed React factory layout changed');
const runtimeSource = '// React/ReactDOM/Scheduler, Copyright Meta/Facebook, MIT. Extracted unchanged factory bodies from installed DSH shell.\n'
  + nodes.map(node=>shell.slice(node.start,node.end)).join('\n')
  + '\nexport const React=U2(), JSX=pk(), ReactDOM=s7(), Client=bk(), Scheduler=yk();\n';
await fs.writeFile(path.join(artifacts,'installed-react-runtime.mjs'), runtimeSource);

const poolMode=process.argv.includes('--pool');
const hookMode=process.argv.includes('--hook');
const poolSource=poolMode?await fs.readFile(path.join(repo,'src/avatar-image-cache.mjs'),'utf8'):undefined;
const hookSource=hookMode?await fs.readFile(path.join(repo,'src/client.jsx'),'utf8'):undefined;
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const run=path.join(artifacts,'runs',stamp+'-'+process.pid);await fs.mkdir(run,{recursive:true});
const aliases={
'@deepseek-ai/dsh-client-ui-primitives':'export function Modal(){return null;}',
react:"import {React} from 'test:installed-react';export const {useLayoutEffect,useRef,useEffect,useState,StrictMode,createElement}=React;export default React;",
'react/jsx-runtime':"import {JSX} from 'test:installed-react';export const {jsx,jsxs,Fragment}=JSX;",
'react-dom':"import {ReactDOM} from 'test:installed-react';export const {flushSync,createPortal}=ReactDOM;",
'react-dom/client':"import {Client} from 'test:installed-react';export const {createRoot}=Client;",
};
const built=await esbuild.build({entryPoints:[path.join(repo,'test/browser/avatar-cache-harness.jsx')],bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'native-react-only',setup(build){
  build.onResolve({filter:/^test:avatar-hook$/},()=>({path:'hook',namespace:'avatar-hook'}));
  build.onLoad({filter:/.*/,namespace:'avatar-hook'},()=>({contents:hookMode?hookSource+'\nexport {AccountAvatar,avatarImageCache};':'export function AccountAvatar(){return null;}export const avatarImageCache={};',resolveDir:path.join(repo,'src'),loader:'jsx'}));
  build.onResolve({filter:/^test:avatar-pool$/},()=>({path:'pool',namespace:'avatar-pool'}));
  build.onLoad({filter:/.*/,namespace:'avatar-pool'},()=>({contents:poolMode?poolSource:'export function createAvatarImageCache(){throw new Error("Pool mode is disabled");}',resolveDir:path.join(repo,'src'),loader:'js'}));
  build.onResolve({filter:/^test:installed-react$/},()=>({path:'runtime',namespace:'native-react'}));
  build.onLoad({filter:/.*/,namespace:'native-react'},()=>({contents:runtimeSource,loader:'js'}));
  build.onResolve({filter:/^(react(?:\/jsx-runtime)?|react-dom(?:\/client)?|@deepseek-ai\/dsh-client-ui-primitives)$/},args=>({path:args.path,namespace:'alias'}));
  build.onLoad({filter:/.*/,namespace:'alias'},args=>({contents:aliases[args.path],loader:'js'}));
}}]});
const bundle=built.outputFiles[0].text;
await fs.writeFile(path.join(run,'app.js'),bundle);
const html='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\';script-src \'unsafe-inline\';style-src \'unsafe-inline\';img-src https://syntheticavatar.invalid;connect-src https://syntheticavatar.invalid;base-uri \'none\'"><title>Decoded avatar resource mechanism</title><style>body{font:15px system-ui;margin:28px;background:#fafafa;color:#222}.row{display:flex;gap:12px}figure{display:inline-flex;flex-direction:column;align-items:center;margin:10px}canvas,img{width:72px;height:72px;border-radius:50%;border:1px solid #ccc;image-rendering:pixelated}figcaption{font-size:12px;margin:6px}section{border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0}#result{display:none}</style></head><body><h1>Decoded avatar resource experiment</h1><p>Fixed synthetic PNGs, NO-STORE, no CORS permission, browser HTTP cache disabled. No real account or CDN.</p><div id="baseline-root"></div><section><h2>Independent React canvases (fresh replacement)</h2><div id="avatar-root"></div></section><section><h2>Retained DOM master</h2><div id="dom-master"></div></section><section><h2>Old picture kept while refresh loads</h2><div id="old-preview"></div></section><pre id="result">PENDING</pre><script>'+bundle.replaceAll('</script','<\\/script')+'</script></body></html>';
const poolHtml=poolMode?html.replaceAll('<section>','<section class="mechanism">').replace('</head>','<style>.mechanism{display:none}</style></head>').replace('<h1>Decoded avatar resource experiment</h1>','<h1>Retained native IMG pool cache proof</h1>').replace('<pre id="result">','<section id="pool-section"><h2>Old Host scope (must clear on disposal)</h2><div id="pool-old"></div><h2>New Host scope — own header and row</h2><div id="pool-new"></div><h2>Other issuer / account — never shared nodes</h2><div id="pool-other"></div></section><pre id="result">').replace('<script>','<script>window.HARNESS_POOL_MODE=true;</script><script>'):html;
const hookHtml=hookMode?html.replaceAll('<section>','<section class="mechanism">').replace('</head>','<style>.mechanism{display:none}</style></head>').replace('<h1>Decoded avatar resource experiment</h1>','<h1>Actual AccountAvatar hook cache proof</h1>').replace('<pre id="result">','<section id="hook-section"><h2>Actual header / row components</h2><div id="hook-root"></div><h2>Actual same-URI error recovery</h2><div id="hook-recovery"></div><h2>New scope after late old profile</h2><div id="hook-late-root"></div></section><pre id="result">').replace('<script>','<script>window.HARNESS_HOOK_MODE=true;</script><script>'):poolHtml;
const htmlFile=path.join(run,'harness.html');await fs.writeFile(htmlFile,hookHtml);
const edge=process.env.SESSION_UI_EDGE??'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if(!fss.existsSync(edge))throw new Error('Preinstalled Edge unavailable');
const userData=path.join(run,'fresh-browser-profile');await fs.mkdir(userData,{recursive:true});
const screenshot=path.join(run,hookMode?'actual-hook.png':poolMode?'pool-final-scopes.png':'fresh-green.png'),outputFile=path.join(run,'browser-dom.html');
function waitForOwnedFile(file, timeoutMs) {
  let watcher, timer, settled=false, checking=Promise.resolve(), finish;
  const promise=new Promise((resolve,reject)=>{
    finish=(error,value)=>{if(settled)return;settled=true;watcher?.close();clearTimeout(timer);error?reject(error):resolve(value);};
    const check=()=>{checking=checking.then(async()=>{if(settled)return;try{const value=await fs.readFile(file,'utf8');if(value.trim())finish(null,value);}catch{/* startup file not yet present */}});};
    watcher=fss.watch(path.dirname(file),()=>check());
    timer=setTimeout(()=>finish(new Error('Synthetic browser debug startup timed out')),timeoutMs);check();
  });
  void promise.catch(()=>{});
  return {promise,cancel(){finish?.(new Error('Synthetic browser startup cancelled'));}};
}
class CdpClient {
  constructor(socket){
    this.socket=socket;this.next=0;this.pending=new Map();this.listeners=new Set();
    socket.addEventListener('message',event=>{
      let message;try{message=JSON.parse(String(event.data));}catch{return;}
      if(message.id!==undefined){const request=this.pending.get(message.id);if(!request)return;this.pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error('Synthetic CDP command failed: '+request.method)):request.resolve(message.result??{});return;}
      for(const listener of [...this.listeners]){try{listener(message);}catch{/* individual result listener owns its failure */}}
    });
    socket.addEventListener('close',()=>{for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error('Synthetic browser closed'));}this.pending.clear();});
  }
  static async connect(url){
    const WebSocketClass=globalThis.WebSocket??requireFixture('ws');const socket=new WebSocketClass(url);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(new Error('Synthetic CDP connection timed out'));},10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Synthetic CDP connection failed'));},{once:true});});
    return new CdpClient(socket);
  }
  send(method,params={},sessionId,timeoutMs=10000){return new Promise((resolve,reject)=>{
    const id=++this.next;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Synthetic CDP command timed out: '+method));},timeoutMs);
    this.pending.set(id,{method,resolve,reject,timer});
    try{this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));}catch{clearTimeout(timer);this.pending.delete(id);reject(new Error('Synthetic CDP send failed'));}
  });}
  on(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  close(){try{this.socket.close();}catch{/* already closed */}}
}
function browserReport(client,sessionId){
  let timer,remove,settled=false,finish;
  const promise=new Promise((resolve,reject)=>{
    finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);remove?.();error?reject(error):resolve(value);};
    remove=client.on(message=>{
      if(message.sessionId!==sessionId||message.method!=='Runtime.bindingCalled'||message.params?.name!=='__sessionUiReport')return;
      try{finish(null,JSON.parse(message.params.payload));}catch{finish(new Error('Invalid synthetic browser report'));}
    });
    timer=setTimeout(()=>finish(new Error('Synthetic UI assertion result timed out')),45000);
  });
  void promise.catch(()=>{});return{promise,cancel(){finish?.(new Error('Synthetic browser report cancelled'));}};
}

const {deflateSync}=await import('node:zlib');
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function chunk(type,data){const key=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([key,data])));return Buffer.concat([size,key,data,crc]);}
function png(r,g,b){const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,r,g,b,255]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');}
const blue=png(50,100,240),green=png(0,160,100);
const fixtures=new Map(['baseline','master','dom','cors','replacement'].map(label=>['https://syntheticavatar.invalid/'+({master:'retained',dom:'dom-master'}[label]??label)+'.png',{label,body:label==='replacement'?green:blue}]));
for(const label of ['pool-warm','pool-replacement','pool-late','pool-rotate-1','pool-rotate-2','pool-rotate-3','pool-rotate-4','pool-rotate-5'])fixtures.set('https://syntheticavatar.invalid/'+label+'.png',{label,body:label==='pool-replacement'?green:blue});
for(const label of ['hook-warm','hook-scope-new','hook-recover','hook-late','hook-late-new','hook-stale-recovered','hook-rotate-1','hook-rotate-2','hook-rotate-3','hook-rotate-4','hook-rotate-5'])fixtures.set('https://syntheticavatar.invalid/'+label+'.png',{label,body:['hook-scope-new','hook-late-new'].includes(label)?green:blue});
const stats=Object.fromEntries([...fixtures.values()].map(({label})=>[label,{image:0,fetch:0,total:0}]));
const requests=[];let unknown=0,phase='startup',expectedCancelledResponses=0;
const held=new Map(),released=new Set();
const holdLabels=new Set(['replacement','pool-replacement','pool-late','hook-scope-new']);
const args=['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--disable-domain-reliability','--disable-client-side-phishing-detection','--safebrowsing-disable-auto-update','--metrics-recording-only','--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND','--disable-features=OptimizationHints,MediaRouter,EdgeShoppingAssistant,EdgeSidebar','--disable-background-mode','--user-data-dir='+userData,'--disk-cache-dir='+path.join(run,'cache'),'--crash-dumps-dir='+path.join(run,'crashes'),'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--window-size=1100,900','about:blank'];
const portFile=waitForOwnedFile(path.join(userData,'DevToolsActivePort'),20000);
let browser,cdp,pageSession,reportWait,result,browserProduct;
const responseHeaders=[{name:'Content-Type',value:'image/png'},{name:'Cache-Control',value:'no-store, max-age=0'},{name:'Pragma',value:'no-cache'},{name:'Expires',value:'0'}];
const fulfill=async(requestId,fixture)=>cdp.send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders,body:fixture.body},pageSession);
const snapshot=()=>JSON.parse(JSON.stringify(stats));
try{
  browser=spawn(edge,args,{stdio:'ignore',windowsHide:true});browser.on('error',()=>{});
  const [port,pathLine]=(await portFile.promise).trim().split(/\r?\n/);const number=Number(port);
  if(!Number.isInteger(number)||number<1024||number>65535||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(pathLine))throw new Error('Invalid owned debug endpoint');
  cdp=await CdpClient.connect('ws://127.0.0.1:'+number+pathLine);browserProduct=(await cdp.send('Browser.getVersion')).product;
  await cdp.send('Browser.setDownloadBehavior',{behavior:'deny'});
  const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank',background:false});({sessionId:pageSession}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}));
  cdp.on(message=>{
    if(message.sessionId!==pageSession)return;
    if(message.method==='Fetch.requestPaused')void(async()=>{
      const p=message.params,fixture=fixtures.get(p.request.url);
      if(!fixture||p.request.method!=='GET'){unknown++;await cdp.send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'},pageSession);return;}
      stats[fixture.label].total++;if(p.resourceType==='Image')stats[fixture.label].image++;if(p.resourceType==='Fetch'||p.resourceType==='XHR')stats[fixture.label].fetch++;
      requests.push({label:fixture.label,type:p.resourceType,method:p.request.method,phase});
      if(fixture.label==='hook-late'||fixture.label==='hook-recover'&&stats[fixture.label].image===1){await cdp.send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:404,responseHeaders:responseHeaders.map(header=>header.name==='Content-Type'?{name:'Content-Type',value:'text/plain'}:header),body:Buffer.from('synthetic image failure').toString('base64')},pageSession);return;}
      if(holdLabels.has(fixture.label)&&!released.has(fixture.label)){if(!held.has(fixture.label))held.set(fixture.label,[]);held.get(fixture.label).push({requestId:p.requestId,fixture});return;}
      await fulfill(p.requestId,fixture);
    })().catch(()=>{unknown++;});
    if(message.method==='Runtime.bindingCalled'&&message.params?.name==='__avatarControl')void(async()=>{
      const {id,request}=JSON.parse(message.params.payload);let value;
      if(request.op==='stage')phase=request.name;
      else if(request.op==='gc')await cdp.send('HeapProfiler.collectGarbage',{},pageSession);
      else if(request.op==='capture-stale'){const capture=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},pageSession);await fs.writeFile(path.join(run,'stale-blue.png'),Buffer.from(capture.data,'base64'));}
      else if(request.op==='capture-hook-cleared'){const capture=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},pageSession);await fs.writeFile(path.join(run,'hook-scope-cleared.png'),Buffer.from(capture.data,'base64'));}
      else if(request.op==='capture-pool-stale'||request.op==='capture-pool-fresh'){const capture=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},pageSession);await fs.writeFile(path.join(run,request.op==='capture-pool-stale'?'pool-stale-blue.png':'pool-fresh-green.png'),Buffer.from(capture.data,'base64'));}
      else if(request.op==='release-replacement'){const label=request.label??'replacement';released.add(label);for(const pending of held.get(label)??[]){try{await fulfill(pending.requestId,pending.fixture);}catch{if(label==='pool-late'&&request.allowCancelled===true)expectedCancelledResponses++;else throw new Error('Synthetic response release failed');}}held.delete(label);}
      else if(request.op!=='counts')throw new Error('Unknown synthetic control');
      value=snapshot();await cdp.send('Runtime.evaluate',{expression:'globalThis.__avatarControlResolve('+JSON.stringify(id)+','+JSON.stringify(value)+')'},pageSession);
    })().catch(()=>{unknown++;});
  });
  await cdp.send('Runtime.enable',{},pageSession);await cdp.send('Page.enable',{},pageSession);await cdp.send('Network.enable',{},pageSession);
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true},pageSession);
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'http://*',requestStage:'Request'},{urlPattern:'https://*',requestStage:'Request'}]},pageSession);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false},pageSession);
  await cdp.send('Runtime.addBinding',{name:'__sessionUiReport'},pageSession);await cdp.send('Runtime.addBinding',{name:'__avatarControl'},pageSession);
  const setup="(()=>{let next=0;const pending=new Map();globalThis.__avatarControlCall=request=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Synthetic control timed out'));},10000);pending.set(id,{resolve,timer});globalThis.__avatarControl(JSON.stringify({id,request}));});globalThis.__avatarControlResolve=(id,value)=>{const item=pending.get(id);if(item){pending.delete(id);clearTimeout(item.timer);item.resolve(value);}};globalThis.__AVATAR_REPORT__=value=>globalThis.__sessionUiReport(JSON.stringify(value));})();";
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:setup},pageSession);
  reportWait=browserReport(cdp,pageSession);await cdp.send('Page.navigate',{url:pathToFileURL(htmlFile).href},pageSession);result=await reportWait.promise;
  const dom=await cdp.send('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true},pageSession);await fs.writeFile(outputFile,dom.result.value);
  const capture=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},pageSession);await fs.writeFile(screenshot,Buffer.from(capture.data,'base64'));
  if(unknown){result.passed=false;result.failedAssertion='Unexpected or unfulfilled synthetic request/control';}
}catch(error){result={passed:false,failedAssertion:'Synthetic avatar mechanism driver failed',driverFailure:typeof error?.message==='string'&&error.message.startsWith('Synthetic ')?error.message:'Synthetic driver error'};}
finally{portFile.cancel();reportWait?.cancel();if(cdp){try{await cdp.send('Browser.close',{},undefined,2000);}catch{}cdp.close();}if(browser&&browser.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{if(browser.exitCode===null)browser.kill();resolve();},3000);browser.once('exit',()=>{clearTimeout(timer);resolve();});});}
result.resourceCounts=stats;result.requests=requests;result.unexpectedRequests=unknown;result.browser={product:browserProduct,exitCode:browser?.exitCode??null,isolatedProfile:true,ephemeralLoopbackCDP:true,dnsBlocked:true,downloadsDenied:true,allHTTPRequestsIntercepted:true,continuedHTTPRequests:0};
result.fixture={fakePNG:true,noStore:true,allowOriginHeader:false,HTTPCacheDisabled:true,noCORSBypass:true,sourceURLsOpaqueConstants:true};
result.artifacts={run,result:path.join(run,'result.json'),screenshot,staleScreenshot:path.join(run,poolMode?'pool-stale-blue.png':'stale-blue.png'),...(poolMode?{refreshScreenshot:path.join(run,'pool-fresh-green.png')}:{}),dom:outputFile};
result.poolShippingMode=poolMode;result.hookShippingMode=hookMode;result.expectedCancelledResponses=expectedCancelledResponses;
if(poolMode)result.cacheSourceSha256=createHash('sha256').update(poolSource).digest('hex');
if(hookMode){result.clientSourceSha256=createHash('sha256').update(hookSource).digest('hex');result.artifacts.scopeClearedScreenshot=path.join(run,'hook-scope-cleared.png');}
result.limitations=hookMode?['actual AccountAvatar+singleton with synthetic intercepted PNGs and fake profile callbacks; not live DSH/GHE E2E','fresh default-TTL warm reuse and one recovery tested; actual-clock TTL expiry remains separate API-mode proof','native IMG identity/render semantics, not animated pixel/memory measurement']:poolMode?['actual unintegrated cache API, not live GHE/CDN or production React avatar-hook E2E','native IMG identity/render semantics preserved; animated GIF/WebP pixels and total encoded/animated memory NOT measured','URL-change SWR only; same-URL server-content revalidation and LRU pressure not established by this browser run']:['mechanism proof only; no production cache implementation or real GHE/CDN','cache-disabled+no-store baseline is adversarial, not a claim every no-store page always refetches','URL-change SWR only; same-URL content revalidation, eviction/account scope and late-callback policy remain unproven'];
await fs.writeFile(path.join(run,'result.json'),JSON.stringify(result,null,2));await fs.writeFile(path.join(artifacts,'latest-result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:result.passed,failedAssertion:result.failedAssertion,assertions:result.assertions?.length,resourceCounts:stats,corsFetchRejected:result.corsFetchRejected,pool:result.pool,hook:result.hook,poolShippingMode:poolMode,hookShippingMode:hookMode,fixture:result.fixture,artifacts:result.artifacts},null,2));if(!result.passed)process.exitCode=1;
