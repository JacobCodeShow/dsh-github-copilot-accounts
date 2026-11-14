import { test } from "node:test";
import assert from "node:assert/strict";
import { createAvatarImageCache } from "../src/avatar-image-cache.mjs";

// Synthetic browser pipeline: CSS/animation/native no-CORS images are retained;
// fetch/CORS reads/canvas/export are never needed. All sources below are fake.
function fixture(options={}){
  let at=0,nextTimer=0;const timers=new Map(),images=[],requests=[],cancellations=[];
  const schedule=(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,due:at+delay});return id;};
  const cancel=(id)=>timers.delete(id);
  class ImageNode{
    constructor(){this.id=images.length+1;this.style={};this.parentNode=null;this.naturalWidth=0;this.naturalHeight=0;this.frames=0;images.push(this);}
    set src(value){this.source=value;requests.push({image:this.id,source:value});}
    get src(){assert.fail("cache must never read/export an image source");}
    set crossOrigin(_value){assert.fail("cache must not change CORS mode");}
    removeAttribute(name){assert.equal(name,"src");cancellations.push(this.id);}
    load(width=50,height=50){this.naturalWidth=width;this.naturalHeight=height;this.onload?.();}
    fail(){this.onerror?.(Object.defineProperty({},"message",{get(){assert.fail("raw error must stay unread");}}));}
    tick(){this.frames++;}
  }
  class Container{
    constructor(){this.children=[];}
    appendChild(node){if(node.parentNode)node.parentNode.removeChild(node);this.children.push(node);node.parentNode=this;return node;}
    removeChild(node){const index=this.children.indexOf(node);assert.notEqual(index,-1);this.children.splice(index,1);node.parentNode=null;return node;}
  }
  const cache=createAvatarImageCache({createImage:()=>new ImageNode(),now:()=>at,schedule,cancel,
    ttlMs:100,hardTtlMs:300,retryMs:80,loadTimeoutMs:20,maxPixels:100_000,maxImagePixels:50_000,...options});
  const scope={};
  const acquire=(accountId="account-a",slot="row",source="https://fake.ghe.invalid/opaque-first",extra={})=>cache.acquire({scope,issuer:"fake.ghe.invalid",accountId,slot,source,...extra});
  const advance=(ms)=>{const target=at+ms;let steps=0;while(true){const next=[...timers].filter(([,timer])=>timer.due<=target).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];if(!next)break;if(++steps>1000)assert.fail("timer loop");at=next[1].due;timers.delete(next[0]);next[1].fn();}at=target;};
  return{cache,scope,acquire,images,requests,cancellations,timers,advance,jump:(ms)=>{at+=ms;},container:()=>new Container()};
}

test("warm native IMG nodes survive repeated menu unmount/open with rotated opaque URLs and no new loads",async()=>{
  const f=fixture(),first=[];
  for(const [id,slot]of [["a","header"],["a","row"],["b","row"],["github","row"]]){
    const lease=f.acquire(id,slot);first.push({id,slot,lease,container:f.container()});lease.attach(first.at(-1).container);
  }
  assert.equal(f.requests.length,4);f.images.forEach((image)=>image.load());
  const nodes=first.map((view)=>view.container.children[0]);nodes[0].tick();
  first.forEach((view)=>view.lease.release());assert.ok(first.every((view)=>view.container.children.length===0));
  for(let opening=0;opening<5;opening++){
    const views=first.map((view,index)=>{const lease=f.acquire(view.id,view.slot,`https://fake.ghe.invalid/opaque-rotation-${opening}`),container=f.container();lease.attach(container);assert.equal(container.children[0],nodes[index]);assert.equal(lease.snapshot().hasImage,true);return lease;});
    views.forEach((lease)=>lease.release());
  }
  assert.equal(f.requests.length,4);assert.equal(nodes[0].frames,1,"native resource/animation object preserved");
  assert.ok(f.images.every((image)=>image.referrerPolicy==="no-referrer"&&image.style.objectFit==="cover"));
  f.cache.dispose();assert.equal(f.timers.size,0);
});

test("native no-CORS image path needs no failed fetch/blob/canvas probe",async(t)=>{
  t.mock.method(globalThis,"fetch",()=>assert.fail("no fetch probe"));
  const f=fixture(),lease=f.acquire(),container=f.container();lease.attach(container);
  // Origin sends no CORS grant, but an ordinary IMG load remains displayable.
  f.images[0].corsAllowed=false;f.images[0].load();await lease.settled();
  assert.equal(container.children[0],f.images[0]);lease.release();
  const next=f.acquire(undefined,undefined,"https://fake.ghe.invalid/opaque-reissued");next.attach(container);
  assert.equal(container.children[0],f.images[0]);assert.equal(f.requests.length,1);
  f.cache.dispose();
});

