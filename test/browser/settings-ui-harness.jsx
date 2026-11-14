// Compact settings proof: real production components, two fake accounts only.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CopilotSection, DICTS } from 'test:client';

let language='en';
const t=key=>DICTS[language][key]??key;
const assertions=[],requests=[];
let unexpected=0;
const avatar='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="#4c6ef5"/></svg>');
const observedAt=new Date();
const resetDate=new Date(Date.UTC(observedAt.getUTCFullYear(),observedAt.getUTCMonth()+1,1)).toISOString().slice(0,10);
const accounts=[
{id:'copilot-auth/account-settings-a',domain:'settings-a.ghe.com',login:'alice',name:'Alice',avatarUrl:avatar,active:true,plan:'Copilot Enterprise',usage:{percentUsed:23.6,entitlement:100,remaining:76.4,resets:resetDate}},
{id:'copilot-auth/account-settings-b',domain:'settings-b.ghe.com',login:'alice',name:'Alice B',avatarUrl:avatar,active:false,plan:'Copilot Business',usage:{percentUsed:78.2,entitlement:100,remaining:21.8,resets:resetDate}},
];
window.fetch=async(input,options={})=>{
  requests.push({path:typeof input==='string'?input:'unsupported',method:options.method??'GET'});
  if(input==='/copilot-auth/models'&&options.method==='POST')return{ok:true,json:async()=>({ok:true})};
  if(options.method!==undefined && options.method!=='GET'){unexpected++;throw new Error('Mutation forbidden in settings fixture');}
  if(input==='/copilot-auth/accounts')return{ok:true,json:async()=>structuredClone({accounts,signingIn:false})};
  if(input==='/copilot-auth/state')return{ok:true,json:async()=>({status:'idle',notices:[]})};
  unexpected++;throw new Error('Unknown synthetic settings endpoint');
};
window.WebSocket=class{constructor(){unexpected++;throw new Error('Network forbidden');}};
const assert=(value,name)=>{if(!value)throw new Error(name);assertions.push(name);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const settle=async()=>{await tick();flushSync(()=>{});await tick();};
function waitFor(check,name){return new Promise((resolve,reject)=>{
  let done=false;const finish=error=>{if(done)return;done=true;observer.disconnect();clearTimeout(timer);error?reject(error):resolve();};
  const verify=()=>{try{if(check())finish();}catch{}};
  const observer=new MutationObserver(verify);observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  const timer=setTimeout(()=>finish(new Error(name)),2500);verify();
});}
let root;
const mount=()=>{root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<CopilotSection t={t}/>));};
const unmount=()=>flushSync(()=>root.unmount());
const exact=(tag,value)=>[...document.getElementById('root').querySelectorAll(tag)].filter(element=>element.textContent.trim()===value);
async function verifyLocale(locale){
  language=locale;mount();
  await waitFor(()=>exact('span','Copilot Enterprise').length===1 && exact('span','Copilot Business').length===1,'two settings cards did not render');await settle();
  const planLabels=exact('span',t('plan'));
  assert(planLabels.length===2,locale+': each card has one Plan label');
  const usageBlocks=[];
  for(const [index,brand] of ['Copilot Enterprise','Copilot Business'].entries()){
    const value=exact('span',brand)[0],row=value.parentElement,label=[...row.children].find(element=>element.textContent===t('plan'));
    assert(label && row.style.display==='flex' && row.style.alignItems==='baseline',locale+': Plan and '+brand+' share one inline baseline row');
    assert(Math.abs(label.getBoundingClientRect().top-value.getBoundingClientRect().top)<5,locale+': Plan/value actually occupy the same visual row');
    const usage=row.parentElement;usageBlocks.push(usage);
    const creditTitle=t('creditsWithReset').replace('{date}',resetDate);
    const titles=[...usage.querySelectorAll('span')].filter(element=>element.textContent===creditTitle);
    assert(titles.length===1 && creditTitle.includes(resetDate),locale+': monthly/reset date is part of the one credit title');
    assert((titles[0].parentElement.textContent.match(new RegExp(resetDate,'g'))??[]).length===1,locale+': no separate duplicate reset-date line');
    const percent=accounts[index].usage.percentUsed;
    assert([...usage.querySelectorAll('span')].some(element=>element.textContent===Math.round(percent)+'%'),locale+': rounded percent label is unchanged');
    assert([...usage.querySelectorAll('div')].some(element=>element.style.width===percent+'%' && element.style.height==='100%'),locale+': exact progress fill is unchanged');
  }
  const tracks=[...document.querySelectorAll('[data-usage-track]')];
  assert(tracks.length===2 && tracks.every(track=>track.querySelector('[data-usage-marker]')),locale+': each account keeps its own current-usage marker');
  const rowCursors=tracks.map(track=>track.querySelector('[data-month-marker]'));
  assert(rowCursors.every(Boolean),locale+': every account bar repeats the shared UTC month cursor');
  assert(new Set(rowCursors.map(cursor=>cursor.style.left)).size===1,locale+': today cursor is vertically aligned at one x position across accounts');
  const summaries=[...document.querySelectorAll('[data-usage-month]')];
  assert(summaries.length===1 && summaries[0].querySelector('[data-usage-legend]')&&summaries[0].querySelector('[data-month-marker]'),locale+': UTC month legend and summary cursor are shown once');
  assert(document.querySelectorAll('[data-usage-trend]').length===0,locale+': unstable history trend and prediction are absent');
  const notes=exact('p',t('creditsNote'));
  assert(notes.length===1,locale+': credits consumption note appears exactly once for two cards');
  assert(usageBlocks.every(block=>!block.parentElement.contains(notes[0])),locale+': note is outside every account card');
  assert(Boolean(usageBlocks.at(-1).parentElement.compareDocumentPosition(notes[0])&Node.DOCUMENT_POSITION_FOLLOWING),locale+': note is below the whole account list');
  assert([...document.querySelectorAll('img')].every(image=>image.src.startsWith('data:image/svg+xml,')),locale+': avatars are synthetic data SVG only');
  if(locale==='en'){
    const menuButton=[...document.querySelectorAll(`button[aria-label="${t('menu')}"]`)][0];assert(menuButton,'en: account menu control exists');menuButton.click();await settle();
    const refresh=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===t('refreshModels'));
    assert(refresh,'en: account menu exposes explicit refresh models action');refresh.click();
    await waitFor(()=>requests.some(request=>request.path==='/copilot-auth/models'&&request.method==='POST'),'model refresh POST did not occur');await settle();
    const modelRequest=requests.find(request=>request.path==='/copilot-auth/models');
    assert(modelRequest&&requests.filter(request=>request.path==='/copilot-auth/models').length===1,'en: refresh sends exactly one owned model request');
  }
}
async function run(){
  await verifyLocale('en');unmount();
  await verifyLocale('zh');
  assert(document.body.innerText.includes('AI 额度（按月重置，下次重置日期 '+resetDate+'）'),'Chinese reset title preserves the current reset date');
  assert(unexpected===0 && requests.every(request=>(request.method==='GET' && ['/copilot-auth/accounts','/copilot-auth/state'].includes(request.path))||(request.method==='POST'&&request.path==='/copilot-auth/models')),'only mocked accounts/state reads and one owned model refresh occurred');
  return{passed:true,assertions,counts:{mockRest:requests.length,unexpected},requests,scope:{actualComponent:'CopilotSection+UsageBlock',installedReactDOM:true,syntheticREST:true,settingsCompactProof:true,locales:['en','zh'],actualHostModal:false}};
}
run().then(result=>{document.getElementById('result').textContent=JSON.stringify(result);document.documentElement.dataset.test='passed';window.__result=result;window.__HARNESS_REPORT__(result);}).catch(error=>{const result={passed:false,failedAssertion:error.message,assertions,requests,unexpected};document.getElementById('result').textContent=JSON.stringify(result);document.documentElement.dataset.test='failed';window.__result=result;window.__HARNESS_REPORT__(result);});
