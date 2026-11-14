// Standalone FILE:// browser proof. No app shell/server, user browser profile,
// account files or network. Writes only review/ui-validation and own test files.
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
const artifacts = path.join(review, 'ui-validation');
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
const source = await fs.readFile(path.join(repo,'src/client.jsx'),'utf8');
// Final gate requires popup coverage by default. --baseline is explicitly only
// for the pre-popup component milestone, never the M6 release acceptance run.
const settingsMode = process.argv.includes('--settings');
const requirePopup = !settingsMode && !process.argv.includes('--baseline');
const popupScreenshot = process.argv.includes('--popup-screenshot');
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const run = path.join(artifacts,'runs',`${settingsMode?'settings-':''}${stamp}-${process.pid}`);
await fs.mkdir(run,{recursive:true});
const reactExports = 'Children,Component,Fragment,Profiler,PureComponent,StrictMode,Suspense,cloneElement,createContext,createElement,createFactory,createRef,forwardRef,isValidElement,lazy,memo,startTransition,useCallback,useContext,useDebugValue,useDeferredValue,useEffect,useId,useImperativeHandle,useInsertionEffect,useLayoutEffect,useMemo,useReducer,useRef,useState,useSyncExternalStore,useTransition,version';
const aliases = {
  react:`import {React} from 'test:installed-react'; export const {${reactExports}}=React; export default React;`,
  'react/jsx-runtime':`import {JSX} from 'test:installed-react'; export const {Fragment,jsx,jsxs}=JSX;`,
  'react-dom':`import {ReactDOM} from 'test:installed-react'; export const {createPortal,flushSync,unstable_batchedUpdates}=ReactDOM;`,
  'react-dom/client':`import {Client} from 'test:installed-react'; export const {createRoot,hydrateRoot}=Client;`,
  '@deepseek-ai/dsh-client-ui-primitives':`import {useEffect} from 'react'; import {createPortal} from 'react-dom';
    export function Modal({open=true,title,description,closeLabel='Close',children,onClose,onOpenChange,footer}){
      useEffect(()=>{if(open)window.__modalOpenEvents.push({title:typeof title==='string'?title:'modal'});},[open]);
      if(!open)return null;return createPortal(<div data-ui-modal role="alertdialog" aria-modal="true" aria-label={typeof title==='string'?title:'Modal'} style={{position:'fixed',inset:'15% 20%',padding:24,background:'#fff',border:'2px solid #444',boxShadow:'0 0 0 100vmax #0006',zIndex:200000}}><h2>{title}</h2>{description&&<p>{description}</p>}<div>{children}</div>{footer}<button aria-label="Close modal" onClick={()=>{if(onClose)onClose();else onOpenChange?.(false);}}>{closeLabel}</button></div>,document.body);
    }`,
};
const built = await esbuild.build({
  entryPoints:[path.join(repo,settingsMode?'test/browser/settings-ui-harness.jsx':'test/browser/session-ui-harness.jsx')],bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,
  define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'standalone-installed-react',setup(build){
    build.onResolve({filter:/^test:client$/},()=>({path:'client',namespace:'test-client'}));
    build.onLoad({filter:/.*/,namespace:'test-client'},()=>({contents:source+'\nexport {CopilotBadge,DICTS,UsageBlock,CopilotSection};',resolveDir:path.join(repo,'src'),loader:'jsx'}));
    build.onResolve({filter:/^test:installed-react$/},()=>({path:'installed-react',namespace:'test-react'}));
    build.onLoad({filter:/.*/,namespace:'test-react'},()=>({contents:runtimeSource,loader:'js'}));
    build.onResolve({filter:/^(react(?:\/jsx-runtime)?|react-dom(?:\/client)?|@deepseek-ai\/dsh-client-ui-primitives)$/},args=>({path:args.path,namespace:'test-alias'}));
    build.onLoad({filter:/.*/,namespace:'test-alias'},args=>({contents:aliases[args.path],loader:'jsx'}));
  }}],
});
const bundle=built.outputFiles[0].text;
await fs.writeFile(path.join(run,'app.js'),bundle);
const html='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; base-uri \'none\'"><title>Synthetic session account proof</title><style>body{font:14px system-ui;margin:28px;color:#222;background:#fafafa}button{font:inherit}#root{position:fixed;left:28px;bottom:28px}.copilot-badge{display:flex;align-items:center;gap:6px;border:1px solid #ddd;border-radius:20px;padding:4px 10px;background:white}.copilot-badge svg{width:16px;height:16px}#result{display:none}</style></head><body><h1>Session-account UI validation</h1><p>Standalone installed React runtime; synthetic data only. No account, server or browser profile access.</p><div id="root"></div><pre id="result">PENDING</pre><script>window.__modalOpenEvents=[];window.HARNESS_REQUIRE_POPUP='+JSON.stringify(requirePopup)+';window.HARNESS_SCREENSHOT_POPUP='+JSON.stringify(popupScreenshot)+';</script><script>'+bundle.replaceAll('</script','<\\/script')+'</script></body></html>';
const htmlFile=path.join(run,'harness.html');
const finalHtml=settingsMode?html.replace('</head>','<style>#root{position:static;max-width:680px}</style></head>').replace('<h1>Session-account UI validation</h1>','<h1>Compact account settings UI validation</h1>'):html;
await fs.writeFile(htmlFile,finalHtml);
const edge=process.env.SESSION_UI_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if(!fss.existsSync(edge))throw new Error('Preinstalled Edge binary is unavailable; set SESSION_UI_EDGE to an existing Chrome/Edge binary');
const outputFile=path.join(run,'browser-dom.html'),stderrFile=path.join(run,'browser-stderr.txt'),screenshot=path.join(run,'session-ui.png');
const userData=path.join(run,'fresh-browser-profile');
await fs.mkdir(path.join(userData,'Default'),{recursive:true});
await fs.writeFile(path.join(userData,'Default','Preferences'),JSON.stringify({download:{default_directory:run,prompt_for_download:false,directory_upgrade:true},profile:{default_content_setting_values:{automatic_downloads:1}},background_mode:{enabled:false}}));
// Node-owned result collection: browser downloads are denied, so policy/flush
// changes cannot redirect output into real Downloads or hold headless exit open.
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
const args=[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync',
  '--disable-domain-reliability','--disable-client-side-phishing-detection','--safebrowsing-disable-auto-update','--metrics-recording-only','--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND',
  '--disable-features=OptimizationHints,MediaRouter,EdgeShoppingAssistant,EdgeSidebar','--disable-background-mode','--user-data-dir='+userData,'--disk-cache-dir='+path.join(run,'cache'),'--crash-dumps-dir='+path.join(run,'crashes'),
  '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--window-size=1100,850','about:blank',
];
const portFile=waitForOwnedFile(path.join(userData,'DevToolsActivePort'),20000);
let browser,cdp,pageSession,reportWait,result,browserProduct,pageNetworkAttempts=0;
try{
  // No piped stdio or raw browser diagnostic/DevTools capability URL logging.
  browser=spawn(edge,args,{stdio:'ignore',windowsHide:true});browser.on('error',()=>{});
  const [port,pathLine]=(await portFile.promise).trim().split(/\r?\n/);const numericPort=Number(port);
  if(!Number.isInteger(numericPort)||numericPort<1024||numericPort>65535||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(pathLine))throw new Error('Invalid owned browser debug address');
  cdp=await CdpClient.connect(`ws://127.0.0.1:${numericPort}${pathLine}`);
  browserProduct=(await cdp.send('Browser.getVersion')).product;
  await cdp.send('Browser.setDownloadBehavior',{behavior:'deny'});
  const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank',background:false});
  ({sessionId:pageSession}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}));
  cdp.on(message=>{if(message.sessionId===pageSession&&message.method==='Network.requestWillBeSent'&&/^(https?|wss?):/.test(message.params?.request?.url??''))pageNetworkAttempts++;});
  await cdp.send('Runtime.enable',{},pageSession);await cdp.send('Page.enable',{},pageSession);
  await cdp.send('Network.enable',{},pageSession);
  await cdp.send('Network.setBlockedURLs',{urls:['http://*','https://*','ws://*','wss://*']},pageSession);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1100,height:850,deviceScaleFactor:1,mobile:false},pageSession);
  await cdp.send('Runtime.addBinding',{name:'__sessionUiReport'},pageSession);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.__HARNESS_REPORT__=value=>globalThis.__sessionUiReport(JSON.stringify(value));'},pageSession);
  reportWait=browserReport(cdp,pageSession);
  const navigation=await cdp.send('Page.navigate',{url:pathToFileURL(htmlFile).href},pageSession);
  if(navigation.errorText)throw new Error('Synthetic FILE page navigation failed');
  result=await reportWait.promise;
  if(!result||typeof result.passed!=='boolean')throw new Error('Synthetic browser report was not a test result');
  await fs.writeFile(path.join(run,'browser-result.json'),JSON.stringify(result,null,2));
  const dom=await cdp.send('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true},pageSession);
  await fs.writeFile(outputFile,typeof dom.result?.value==='string'?dom.result.value:'');
  const png=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},pageSession);
  if(typeof png.data!=='string')throw new Error('Synthetic screenshot was unavailable');
  await fs.writeFile(screenshot,Buffer.from(png.data,'base64'));
  if(pageNetworkAttempts!==0){result.passed=false;result.failedAssertion='Synthetic page attempted external networking';}
}catch(error){
  result={passed:false,failedAssertion:'Standalone browser result collection failed',driverFailure:typeof error?.message==='string'&&error.message.startsWith('Synthetic ')?error.message:'Synthetic browser driver failed'};
  if(cdp&&pageSession){try{const png=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},pageSession);if(typeof png.data==='string')await fs.writeFile(screenshot,Buffer.from(png.data,'base64'));}catch{/* preserve driver failure */}}
}finally{
  portFile.cancel();reportWait?.cancel();
  if(cdp){try{await cdp.send('Browser.close',{},undefined,2000);}catch{/* normal disconnect during close */}cdp.close();}
  if(browser&&browser.exitCode===null){await new Promise(resolve=>{const timer=setTimeout(()=>{if(browser.exitCode===null)browser.kill();resolve();},3000);browser.once('exit',()=>{clearTimeout(timer);resolve();});});}
}
await fs.writeFile(stderrFile,'Browser stdout/stderr suppressed; synthetic CDP errors are sanitized in result.json.\n');
result.browserLauncherStatus=browser?.exitCode??null;
result.browserProduct=browserProduct;
result.pageNetworkAttempts=pageNetworkAttempts;
result.collector='isolated local CDP Runtime binding; Node-owned files; downloads denied';
result.validationMode=settingsMode?'compact-settings':'session-menu-and-popup';
result.artifacts={run,html:htmlFile,dom:outputFile,screenshot,stderr:stderrFile};
result.sourceSha256=createHash('sha256').update(source).digest('hex');
result.runtimeSha256=createHash('sha256').update(runtimeSource).digest('hex');
result.browser={binary:edge,isolatedProfile:true,fileOnly:true,dnsBlocked:true,cspConnectNone:true};
result.limitations=['synthetic Session/RPC, not live DSH/GHE E2E','public Modal replaced by accessible documented-props stub; actual Host Modal focus/appearance not verified','installed production React StrictMode plus explicit unmount/remount, not development-only double-effect mode'];
await fs.writeFile(path.join(run,'result.json'),JSON.stringify(result,null,2));
await fs.writeFile(path.join(artifacts,settingsMode?'latest-settings-result.json':'latest-result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:result.passed,failedAssertion:result.failedAssertion,assertions:result.assertions?.length,counts:result.counts,artifacts:result.artifacts,scope:result.scope},null,2));
if(!result.passed)process.exitCode=1;