test("soft TTL loads one candidate per slot and keeps the old visible node until successful swap",async()=>{
  const f=fixture(),lease=f.acquire(),container=f.container();lease.attach(container);f.images[0].load();
  const old=container.children[0],state=lease.snapshot();assert.ok(Object.isFrozen(state));assert.equal(lease.snapshot(),state);
  lease.updateSource("https://fake.ghe.invalid/opaque-new");f.advance(99);assert.equal(f.requests.length,1);
  f.advance(1);assert.equal(f.requests.length,2);assert.equal(container.children[0],old);assert.equal(lease.snapshot().refreshing,true);
  assert.equal(f.requests[1].source,"https://fake.ghe.invalid/opaque-new");
  f.images[1].load();await lease.settled();assert.equal(container.children[0],f.images[1]);assert.equal(old.parentNode,null);
  assert.equal(lease.snapshot().stale,false);assert.equal(f.cache.stats().retainedPixels,2500);f.cache.dispose();
});

test("stale-good failure signals recovery without blanking; cooldown avoids reopen probes and explicit retry is deduped",async()=>{
  const f=fixture(),lease=f.acquire(),container=f.container();lease.attach(container);f.images[0].load();const old=f.images[0];
  f.advance(100);f.images[1].fail();assert.equal(lease.snapshot().hasImage,true);assert.equal(lease.snapshot().reason,"load-failed");assert.equal(lease.snapshot().failureRevision,1);assert.equal(container.children[0],old);
  lease.release();f.advance(20);
  const reopened=f.acquire(),target=f.container();reopened.attach(target);assert.equal(f.requests.length,2);assert.equal(target.children[0],old);
  const retry=reopened.refresh("https://fake.ghe.invalid/opaque-recovery"),same=reopened.refresh("https://fake.ghe.invalid/opaque-recovery");assert.equal(retry,same);assert.equal(f.requests.length,3);
  f.images[2].load();assert.equal(await retry,true);assert.equal(target.children[0],f.images[2]);f.cache.dispose();
});

test("an obsolete candidate URL failure cannot spend the newer source's profile-recovery budget",async()=>{
  const f=fixture(),lease=f.acquire(),container=f.container();lease.attach(container);f.images[0].load();
  f.advance(100);lease.updateSource("https://fake.ghe.invalid/new-profile-source");
  f.images[1].fail();assert.equal(lease.snapshot().failureRevision,0);assert.equal(f.requests.length,3);
  assert.equal(f.requests[2].source,"https://fake.ghe.invalid/new-profile-source");
  f.images[2].load();assert.equal(await lease.settled(),true);assert.equal(container.children[0],f.images[2]);f.cache.dispose();
});

test("hard stale TTL removes the old visible resource even if refresh keeps failing",()=>{
  const f=fixture(),lease=f.acquire(),container=f.container();lease.attach(container);f.images[0].load();
  f.advance(100);f.images[1].fail();f.advance(200);
  assert.equal(lease.snapshot().hasImage,false);assert.equal(container.children.length,0);assert.equal(f.cache.stats().retainedPixels,0);f.cache.dispose();
});

test("hard expiry is synchronous on reopen even when all browser timers were throttled",()=>{
  const f=fixture(),first=f.acquire(),old=f.container();first.attach(old);f.images[0].load();first.release();
  f.jump(301);
  const lease=f.acquire(),container=f.container();lease.attach(container);
  assert.equal(lease.snapshot().hasImage,false);assert.equal(container.children.length,0);assert.equal(f.requests.length,2);
  f.cache.dispose();
});

test("release/remount shares the same pending slot and never starts TTL downloads while no lease is active",async()=>{
  const f=fixture(),first=f.acquire(),a=f.container();const detach=first.attach(a),pending=first.settled();first.release();
  const second=f.acquire(),b=f.container();second.attach(b);assert.equal(second.settled(),pending);assert.equal(f.requests.length,1);
  f.images[0].load();assert.equal(await pending,true);assert.equal(a.children.length,0);assert.equal(b.children[0],f.images[0]);detach();assert.equal(b.children[0],f.images[0]);
  second.release();f.advance(100);assert.equal(f.requests.length,1,"no soft-TTL network while closed");f.cache.dispose();
});

test("bounded slot and entry capacity never steals active nodes; inactive LRU eviction is safe",()=>{
  const f=fixture({maxEntries:2}),a=f.acquire("a"),b=f.acquire("b"),ca=f.container(),cb=f.container();a.attach(ca);b.attach(cb);f.images.forEach((image)=>image.load());b.release();
  const c=f.acquire("c"),cc=f.container();c.attach(cc);f.images.at(-1).load();
  assert.equal(a.snapshot().hasImage,true);assert.equal(b.snapshot().status,"invalid");assert.equal(f.cache.stats().entries,2);
  const blocked=f.acquire("d");assert.equal(blocked.snapshot().reason,"capacity");assert.equal(f.requests.length,3);
  const duplicate=f.acquire("a");assert.equal(duplicate.snapshot().reason,"slot-in-use");
  const header=f.acquire("a","header");f.images.at(-1).load();const third=f.acquire("a","third");assert.equal(third.snapshot().reason,"capacity");
  assert.equal(ca.children[0],f.images[0]);header.release();f.cache.dispose();
});

