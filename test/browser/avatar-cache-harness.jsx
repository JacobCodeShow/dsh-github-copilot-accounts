// Mechanism experiment only, not production cache code. No account data/URLs.
import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createAvatarImageCache } from 'test:avatar-pool';
import { AccountAvatar, avatarImageCache as productionAvatarCache } from 'test:avatar-hook';

const URLS=Object.freeze({baseline:'https://syntheticavatar.invalid/baseline.png',master:'https://syntheticavatar.invalid/retained.png',dom:'https://syntheticavatar.invalid/dom-master.png',cors:'https://syntheticavatar.invalid/cors.png',replacement:'https://syntheticavatar.invalid/replacement.png'});
const assertions=[];
let draws=0,unexpectedErrors=0;
window.addEventListener('unhandledrejection',()=>unexpectedErrors++);
const assert=(value,name)=>{if(!value)throw new Error(name);assertions.push(name);};
const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
const control=(op,value)=>window.__avatarControlCall({op,...value});
function pendingImage(url){
  const image=new Image();image.referrerPolicy='no-referrer';image.decoding='async';
  const loaded=new Promise((resolve,reject)=>{
    image.onload=async()=>{try{await image.decode();resolve(image);}catch{reject(new Error('Synthetic PNG decode failed'));}};
    image.onerror=()=>reject(new Error('Synthetic PNG load failed'));
  });
  image.src=url;return {image,loaded};
}
// Diagnostic STATIC benchmark only: draw-once freezes animation. Production
// direction is retained owned IMG nodes, not these canvases.
function CanvasAvatar({master,version,label}){
  const canvas=useRef(null);
  useLayoutEffect(()=>{const node=canvas.current;node.width=72;node.height=72;node.getContext('2d').drawImage(master,0,0,72,72);node.dataset.painted=version;draws++;},[master,version]);
  return <figure><canvas ref={canvas} data-avatar data-version={version} aria-label={label}/><figcaption>{label}</figcaption></figure>;
}
function Canvases({master,version}){return <div className="row">{[1,2,3].map(number=><CanvasAvatar key={number} master={master} version={version} label={`Canvas ${number}: ${version}`}/>)}</div>;}
let root;
const mountCanvas=(master,version)=>{root=createRoot(document.getElementById('avatar-root'));flushSync(()=>root.render(<Canvases master={master} version={version}/>));};
const unmount=()=>flushSync(()=>root.unmount());
async function baselineCycle(){
  const loaded=new Promise((resolve,reject)=>{
    root=createRoot(document.getElementById('baseline-root'));
    flushSync(()=>root.render(<img width="72" height="72" src={URLS.baseline} onLoad={event=>{assert(event.currentTarget.naturalWidth===1,'new baseline IMG decoded the fixed fake PNG');resolve();}} onError={()=>reject(new Error('Baseline IMG failed'))}/>));
  });
  await loaded;await frame();unmount();
}
function PoolView({lease,label}){
  const container=useRef(null);
  useLayoutEffect(()=>lease.attach(container.current),[lease]);
  return <figure><div ref={container} data-pool-slot={label} style={{width:72,height:72,border:'1px dashed #aaa',borderRadius:'50%'}}/><figcaption>{label}</figcaption></figure>;
}
const renderLeases=(id,leases)=>{const rendered=createRoot(document.getElementById(id));flushSync(()=>rendered.render(<div className="row">{leases.map(({lease,label})=><PoolView key={label} lease={lease} label={label}/>)}</div>));return rendered;};
const poolContainer=(label)=>document.querySelector(`[data-pool-slot="${label}"]`);
async function verifyPool(){
  const WARM='https://syntheticavatar.invalid/pool-warm.png',FRESH='https://syntheticavatar.invalid/pool-replacement.png',LATE='https://syntheticavatar.invalid/pool-late.png';
  const rotated=[1,2,3,4,5].map(number=>'https://syntheticavatar.invalid/pool-rotate-'+number+'.png');
  const created=[],timers=new Set();let now=0,scopeALive=true;
  const cache=createAvatarImageCache({createImage:()=>{const image=new Image();created.push(image);return image;},now:()=>now,
    schedule:(fn,delay)=>{const timer={fn,delay};timers.add(timer);return timer;},cancel:timer=>timers.delete(timer),
    ttlMs:100,hardTtlMs:1000,retryMs:50,loadTimeoutMs:2000,maxEntries:8,maxSlots:2,maxPending:4,maxPixels:32,maxImagePixels:4});
  const scopeA={},scopeB={};const issuer='synthetic-issuer-A',accountId='copilot-auth/account-a';
  const acquire=(scope,slot,source,other={})=>cache.acquire({scope,issuer,accountId,slot,source,isCurrent:()=>scope!==scopeA||scopeALive,...other});
  let header=acquire(scopeA,'header',WARM);await header.settled();let row=acquire(scopeA,'row',WARM);await row.settled();
  let view=renderLeases('pool-old',[{lease:header,label:'old-header'},{lease:row,label:'old-row'}]);await frame();
  const oldHeader=poolContainer('old-header').firstElementChild,oldRow=poolContainer('old-row').firstElementChild;
  assert(oldHeader instanceof HTMLImageElement && oldRow instanceof HTMLImageElement && oldHeader!==oldRow,'actual cache gives header/row distinct native IMG nodes, not canvases or shared active DOM');
  assert(oldHeader.naturalWidth===1 && oldRow.naturalWidth===1 && header.snapshot().hasImage && row.snapshot().hasImage,'actual cache display slots fully loaded fixed PNGs');
  const initial=(await control('counts'))['pool-warm'].image;
  assert(initial>=1&&initial<=2&&created.length===2,'two display slots use at most two initial image GETs per account');
  const third=acquire(scopeA,'third',WARM);assert(!third.snapshot().hasImage && third.snapshot().reason==='capacity','third active display slot falls back instead of growing the pool');third.release();
  for(let cycle=0;cycle<5;cycle++){
    flushSync(()=>view.unmount());header.release();row.release();
    header=acquire(scopeA,'header',rotated[cycle]);row=acquire(scopeA,'row',rotated[cycle]);
    view=renderLeases('pool-old',[{lease:header,label:'old-header'},{lease:row,label:'old-row'}]);await frame();
    assert(poolContainer('old-header').firstElementChild===oldHeader && poolContainer('old-row').firstElementChild===oldRow,'warm menu reopen retains each own IMG identity cycle '+cycle);
    assert(oldHeader.getAttribute('src')===WARM && oldRow.getAttribute('src')===WARM,'rotated opaque source is not assigned while display slots are fresh cycle '+cycle);
  }
  const warm=await control('counts');
  assert(warm['pool-warm'].image===initial && rotated.every((_,index)=>warm['pool-rotate-'+(index+1)].image===0),'five warm rotated-source reopens issue ZERO additional URL requests');
  now=101;await control('stage',{name:'pool-swr-loading'});header.updateSource(FRESH);row.updateSource(FRESH);await frame();
  assert(header.snapshot().refreshing && row.snapshot().refreshing && poolContainer('old-header').firstElementChild===oldHeader && poolContainer('old-row').firstElementChild===oldRow,'TTL refresh leaves both native old IMG nodes visible while candidates are held');
  await control('capture-pool-stale');await control('release-replacement',{label:'pool-replacement'});
  await Promise.all([header.settled(),row.settled()]);await frame();
  const freshHeader=poolContainer('old-header').firstElementChild,freshRow=poolContainer('old-row').firstElementChild;
  assert(freshHeader instanceof HTMLImageElement && freshRow instanceof HTMLImageElement && freshHeader!==oldHeader && freshRow!==oldRow,'both native slots swap ownership only after candidate image onload');
  assert(freshHeader.getAttribute('src')===FRESH && freshRow.getAttribute('src')===FRESH && oldHeader.getAttribute('src')===null && oldRow.getAttribute('src')===null,'new opaque sources remain exact and superseded nodes release their source');
  const freshCount=(await control('counts'))['pool-replacement'].image;assert(freshCount>=1&&freshCount<=2,'two-slot URL rotation uses bounded replacement GETs');
  await control('capture-pool-fresh');
  now=202;await control('stage',{name:'pool-late-old-scope'});header.updateSource(LATE);row.updateSource(LATE);await frame();
  const callbacks=created.filter(image=>image.getAttribute('src')===LATE).map(image=>image.onload).filter(Boolean);
  assert(callbacks.length===2,'both old-scope candidates are held before their completion callbacks');
  const oldPending=Promise.all([header.settled(),row.settled()]);scopeALive=false;cache.disposeScope(scopeA);await oldPending;await frame();
  assert(!poolContainer('old-header').firstElementChild && !poolContainer('old-row').firstElementChild,'scope disposal immediately clears BOTH old image containers');
  assert(!header.snapshot().hasImage && !row.snapshot().hasImage && cache.stats().entries===0,'disposed scope has no retained readable image state');
  await control('release-replacement',{label:'pool-late',allowCancelled:true});for(const callback of callbacks)callback();await frame();
  assert(!poolContainer('old-header').firstElementChild && !poolContainer('old-row').firstElementChild && cache.stats().entries===0,'late native completion and captured old callbacks cannot revive a disposed scope');
  const retired=acquire(scopeA,'header',WARM);assert(!retired.snapshot().hasImage && retired.snapshot().reason==='invalid','retired scope cannot be reacquired after disposal');retired.release();
  await control('stage',{name:'pool-new-host'});
  const newHeader=acquire(scopeB,'header',WARM),newRow=acquire(scopeB,'row',WARM);await Promise.all([newHeader.settled(),newRow.settled()]);
  renderLeases('pool-new',[{lease:newHeader,label:'new-host-header'},{lease:newRow,label:'new-host-row'}]);await frame();
  const newHeaderNode=poolContainer('new-host-header').firstElementChild,newRowNode=poolContainer('new-host-row').firstElementChild;
  assert(newHeaderNode!==freshHeader && newRowNode!==freshRow && newHeaderNode!==oldHeader && newRowNode!==oldRow,'same account on a new Host scope never reuses old-scope IMG nodes');
  const otherIssuer=acquire(scopeB,'header',WARM,{issuer:'synthetic-issuer-B'}),otherAccount=acquire(scopeB,'header',WARM,{accountId:'copilot-auth/account-b'});
  await Promise.all([otherIssuer.settled(),otherAccount.settled()]);renderLeases('pool-other',[{lease:otherIssuer,label:'other-issuer'},{lease:otherAccount,label:'other-account'}]);await frame();
  assert(poolContainer('other-issuer').firstElementChild!==newHeaderNode && poolContainer('other-account').firstElementChild!==newHeaderNode && poolContainer('other-issuer').firstElementChild!==poolContainer('other-account').firstElementChild,'issuer/account identity prevents native-node reuse even for the SAME source string');
  assert(document.querySelectorAll('#pool-section canvas').length===0,'actual shipping candidate renders native IMG only, preserving native format semantics without canvas');
  return {initialGETs:initial,replacementGETs:freshCount,stats:cache.stats(),nativeIMGIdentity:true,rotatedWarmReopens:5,lateCallbacksInert:true,actualCacheAPI:true,animatedPixelsTested:false};
}
const hookWait=(check,name)=>new Promise((resolve,reject)=>{
  let done=false;const finish=error=>{if(done)return;done=true;observer.disconnect();clearTimeout(timer);error?reject(error):resolve();};
  const verify=()=>{try{if(check())finish();}catch{}};
  const observer=new MutationObserver(verify);observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  const timer=setTimeout(()=>finish(new Error(name)),3000);verify();
});
function ActualHookPair(props){return <div className="row">{['header','row'].map(slot=><figure key={slot}><div data-hook-slot={slot}><AccountAvatar {...props} slot={slot} size={72}/></div><figcaption>Actual AccountAvatar {slot}</figcaption></figure>)}</div>;}
const hookNode=slot=>document.querySelector(`[data-hook-slot="${slot}"] img`);
async function verifyActualHook(){
  const WARM='https://syntheticavatar.invalid/hook-warm.png',NEW_SCOPE='https://syntheticavatar.invalid/hook-scope-new.png',RECOVER='https://syntheticavatar.invalid/hook-recover.png',LATE='https://syntheticavatar.invalid/hook-late.png',LATE_NEW='https://syntheticavatar.invalid/hook-late-new.png',STALE='https://syntheticavatar.invalid/hook-stale-recovered.png';
  const sourceRotations=[1,2,3,4,5].map(number=>'https://syntheticavatar.invalid/hook-rotate-'+number+'.png');
  const nativeFetch=window.fetch;let fetchProbes=0,unexpectedProfile=0;
  window.fetch=()=>{fetchProbes++;return Promise.reject(new Error('Fetch probes forbidden in actual avatar hook proof'));};
  const scopeA={},scopeB={};let currentScope=scopeA;
  const props={id:'copilot-auth/account-hook-a',issuer:'synthetic-hook.ghe.com',url:WARM,login:'alice',scopeKey:scopeA,isCurrent:()=>currentScope===scopeA,requestProfile:async()=>{unexpectedProfile++;throw new Error('Unexpected successful-avatar profile recovery');}};
  let rendered=createRoot(document.getElementById('hook-root'));flushSync(()=>rendered.render(<ActualHookPair {...props}/>));
  await hookWait(()=>hookNode('header')?.complete&&hookNode('row')?.complete&&hookNode('header').naturalWidth===1&&hookNode('row').naturalWidth===1,'actual header/row hooks did not render loaded IMG');await frame();
  const header=hookNode('header'),row=hookNode('row');
  assert(header instanceof HTMLImageElement && row instanceof HTMLImageElement && header!==row,'actual AccountAvatar header/row own distinct native IMG nodes');
  const initial=(await control('counts'))['hook-warm'].image;assert(initial>=1&&initial<=2,'actual two-view hook uses at most two initial image GETs');
  for(let cycle=0;cycle<5;cycle++){
    flushSync(()=>rendered.unmount());
    rendered=createRoot(document.getElementById('hook-root'));flushSync(()=>rendered.render(<ActualHookPair {...props} url={sourceRotations[cycle]}/>));await frame();
    assert(hookNode('header')===header&&hookNode('row')===row,'actual AccountAvatar remount preserves both IMG identities cycle '+cycle);
    assert(header.getAttribute('src')===WARM && row.getAttribute('src')===WARM,'actual hook fresh TTL does not assign rotated opaque source cycle '+cycle);
  }
  const warmCounts=await control('counts');
  assert(warmCounts['hook-warm'].image===initial && sourceRotations.every((_,index)=>warmCounts['hook-rotate-'+(index+1)].image===0),'actual component five warm rotated-source reopens issue ZERO additional GETs');
  assert(unexpectedProfile===0,'successful warm avatars never request profile recovery');

  // Same actual React subtree, new owner scope: old photos must disappear within
  // the synchronous commit, before a held new-scope candidate can possibly load.
  currentScope=scopeB;flushSync(()=>rendered.render(<ActualHookPair {...props} url={NEW_SCOPE} scopeKey={scopeB} isCurrent={()=>currentScope===scopeB}/>));
  assert(!header.isConnected&&!row.isConnected&&!hookNode('header')&&!hookNode('row'),'actual hook scope change detaches/hides old photos synchronously before paint');
  productionAvatarCache.disposeScope(scopeA);await frame();await control('capture-hook-cleared');
  await control('release-replacement',{label:'hook-scope-new'});
  await hookWait(()=>hookNode('header')?.naturalWidth===1&&hookNode('row')?.naturalWidth===1,'actual new-scope hooks did not load');
  assert(hookNode('header')!==header&&hookNode('row')!==row,'actual hook new scope never reuses old image nodes');

  let recoverCalls=0,recovered=0;const recoverScope={};
  const recoverRequester=async(id)=>{assert(id==='copilot-auth/account-hook-recover','hook recovery uses its fixed account id');recoverCalls++;return RECOVER;};
  const recovery=createRoot(document.getElementById('hook-recovery'));
  const recoveryView=()=> <div data-hook-recovery><AccountAvatar id="copilot-auth/account-hook-recover" issuer="synthetic-hook.ghe.com" slot="row" url={RECOVER} login="recover" size={72} scopeKey={recoverScope} isCurrent={()=>true} requestProfile={recoverRequester} onRecovered={()=>{recovered++;}}/></div>;
  flushSync(()=>recovery.render(recoveryView()));
  await hookWait(()=>document.querySelector('[data-hook-recovery] img')?.naturalWidth===1,'actual failed-source hook did not recover');await frame();
  for(let repeat=0;repeat<3;repeat++){flushSync(()=>recovery.render(recoveryView()));await frame();}
  assert(recoverCalls===1&&recovered===1&&(await control('counts'))['hook-recover'].image===2,'actual onError requests ONE profile and forces ONE same-URI retry without a loop');

  let releaseProfile,profileStarted,lateProfiles=0,oldRecovered=0;const started=new Promise(resolve=>{profileStarted=resolve;});
  const lateScope={},lateNewScope={};let lateCurrent=lateScope;
  const lateRequester=()=>{lateProfiles++;profileStarted();return new Promise(resolve=>{releaseProfile=resolve;});};
  const lateRoot=createRoot(document.getElementById('hook-late-root'));
  const lateProps={id:'copilot-auth/account-hook-late',issuer:'synthetic-hook.ghe.com',slot:'row',url:LATE,login:'late',size:72,scopeKey:lateScope,isCurrent:()=>lateCurrent===lateScope,requestProfile:lateRequester,onRecovered:()=>{oldRecovered++;}};
  flushSync(()=>lateRoot.render(<div data-hook-late><AccountAvatar {...lateProps}/></div>));await started;
  lateCurrent=lateNewScope;flushSync(()=>lateRoot.render(<div data-hook-late><AccountAvatar {...lateProps} url={LATE_NEW} scopeKey={lateNewScope} isCurrent={()=>lateCurrent===lateNewScope}/></div>));productionAvatarCache.disposeScope(lateScope);
  await hookWait(()=>document.querySelector('[data-hook-late] img')?.naturalWidth===1,'replacement scope for pending profile did not load');
  const currentImage=document.querySelector('[data-hook-late] img');releaseProfile(STALE);await frame();await frame();
  assert(lateProfiles===1&&oldRecovered===0&&(await control('counts'))['hook-stale-recovered'].image===0&&document.querySelector('[data-hook-late] img')===currentImage,'late old-scope profile resolution never loads stale source or mutates the new actual hook');
  assert(fetchProbes===0,'actual AccountAvatar uses native image loads and supplied recovery, never a fetch probe');window.fetch=nativeFetch;
  return{actualAccountAvatar:true,actualSingleton:true,initialGETs:initial,warmReopens:5,recoveryCalls:recoverCalls,sameUriRetryGETs:2,scopeBeforePaintClear:true,lateProfileInert:true,fetchProbes};
}
async function run(){
  assert(React.version==='18.3.1','actual installed React runtime renders the experiment');
  await control('stage',{name:'new-img-first'});await baselineCycle();
  await control('gc');
  await control('stage',{name:'new-img-remount'});await baselineCycle();
  const baseline=(await control('counts')).baseline;
  assert(baseline.image===2,'new IMG remounts issue two image GETs under no-store/cache-disabled conditions');

  await control('stage',{name:'retained-master-load'});
  const master=await pendingImage(URLS.master).loaded;
  assert(master.naturalWidth===1 && master.complete && master.crossOrigin===null,'retained master decoded without requesting CORS permission');
  assert(!master.isConnected,'master remains strongly referenced off DOM');
  const before=(await control('counts')).master.image;
  for(let cycle=0;cycle<3;cycle++){
    await control('stage',{name:`canvas-menu-cycle-${cycle}`});
    mountCanvas(master,'old');await frame();
    assert(document.querySelectorAll('canvas[data-painted="old"]').length===3,'independent React canvases draw the owned master cycle '+cycle);
    if(cycle===0){
      let security=false;
      try{document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1);}catch(error){security=error.name==='SecurityError';}
      assert(security,'browser canvas remains tainted: test-only getImageData is denied');
    }
    unmount();await frame();
  }
  assert((await control('counts')).master.image===before && before===1,'close/reopen and nine canvas draws issue no new master URL requests');

  await control('stage',{name:'retained-dom-load'});
  const domMaster=await pendingImage(URLS.dom).loaded;
  const holder=document.getElementById('dom-master');
  for(let cycle=0;cycle<2;cycle++){holder.appendChild(domMaster);await frame();holder.removeChild(domMaster);await frame();}
  holder.appendChild(domMaster);domMaster.width=72;domMaster.height=72;
  assert((await control('counts')).dom.image===1,'reattaching the SAME retained IMG element reuses its loaded resource');

  await control('stage',{name:'cors-image-versus-fetch'});
  const corsImage=await pendingImage(URLS.cors).loaded;
  assert(corsImage.naturalWidth===1,'CORS-denied CDN image can still display in ordinary IMG');
  let corsRejected=false,blobCreated=false;
  try{const response=await fetch(URLS.cors,{mode:'cors',cache:'no-store'});await response.blob();blobCreated=true;}catch(error){corsRejected=error.name==='TypeError';}
  assert(corsRejected && !blobCreated,'native fetch-to-Blob is rejected by missing CORS permission');

  // Fake TTL is advanced explicitly; no wall-clock sleep or production cache framework.
  const clock={now:0,expires:100};clock.now=101;
  assert(clock.now>clock.expires,'fake TTL has expired');
  mountCanvas(master,'old');await frame();
  const oldPreview=createRoot(document.getElementById('old-preview'));
  flushSync(()=>oldPreview.render(<CanvasAvatar master={master} version="old retained" label="Old decoded resource remains available"/>));
  await control('stage',{name:'replacement-loading'});
  const replacement=pendingImage(URLS.replacement);let replacementLoaded=false;
  void replacement.loaded.then(()=>{replacementLoaded=true;});
  await frame();
  assert(!replacementLoaded && !replacement.image.complete,'replacement is deliberately held pending at the synthetic CDN boundary');
  assert(document.querySelectorAll('#avatar-root canvas[data-painted="old"]').length===3 && master.complete,'old avatar remains drawn while replacement loads');
  await control('capture-stale');
  await control('release-replacement');
  const next=await replacement.loaded;
  assert(next!==master && next.naturalWidth===1,'replacement owns a different decoded image and only activates after load');
  flushSync(()=>root.render(<Canvases master={next} version="fresh"/>));await frame();
  assert(document.querySelectorAll('#avatar-root canvas[data-painted="fresh"]').length===3,'React canvases swap to replacement after successful load');
  assert((await control('counts')).master.image===1 && (await control('counts')).replacement.image===1,'URL-change refresh adds one replacement request, no refetch of old master');
  const pool=window.HARNESS_POOL_MODE?await verifyPool():undefined;
  const hook=window.HARNESS_HOOK_MODE?await verifyActualHook():undefined;
  assert(unexpectedErrors===0,'no unhandled image/React errors occurred');
  return {passed:true,assertions,draws,corsFetchRejected:corsRejected,blobCreated,...(pool?{pool}:{}),...(hook?{hook}:{}),
    scope:{actualReact:true,ordinaryCrossOriginImages:true,canvasDrawOnlyCandidate:true,canvasStaticBenchmarkOnly:true,retainedNativeIMGReattach:true,animatedImageTested:false,testOnlyNegativePixelRead:true,noPixelExport:true,retainedMaster:true,noStoreFixture:true,httpCacheDisabled:true,urlChangeSWR:true,sameUrlContentRevalidation:false,productionCacheImplementation:false}};
}
run().then(result=>{document.documentElement.dataset.test='passed';document.getElementById('result').textContent=JSON.stringify(result);window.__AVATAR_REPORT__(result);}).catch(error=>{const result={passed:false,failedAssertion:error.message,assertions,draws,unexpectedErrors};document.documentElement.dataset.test='failed';document.getElementById('result').textContent=JSON.stringify(result);window.__AVATAR_REPORT__(result);});
