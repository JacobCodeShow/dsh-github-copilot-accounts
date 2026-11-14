import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CopilotBadge, DICTS } from 'test:client';
import { ReactDOM, Scheduler } from 'test:installed-react';

let language='en';
const t = (key) => DICTS[language][key] ?? key;
const SID = 'synthetic-session-same-on-every-host';
const A = 'copilot-auth/account-a', B = 'copilot-auth/account-b';
const RA = 'copilot-account-' + 'a'.repeat(64), RB = 'copilot-account-' + 'b'.repeat(64);
const DATA_AVATAR = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="#4c6ef5"/><text x="10" y="25" fill="white">A</text></svg>');
const assertions = [], calls = [], errors = [];
let forbiddenNetwork = 0;
window.fetch = async () => { forbiddenNetwork++; throw new Error('Network forbidden in synthetic UI proof'); };
window.WebSocket = class { constructor() { forbiddenNetwork++; throw new Error('Network forbidden in synthetic UI proof'); } };
window.addEventListener('error', () => errors.push('Browser runtime error'));
window.addEventListener('unhandledrejection', () => errors.push('Unhandled browser rejection'));
function assert(value, name) { if (!value) throw new Error(name); assertions.push(name); }
function store(initial) { let value = initial; const listeners = new Set(); return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, set(next) { value = next; for (const fn of [...listeners]) fn(); }, size: () => listeners.size }; }
function waitFor(check, name, timeout = 2500) { return new Promise((resolve, reject) => {
  let done = false;
  const finish = (error) => { if (done) return; done = true; observer.disconnect(); clearTimeout(timer); error ? reject(error) : resolve(); };
  const verify = () => { try { if (check()) finish(); } catch { /* render may be between commits */ } };
  const observer = new MutationObserver(verify);
  observer.observe(document.body, {subtree:true,childList:true,attributes:true,characterData:true});
  const timer = setTimeout(() => finish(new Error(name)), timeout);
  verify();
}); }
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { await tick(); flushSync(()=>{}); await tick(); };
const badge = () => document.querySelector('button.copilot-badge');
const menu = () => [...document.querySelectorAll('[role="dialog"]')].find(el => el.getAttribute('aria-label') === t('badgeSessionAccounts'));
const modal = () => document.querySelector('[data-ui-modal]');
const byText = (text, root = document) => [...root.querySelectorAll('button')].find(el => el.textContent.trim() === text);
const row = (label) => [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === `${t('badgeUseSession')}: ${label}`);
const click = (element, name) => { assert(element && !element.disabled, name); flushSync(() => element.click()); };
function host(name, {usedA=12,usedB=78,selected=A,global=B}={}) {
  const generation = store(Object.freeze({id:name}));
  const sessionStore = store({running:false});
  const projection = store({});
  sessionStore.projections = {faceOf: key => key === 'modelSelection' ? projection : undefined};
  const binding = {session:sessionStore};
  const accounts = [
    {id:A,routeId:RA,domain:`${name}-a.ghe.com`,login:'alice',avatarUrl:DATA_AVATAR,plan:'Copilot Enterprise',usage:{percentUsed:usedA,resets:'2030-01-01'}},
    {id:B,routeId:RB,domain:`${name}-b.ghe.com`,login:'alice',avatarUrl:DATA_AVATAR,plan:'Copilot Business',usage:{percentUsed:usedB,resets:'2030-01-01'}},
  ];
  const state = {selected,global,accounts,rawBuiltin:false};
  const route = () => ({provider:state.selected===null?(state.rawBuiltin?'github-copilot':'copilot-default'):state.selected===A?RA:RB,model:'gpt-5.4',reasoningEffort:'high',mode:state.selected===null?'global':'bound',accountId:state.selected,available:true});
  const catalog = () => ({sessionId:SID,running:false,next:route(),lastUsed:route(),accounts:accounts.map(a=>({...a,active:a.id===state.global,globalActive:a.id===state.global})),...(control.notice?{notice:structuredClone(control.notice)}:{})});
  const control = {name,generation,binding,state,projection,catalog,nextCatalog:undefined,nextBind:undefined,notice:null};
  const remoteListeners=new Map();
  const remote={$on(event,listener){if(!remoteListeners.has(event))remoteListeners.set(event,new Set());remoteListeners.get(event).add(listener);return()=>remoteListeners.get(event)?.delete(listener);}};
  control.emit=(event,...args)=>{for(const listener of [...(remoteListeners.get(event)??[])])listener(...args);};
  control.eventCallbacks=(event)=>[...(remoteListeners.get(event)??[])];
  const connection = {generation,rpc:{async call(base,endpoint,wire,signal) {
    calls.push({host:name,base,endpoint,wire:structuredClone(wire),signal});
    if (base !== '/api' || wire?.args?.request?.sessionId !== SID) throw new Error('Wrong synthetic Host request');
    const request = wire.args.request;
    if(endpoint==='copilotAccounts/catalog') {
      if(control.nextCatalog) { const fn=control.nextCatalog; control.nextCatalog=undefined; return fn(); }
      return {ok:true,value:catalog()};
    }
    if(endpoint==='copilotAccounts/bind') {
      if(control.nextBind) { const fn=control.nextBind; control.nextBind=undefined; return fn(request); }
      state.selected=request.accountId;if(request.accountId===null)state.rawBuiltin=false;
      return {ok:true,value:{accepted:route(),...catalog()}};
    }
    if(endpoint==='copilotAccounts/setDefault') { state.global=request.accountId; return {ok:true,value:{ok:true,defaultAccountId:request.accountId}}; }
    if(endpoint==='copilotAccounts/profile') return {ok:true,value:{ok:true,avatarUrl:DATA_AVATAR}};
    throw new Error('Unexpected synthetic RPC');
  }}};
  control.connection=connection; control.scope={get:key=>key==='connection'?connection:key==='remote'?remote:undefined};
  return control;
}
let target=host('host-one');
const list=store({});
const sessions={binding:id=>id===SID?target.binding:undefined,scope:id=>id===SID?target.scope:undefined,list};
const switchHost=(next)=>{target=next; list.set({revision:Math.random()});};
let root;
const mount=()=>{root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<StrictMode><CopilotBadge sessionId={SID} sessions={sessions} t={t}/></StrictMode>));};
const unmount=()=>flushSync(()=>root.unmount());
const openMenu=async()=>{if(!menu())click(badge(),'badge opens native account menu');await waitFor(()=>menu(),'account menu did not render');await settle();};
const ready=async(expected)=>{await waitFor(()=>badge()?.textContent.trim().endsWith(expected),`badge never showed ${expected}`);await settle();};
const count=(method)=>calls.filter(call=>call.endpoint===`copilotAccounts/${method}`).length;
let noticeCounter=0;
function failureNotice(value, overrides={}) {const next=value.catalog().next;return {id:`00000000-0000-4000-8000-${String(++noticeCounter).padStart(12,'0')}`,sessionId:SID,code:'ACCOUNT_REQUEST_FAILED',accountId:next.accountId??value.state.global,logicalProvider:next.provider,model:next.model,...overrides};}
const emitFailure=(value,notice)=>{value.notice=notice;value.emit('api-session/error',SID,'PRIVATE_RAW_EVENT_DIAGNOSTIC_MUST_NOT_RENDER');};