test("retained pixel budget evicts only inactive resources and rejects oversized or over-budget candidates",()=>{
  const f=fixture({maxPixels:5000,maxImagePixels:5000}),a=f.acquire("a"),b=f.acquire("b");f.images[0].load();f.images[1].load();b.release();
  const c=f.acquire("c");f.images[2].load();assert.ok(f.cache.stats().retainedPixels<=5000);assert.equal(a.snapshot().hasImage,true);assert.equal(c.snapshot().hasImage,true);
  const d=f.acquire("d");f.images[3].load(100,50);assert.equal(d.snapshot().reason,"capacity");assert.equal(a.snapshot().hasImage,true);
  d.release();const huge=f.acquire("huge");f.images.at(-1).load(100,100);assert.equal(huge.snapshot().reason,"oversized");assert.ok(f.cache.stats().estimatedRgbaBytes<=20_000);f.cache.dispose();
});

test("Host/issuer/account identity isolation, scope disposal and late callbacks cannot reattach old faces",async()=>{
  const f=fixture(),a=f.acquire("same"),ca=f.container();a.attach(ca);f.images[0].load();
  const otherScope={},b=f.acquire("same","row","https://fake.ghe.invalid/other",{scope:otherScope}),cb=f.container();b.attach(cb);f.images[1].load();
  const pending=a.refresh("https://fake.ghe.invalid/old-background"),late=f.images[2].onload;
  f.cache.disposeScope(f.scope);assert.equal(ca.children.length,0);assert.equal(cb.children[0],f.images[1]);
  f.images[2].naturalWidth=f.images[2].naturalHeight=50;late();assert.equal(await pending,false);assert.equal(ca.children.length,0);
  const retired=f.acquire("same");assert.equal(retired.snapshot().reason,"invalid");assert.equal(f.requests.length,3);
  const issuer=f.acquire("same","row","https://different.invalid/opaque",{scope:otherScope,issuer:"different.invalid"});f.images.at(-1).load();
  f.cache.invalidateAccount(otherScope,"fake.ghe.invalid","same");assert.equal(cb.children.length,0);assert.equal(issuer.snapshot().hasImage,true);
  assert.throws(()=>f.acquire("same","row","opaque",{scope:null}),/unavailable/);f.cache.dispose();assert.equal(f.timers.size,0);
});

test("owned-container rebinding never removes unrelated children or lets old cleanup detach the new face",()=>{
  const f=fixture(),a=f.acquire("a"),b=f.acquire("b"),container=f.container();const sentinel={parentNode:null};container.appendChild(sentinel);
  const oldDetach=a.attach(container);f.images[0].load();b.attach(container);f.images[1].load();
  oldDetach();a.release();assert.deepEqual(container.children,[sentinel,f.images[1]]);
  f.cache.disposeScope(f.scope);assert.deepEqual(container.children,[sentinel]);f.cache.dispose();
});

test("pending requests are bounded and queued inactive views are cancelled without a request",async()=>{
  const f=fixture({maxPending:1}),a=f.acquire("a"),b=f.acquire("b"),c=f.acquire("c");
  assert.equal(f.requests.length,1);assert.equal(f.cache.stats().inflight,1);assert.equal(f.cache.stats().queued,2);
  const cancelled=b.settled();b.release();assert.equal(await cancelled,false);
  c.updateSource("https://fake.ghe.invalid/newest-queued");f.images[0].load();assert.equal(f.requests.length,2);assert.equal(f.requests[1].source,"https://fake.ghe.invalid/newest-queued");
  assert.equal(f.cache.stats().inflight,1);assert.equal(f.cache.stats().queued,0);a.release();f.cache.dispose();assert.equal(f.timers.size,0);assert.equal(f.cache.stats().inflight,0);
});

test("timeouts and disposal settle waiters without retries, leaks or source-bearing diagnostics",async()=>{
  const f=fixture(),lease=f.acquire(),pending=lease.settled();f.advance(20);assert.equal(await pending,false);assert.equal(lease.snapshot().reason,"load-failed");
  const retry=lease.refresh();f.cache.dispose();assert.equal(await retry,false);assert.equal(lease.snapshot().status,"invalid");assert.equal(f.timers.size,0);
  assert.throws(()=>f.acquire(),/unavailable/);assert.equal(f.requests.length,2);
});
