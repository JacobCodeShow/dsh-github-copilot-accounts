// UNINTEGRATED prototype: retain OWN native IMG nodes, not copied pixels.
// Sources stay opaque/in-memory. No fetch, URL parsing, auth forwarding, Blob,
// canvas, cache-busting, proxy, disk storage, private DOM or CORS/CSP changes.
// Natural-size pixel limits estimate retained RGBA planes; they do not bound
// encoded/animated image memory or transient browser decode allocations.
export class AvatarImageCacheError extends Error {
  constructor() { super("Avatar image cache is unavailable"); this.name = "AvatarImageCacheError"; }
}
const text = (value) => typeof value === "string" && value.length > 0;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const INVALID = Object.freeze({status:"invalid",hasImage:false,refreshing:false,stale:false,revision:0});
const inert = (reason) => {
  const state=Object.freeze({status:"fallback",hasImage:false,refreshing:false,stale:false,reason,revision:0});
  return Object.freeze({snapshot:()=>state,subscribe:()=>()=>{},attach:()=>()=>{},updateSource(){},refresh:()=>Promise.resolve(false),settled:()=>Promise.resolve(false),release(){}});
};

export function createAvatarImageCache({ createImage = () => new Image(),
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  schedule = (fn, delay) => setTimeout(fn, delay), cancel = (timer) => clearTimeout(timer),
  ttlMs = 5 * 60_000, hardTtlMs = 30 * 60_000, retryMs = 60_000,
  loadTimeoutMs = 15_000, maxEntries = 32, maxSlots = 2, maxPending = 4,
  maxPixels = 4 * 1024 * 1024, maxImagePixels = 1024 * 1024 } = {}) {
  if (![createImage,now,schedule,cancel].every((value)=>typeof value==="function")
    || ![ttlMs,hardTtlMs,retryMs,loadTimeoutMs,maxEntries,maxSlots,maxPending,maxPixels,maxImagePixels].every(positive)
    || hardTtlMs<ttlMs || maxSlots>2 || maxImagePixels>maxPixels) throw new AvatarImageCacheError();
  const scopes=new Map(),lru=new Map(),queue=new Set(),owners=new WeakMap(),retiredScopes=new WeakSet();
  let closed=false,closing=false,pixels=0,inflight=0,pumping=false;
  const liveEntry=(entry)=>!closed&&!entry.removed&&scopes.get(entry.scope)?.get(entry.key)===entry;
  const live=(slot)=>liveEntry(slot.entry)&&!slot.removed&&slot.entry.slots.get(slot.key)===slot;
  const stop=(timer)=>{if(timer!==undefined)cancel(timer);};
  const touch=(entry)=>{if(liveEntry(entry)){entry.touched=now();lru.delete(entry);lru.set(entry,true);}};
  const detachNode=(node,container)=>{try{if(node?.parentNode===container)container.removeChild(node);}catch{/* only our node */}};
  const discard=(image)=>{if(!image)return;image.onload=image.onerror=null;try{image.removeAttribute?.("src");}catch{/* no empty src assignment */}};
  const detach=(lease)=>{
    const binding=lease.binding;if(!binding)return;
    if(owners.get(binding.container)===binding){detachNode(lease.shown,binding.container);owners.delete(binding.container);}
    lease.shown=lease.binding=undefined;
  };
  const present=(slot)=>{
    const lease=slot.lease,binding=lease?.binding;if(!binding||owners.get(binding.container)!==binding)return;
    const node=live(slot)&&lease.current()?slot.good?.image:undefined;
    if(lease.shown===node)return;
    detachNode(lease.shown,binding.container);lease.shown=undefined;
    if(node){try{binding.container.appendChild(node);lease.shown=node;}catch{/* owned presentation failure -> fallback */}}
  };
  const publish=(slot)=>{
    slot.state=Object.freeze({status:!live(slot)?"invalid":slot.good?"ready":slot.pending?"loading":"fallback",
      hasImage:live(slot)&&slot.good!==undefined,refreshing:live(slot)&&slot.good!==undefined&&slot.pending!==undefined,
      stale:live(slot)&&slot.good!==undefined&&now()>=slot.good.at+ttlMs,reason:slot.reason,failureRevision:slot.failureRevision,revision:slot.revision});
    present(slot);
    for(const listener of [...(slot.lease?.listeners??[])]){try{listener();}catch{/* never log source/errors */}}
  };
  const dropGood=(slot)=>{const previous=slot.good;if(!previous)return;slot.good=undefined;pixels-=previous.pixels;present(slot);discard(previous.image);};
  const removeSlot=(slot)=>{
    if(slot.removed)return;slot.removed=true;stop(slot.timer);slot.timer=undefined;
    slot.pending?.finish(false,true);dropGood(slot);slot.revision++;publish(slot);
    if(slot.lease)detach(slot.lease);
    slot.entry.slots.delete(slot.key);
  };
  const removeEntry=(entry)=>{
    if(!liveEntry(entry))return;entry.removed=true;
    for(const slot of [...entry.slots.values()])removeSlot(slot);
    scopes.get(entry.scope).delete(entry.key);if(!scopes.get(entry.scope).size)scopes.delete(entry.scope);
    lru.delete(entry);
  };
  const inactiveEntry=()=>[...lru.keys()].find((entry)=>[...entry.slots.values()].every((slot)=>!slot.lease));
  const reserve=(slot,area)=>{
    const oldArea=slot.good?.pixels??0;
    while(pixels-oldArea+area>maxPixels){
      let victim;
      for(const entry of lru.keys()){victim=[...entry.slots.values()].find((candidate)=>candidate!==slot&&!candidate.lease&&candidate.good);if(victim)break;}
      if(!victim)return false;removeSlot(victim);
      if(!victim.entry.slots.size)removeEntry(victim.entry);
    }
    return true;
  };
  const plan=(slot)=>{
    stop(slot.timer);slot.timer=undefined;if(!live(slot))return;
    const at=now(),hard=slot.good?slot.good.at+hardTtlMs:Infinity;
    const retry=slot.lease&&!slot.pending?Math.max(slot.retryAt,slot.good?slot.good.at+ttlMs:at+retryMs):Infinity;
    const idle=slot.lease?Infinity:slot.touched+hardTtlMs;
    const due=Math.min(hard,retry,idle);if(!Number.isFinite(due))return;
    slot.timer=schedule(()=>{
      slot.timer=undefined;if(!live(slot))return;
      if(!slot.lease&&(now()>=slot.touched+hardTtlMs||slot.good&&now()>=slot.good.at+hardTtlMs)){
        const entry=slot.entry;removeSlot(slot);if(!entry.slots.size)removeEntry(entry);return;
      }
      if(slot.good&&now()>=slot.good.at+hardTtlMs){dropGood(slot);slot.revision++;publish(slot);}
      if(slot.lease&&!slot.pending&&now()>=slot.retryAt)void load(slot);
      else plan(slot);
    },Math.max(1,due-at));
  };
  const pump=()=>{
    if(pumping||closed||closing)return;pumping=true;
    try{while(inflight<maxPending&&queue.size){
      const slot=queue.values().next().value;queue.delete(slot);const task=slot.pending;
      if(!task||task.phase!=="queued")continue;
      if(!live(slot)||!slot.lease||!slot.lease.current()){task.finish(false,true);continue;}
      let image;
      try{image=createImage();}catch{task.finish(false);continue;}
      task.phase="inflight";task.image=image;task.source=slot.entry.source;inflight++;
      image.onload=()=>task.finish(true);image.onerror=()=>task.finish(false);
      task.timeout=schedule(()=>task.finish(false),loadTimeoutMs);
      try{
        image.alt="";image.referrerPolicy="no-referrer";
        if(image.style)Object.assign(image.style,{width:"100%",height:"100%",objectFit:"cover",display:"block",borderRadius:"50%"});
        image.src=task.source; // exact opaque caller URL; no CORS attribute/auth
      }catch{task.finish(false);}
    }}finally{pumping=false;}
  };
  const load=(slot,force=false)=>{
    if(!live(slot)||closed||closing)return Promise.resolve(false);
    if(slot.pending)return slot.pending.promise;
    if(!force&&now()<slot.retryAt){plan(slot);return Promise.resolve(false);}
    slot.retryAt=0;
    let resolve;const promise=new Promise((done)=>{resolve=done;});
    const task={phase:"queued",promise,timeout:undefined,image:undefined,source:undefined,done:false,finish:undefined};
    task.finish=(ok,cancelled=false)=>{
      if(task.done)return;task.done=true;stop(task.timeout);queue.delete(slot);
      if(task.phase==="inflight")inflight--;
      const image=task.image;if(image)image.onload=image.onerror=null;
      if(slot.pending===task)slot.pending=undefined;
      if(ok&&live(slot)){
        const area=image.naturalWidth*image.naturalHeight;
        if(!positive(image.naturalWidth)||!positive(image.naturalHeight)||!positive(area)||area>maxImagePixels){ok=false;slot.reason="oversized";}
        else if(!reserve(slot,area)){ok=false;slot.reason="capacity";}
        else{
          const previous=slot.good;
          slot.good={image,pixels:area,at:now()};pixels+=area-(previous?.pixels??0);
          slot.retryAt=0;slot.failedSource=undefined;slot.reason=undefined;slot.revision++;present(slot);
          if(previous)discard(previous.image);
        }
      }else ok=false;
      const superseded=!ok&&!cancelled&&task.source!==undefined&&task.source!==slot.entry.source;
      if(!ok){discard(image);if(live(slot)&&!cancelled&&!superseded){slot.reason??="load-failed";slot.failedSource=task.source;slot.retryAt=now()+retryMs;slot.failureRevision++;slot.revision++;}}
      if(live(slot)){publish(slot);if(superseded&&slot.lease?.current())void load(slot,true);else plan(slot);}
      resolve(ok&&live(slot));pump();
    };
    slot.pending=task;slot.reason=undefined;queue.add(slot);publish(slot);plan(slot);pump();return promise;
  };
  const due=(slot)=>{
    // Background tabs can throttle timers; never briefly reattach a hard-expired
    // resource when a menu opens before its delayed expiry callback executes.
    if(slot.good&&now()>=slot.good.at+hardTtlMs){dropGood(slot);slot.revision++;publish(slot);}
    if(!slot.good&&slot.reason==="load-failed"&&text(slot.failedSource)&&slot.failedSource!==slot.entry.source)slot.retryAt=0;
    if(!slot.good||now()>=slot.good.at+ttlMs)void load(slot);else publish(slot);plan(slot);
  };
  return Object.freeze({
    acquire({scope,issuer,accountId,slot:key="row",source,isCurrent=()=>true}={}){
      if(closed||closing||scope===null||typeof scope!=="object"||!text(issuer)||!text(accountId)||!text(key)||!text(source)||typeof isCurrent!=="function")throw new AvatarImageCacheError();
      if(retiredScopes.has(scope))return inert("invalid");
      const identity=JSON.stringify([issuer,accountId]);let map=scopes.get(scope),entry=map?.get(identity);
      if(entry&&!liveEntry(entry))return inert("invalid");
      if(!entry){
        if(lru.size>=maxEntries){const victim=inactiveEntry();if(!victim)return inert("capacity");removeEntry(victim);}
        map=scopes.get(scope);if(!map)scopes.set(scope,map=new Map());
        entry={scope,key:identity,source,slots:new Map(),touched:now(),removed:false};map.set(identity,entry);touch(entry);
      }
      entry.source=source;touch(entry);
      let slot=entry.slots.get(key);
      if(slot?.lease)return inert("slot-in-use");
      if(!slot){
        if(entry.slots.size>=maxSlots){const victim=[...entry.slots.values()].filter((value)=>!value.lease).sort((a,b)=>a.touched-b.touched)[0];if(!victim)return inert("capacity");removeSlot(victim);}
        slot={entry,key,good:undefined,pending:undefined,timer:undefined,lease:undefined,reason:undefined,retryAt:0,touched:now(),revision:0,failureRevision:0,removed:false,state:INVALID};entry.slots.set(key,slot);
      }
      let released=false;
      const lease={listeners:new Set(),binding:undefined,shown:undefined,current:()=>{try{return !released&&isCurrent()===true;}catch{return false;}}};
      slot.lease=lease;slot.touched=now();due(slot);
      return Object.freeze({
        snapshot:()=>released||!lease.current()?INVALID:slot.state,
        subscribe(listener){if(released)return()=>{};lease.listeners.add(listener);return()=>lease.listeners.delete(listener);},
        attach(container){
          if(released||!live(slot)||typeof container?.appendChild!=="function"||typeof container?.removeChild!=="function")throw new AvatarImageCacheError();
          detach(lease);const previous=owners.get(container);if(previous)detach(previous.lease);
          const binding={container,lease};lease.binding=binding;owners.set(container,binding);due(slot);present(slot);
          return()=>{if(lease.binding===binding)detach(lease);};
        },
        updateSource(next){if(released||!live(slot)||!text(next))return;entry.source=next;due(slot);},
        refresh(next){
          if(released||!live(slot))return Promise.resolve(false);
          if(next!==undefined){if(!text(next))throw new AvatarImageCacheError();entry.source=next;if(slot.pending&&slot.pending.source!==next)slot.pending.finish(false,true);}
          return load(slot,true);
        },
        settled:()=>slot.pending?.promise??Promise.resolve(slot.good!==undefined),
        release(){if(released)return;released=true;detach(lease);lease.listeners.clear();if(slot.lease===lease)slot.lease=undefined;slot.touched=now();touch(entry);
          if(slot.pending?.phase==="queued")slot.pending.finish(false,true);plan(slot);},
      });
    },
    invalidateAccount(scope,issuer,accountId){const entry=scopes.get(scope)?.get(JSON.stringify([issuer,accountId]));if(entry)removeEntry(entry);},
    disposeScope(scope){if(scope!==null&&typeof scope==="object")retiredScopes.add(scope);for(const entry of [...(scopes.get(scope)?.values()??[])])removeEntry(entry);},
    stats:()=>({entries:lru.size,slots:[...lru.keys()].reduce((sum,entry)=>sum+entry.slots.size,0),retainedPixels:pixels,estimatedRgbaBytes:pixels*4,inflight,queued:queue.size}),
    dispose(){if(closed||closing)return;closing=true;for(const entry of [...lru.keys()])removeEntry(entry);closed=true;scopes.clear();lru.clear();queue.clear();},
  });
}