async function run() {
  assert(React.version==='18.3.1','installed React 18.3.1 runtime is used');
  assert(ReactDOM.version==='18.3.1-next-f1338f8080-20240426','installed ReactDOM production runtime is used');
  assert(typeof Scheduler.unstable_scheduleCallback==='function','installed scheduler is present');
  mount(); await ready('88%');
  assert(document.querySelector('.copilot-badge-label')?.textContent==='Left 88%','collapsed English badge explicitly labels remaining quota');
  unmount();language='zh';mount();await ready('88%');
  assert(document.querySelector('.copilot-badge-label')?.textContent==='余 88%','collapsed Chinese badge explicitly labels remaining quota');
  unmount();language='en';mount();await ready('88%');
  assert(!badge().textContent.includes('22%'),'bound A quota wins over global B quota');
  await openMenu();
  const labelA='host-one-a.ghe.com/alice',labelB='host-one-b.ghe.com/alice';
  assert(row(labelA)?.textContent.includes('✓') && row(labelA).disabled,'selected bound A is checked and disabled');
  assert(row(labelB)?.querySelector('span[title]')?.textContent.trim()===labelB,'account labels are single-line domain/username');
  assert(row(labelB).querySelector('span[title]')?.style.whiteSpace==='nowrap','account label CSS keeps one line');
  const balance = (label) => row(label)?.querySelector('[data-account-quota]');
  assert(balance(labelA)?.textContent==='88%','selected account row shows its own remaining quota');
  assert(balance(labelB)?.textContent==='22%','unselected global account row shows its independent remaining quota');
  assert(balance(labelB).style.whiteSpace==='nowrap' && balance(labelB).style.flex==='0 0 auto','quota stays visible beside a truncated one-line label');
  target.state.accounts[1].usage={unlimited:true,percentUsed:100};target.projection.set({});
  await waitFor(()=>balance(labelB)?.textContent==='∞','unlimited row quota did not update');
  assert(balance(labelA)?.textContent==='88%','another account quota update does not replace selected balance');
  target.state.accounts[1].usageError='synthetic usage unavailable';target.projection.set({});
  await waitFor(()=>balance(labelB)?.textContent==='—','failed row usage must show unknown instead of zero');
  delete target.state.accounts[1].usageError;target.state.accounts[1].usage={percentUsed:78,resets:'2030-01-01'};target.projection.set({});
  await waitFor(()=>balance(labelB)?.textContent==='22%','row quota did not recover after refresh');
  assert(byText(t('badgeFollowGlobal'),menu()),'Follow global row is distinct from account rows');
  await waitFor(()=>{const images=[...menu().querySelectorAll('img')];return images.length>=3 && images.every(image=>image.complete && image.naturalWidth>0);},'header plus both row avatars did not load as owned data-only IMG nodes');
  assert([...document.querySelectorAll('img')].every(image=>image.src.startsWith('data:image/svg+xml,')),'all rendered avatar resources are mock data SVGs');
  const beforeBind=count('bind');
  click(row(labelB),'bind B via DOM click'); await ready('22%');
  const bind=calls.filter(c=>c.endpoint==='copilotAccounts/bind').at(-1);
  assert(count('bind')===beforeBind+1,'one click sends exactly one bind mutation');
  assert(bind.host==='host-one' && bind.wire.args.request.accountId===B,'bind uses captured selected Host and immutable account id');
  assert(JSON.stringify(bind.wire.args.request.expected)===JSON.stringify({provider:RA,model:'gpt-5.4',reasoningEffort:'high'}),'bind sends exact prior provider/model/effort controls');
  await openMenu();click(row(labelA),'rebind A for explicit global-action proof');await ready('88%');await openMenu();
  const beforeGlobal=count('setDefault'),beforeGlobalBind=count('bind');
  click(byText(t('badgeSetGlobalDefault'),menu()),'global default has a separate explicit button');
  await waitFor(()=>count('setDefault')===beforeGlobal+1 && menu()?.getAttribute('aria-busy')!=='true','global update did not settle');
  assert(target.state.selected===A && target.state.global===A,'global action does not change current bound account');
  assert(count('bind')===beforeGlobalBind,'global action is not a hidden session bind');
  click(byText(t('badgeFollowGlobal'),menu()),'Follow global unbind via separate DOM row');
  await waitFor(()=>target.state.selected===null && !menu(),'follow-global did not settle');
  await openMenu();
  assert(byText(t('badgeFollowGlobal')+'✓',menu())?.disabled || [...menu().querySelectorAll('button')].some(b=>b.textContent.replace(/\s/g,'')===t('badgeFollowGlobal').replace(/\s/g,'')+'✓' && b.disabled),'Follow-global row has selected check');
  assert(!row(labelA).disabled,'current global account may still be explicitly pinned to this Session');
  target.state.rawBuiltin=true;target.projection.set({});await ready('—');
  assert(!badge().textContent.includes('88%'),'raw built-in unmanaged route never claims managed global credits');
  await openMenu();click(byText(t('badgeFollowGlobal'),menu()),'explicitly migrate unmanaged route to managed Follow global');await ready('88%');await openMenu();
  assert(target.catalog().next.provider==='copilot-default','Follow global uses managed default provider');
  // Hold a read on old Host, replace retained binding with SAME Session id, then release old data.
  let releaseOldRead;
  target.nextCatalog=()=>new Promise(resolve=>{releaseOldRead=resolve;});
  click(menu().querySelector(`button[aria-label="${t('badgeRefresh')}"]`),'start controlled old-host read');
  await tick();
  const hostTwo=host('host-two',{usedA:33,usedB:66});switchHost(hostTwo);await ready('67%');
  assert(typeof releaseOldRead==='function','controlled old-host read was pending');
  const old=host('stale-old',{usedA:1}).catalog();releaseOldRead({ok:true,value:old});await tick();
  assert(badge().textContent.trim().endsWith('67%'),'late same-SID old-Host response is discarded');
  assert(!document.body.innerText.includes('stale-old'),'old-Host account identity never leaks to new view');
  await openMenu();assert(row('host-two-a.ghe.com/alice'),'menu resolves current Host accounts after replacement');
  // Explicit mount-cleanup-remount under production StrictMode exercises fresh client ownership.
  const lastOldCall=calls.at(-1),oldSignal=lastOldCall.signal;
  unmount();assert(oldSignal.aborted,'component cleanup disposes captured client and aborts its RPC signal');
  assert(target.eventCallbacks('api-session/error').length===0,'component cleanup removes scoped native failure listener');
  mount();await ready('67%');
  assert(calls.at(-1).signal!==oldSignal && !calls.at(-1).signal.aborted,'remount creates a fresh non-disposed client');
  await openMenu();
  const mutationsBeforeFailure=count('bind');
  hostTwo.nextBind=()=>Promise.resolve({ok:false,error:{code:'ACCOUNT_MODEL_UNAVAILABLE',message:'PRIVATE_RAW_SERVER_DIAGNOSTIC_MUST_NOT_RENDER'}});
  click(row('host-two-b.ghe.com/alice'),'trigger controlled switch failure');
  await waitFor(()=>modal() || document.querySelector('[role="alert"]'),'switch failure was not presented');
  assert(count('bind')===mutationsBeforeFailure+1,'failed switch is never automatically retried');
  assert(!document.body.innerText.includes('PRIVATE_RAW'),'raw server diagnostics are not rendered');
  assert(!modal(),'rejected account selection is a safe inline error, not a continuation-failure notice');
  // A failure from a superseded Host must not create either a popup or an alert.
  if(modal())click(modal().querySelector('button[aria-label="Close modal"]'),'close current test popup');
  await openMenu();
  const refreshButton=menu().querySelector(`button[aria-label="${t('badgeRefresh')}"]`);if(refreshButton)click(refreshButton,'prepare current catalog after failure');await ready('67%');await openMenu();
  let releaseStaleFailure;
  hostTwo.nextBind=()=>new Promise(resolve=>{releaseStaleFailure=resolve;});
  click(row('host-two-b.ghe.com/alice'),'start controlled old-Host switch');await tick();
  const modalCount=window.__modalOpenEvents.length;
  const hostThree=host('host-three',{usedA:44,usedB:77});hostThree.notice=failureNotice(hostThree);switchHost(hostThree);await ready('56%');await settle();
  assert(!modal(),'historical notice on initial catalog does not open a new failure popup');
  assert(typeof releaseStaleFailure==='function','old-Host switch was pending');
  releaseStaleFailure({ok:false,error:{code:'ACCOUNT_MODEL_UNAVAILABLE',message:'PRIVATE_OLD_HOST_ERROR'}});await tick();
  assert(window.__modalOpenEvents.length===modalCount && !modal(),'old-Host switch error cannot open popup in the new Host');
  assert(!document.body.innerText.includes('PRIVATE_OLD_HOST') && !document.querySelector('[role="alert"]'),'superseded failure does not alter current alert state');
  assert(badge().textContent.trim().endsWith('56%'),'new Host badge remains selected after old failure');
  await openMenu();
  let releaseOldGeneration;
  target.nextCatalog=()=>new Promise(resolve=>{releaseOldGeneration=resolve;});
  click(menu().querySelector(`button[aria-label="${t('badgeRefresh')}"]`),'start controlled old connection-generation read');await tick();
  target.state.accounts[0].usage={percentUsed:55,resets:'2030-01-01'};
  target.generation.set(Object.freeze({id:'reconnected-same-host'}));await ready('45%');
  assert(typeof releaseOldGeneration==='function','old connection-generation request was pending');
  releaseOldGeneration({ok:true,value:host('same-host-old-gen',{usedA:1}).catalog()});await tick();
  assert(badge().textContent.trim().endsWith('45%') && !document.body.innerText.includes('same-host-old-gen'),'same-Host stale-generation response is discarded after reconnect');
  if(window.HARNESS_REQUIRE_POPUP) {
    assert(target.eventCallbacks('api-session/error').length===1,'actual badge holds one current scoped error listener');
    const mutationsBeforeNotice=count('bind'),nativeReads=count('catalog');
    target.notice=failureNotice(target);target.emit('api-session/error','some-other-session','PRIVATE_WRONG_SESSION');await settle();
    assert(count('catalog')===nativeReads && !modal(),'foreign Session error event is ignored before a catalog read');
    for(const override of [{sessionId:'some-other-session'},{accountId:B},{logicalProvider:RB},{model:'wrong-model'}]) {
      emitFailure(target,failureNotice(target,override));await settle();
      assert(!modal(),'catalog notice must match current Session/account/route/model '+Object.keys(override)[0]);
    }
    const currentNotice=failureNotice(target);emitFailure(target,currentNotice);
    await waitFor(()=>modal(),'current scoped continuation failure popup did not open');await settle();
    assert(modal().textContent.includes(t('badgeFailureTitle')) && modal().textContent.includes(t('badgeFailureBody')),'failure popup uses translated public title and preservation message');
    assert(!document.body.innerText.includes('PRIVATE_RAW_EVENT'),'native raw error text is never rendered in popup');
    assert(!menu(),'account menu closes while the failure modal is open');
    const opens=window.__modalOpenEvents.length;
    click(modal().querySelector('button[aria-label="Close modal"]'),'dismiss current failure popup');await waitFor(()=>!modal(),'failure popup did not close');
    target.emit('api-session/error',SID,'PRIVATE_DUPLICATE_NOTICE');await settle();
    assert(!modal() && window.__modalOpenEvents.length===opens,'same notice id is displayed once even after repeated native error event');
    await openMenu();click(menu().querySelector(`button[aria-label="${t('badgeRefresh')}"]`),'read-only refresh after dismissed notice');await ready('45%');await settle();
    assert(!modal() && window.__modalOpenEvents.length===opens,'dismissed notice does not reopen on normal refresh');
    assert(count('bind')===mutationsBeforeNotice,'continuation-failure presentation never silently retries an account mutation');
    const oldHost=target,oldCallbacks=oldHost.eventCallbacks('api-session/error');
    oldHost.notice=failureNotice(oldHost);const lateNoticeCatalog=oldHost.catalog();let releaseNotice;
    oldHost.nextCatalog=()=>new Promise(resolve=>{releaseNotice=resolve;});oldHost.emit('api-session/error',SID,'PRIVATE_PENDING_OLD_NOTICE');await tick();
    assert(typeof releaseNotice==='function','native failure catalog read is deliberately pending');
    switchHost(host('host-four',{usedA:45,usedB:88}));await ready('55%');
    assert(oldHost.eventCallbacks('api-session/error').length===0,'Host retirement removes old native error subscription');
    releaseNotice({ok:true,value:lateNoticeCatalog});await settle();
    const afterHostRead=count('catalog');for(const callback of oldCallbacks)callback(SID,'PRIVATE_QUEUED_OLD_EVENT');await settle();
    assert(!modal() && window.__modalOpenEvents.length===opens,'late old-Host catalog notice cannot open a popup');
    assert(count('catalog')===afterHostRead,'already-queued retired-Host listener cannot request current catalog');
    emitFailure(target,failureNotice(target));await waitFor(()=>modal(),'new Host current notice should open its own popup');await settle();
    const noticeCount=window.__modalOpenEvents.length;
    switchHost(host('host-five',{usedA:46,usedB:89}));await ready('54%');
    await waitFor(()=>!modal(),'already-open old-Host failure popup leaked into replacement Host');
    assert(window.__modalOpenEvents.length===noticeCount,'Host replacement closes rather than reopens old notices');
    assert(!document.body.innerText.includes('PRIVATE_'),'no raw diagnostic from any notice scenario is visible');
  }
  assert(forbiddenNetwork===0,'component performed no fetch/WebSocket/network fallback');
  assert(errors.length===0,'no browser runtime errors or unhandled rejections');
  await openMenu();
  if(window.HARNESS_SCREENSHOT_POPUP) {
    emitFailure(target,failureNotice(target));await waitFor(()=>modal(),'final failure screenshot popup did not open');await settle();
    assert(modal().textContent.includes(t('badgeFailureBody')) && !menu(),'final screenshot captures safe failure modal, not overlapping account menu');
  }
}

function finish(result) {
  document.getElementById('result').textContent=JSON.stringify(result);
  document.documentElement.dataset.test=result.passed?'passed':'failed';window.__result=result;
  // Collection is controlled by the test's isolated CDP binding. If this file
  // is opened manually, keep the result in its synthetic DOM only: NEVER start
  // a download into a user's real Downloads/OneDrive location.
  if(typeof window.__HARNESS_REPORT__==='function')window.__HARNESS_REPORT__(result);
}
run().then(()=>{
  const result={passed:true,assertions,counts:{rpc:calls.length,bind:count('bind'),setDefault:count('setDefault'),forbiddenNetwork,modalOpens:window.__modalOpenEvents.length},versions:{react:React.version,reactDOM:ReactDOM.version},scope:{actualComponent:true,installedReactDOM:true,syntheticRPC:true,actualHostModal:false,strictModeProductionExplicitRemount:true,popupRequired:window.HARNESS_REQUIRE_POPUP},rpc:calls.map(({signal,...call})=>call)};
  finish(result);
}).catch(error=>{
  const result={passed:false,failedAssertion:error.message,assertions,forbiddenNetwork,errors,modalOpens:window.__modalOpenEvents.length};
  finish(result);
});
