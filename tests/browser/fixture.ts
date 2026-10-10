import {test as base, expect, type Page} from '@playwright/test';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {allEvents, collect, enqueue, initProject} from '../../src/store';
import {startWatch, webDirectory} from '../../src/server';
import type {FMEvent} from '../../src/types';
import {POSES} from '../../web/helpers';

/**
 * Shared browser-test fixture.
 *
 * Every test gets its own temporary project (a real `initProject`, so the real `.handoff-fm`
 * layout) and its own `startWatch` server bound to loopback on an ephemeral port. Events are
 * only ever written through `enqueue` + `collect`, the same API the product uses, and the
 * project never leaves the OS temp directory.
 *
 * `HANDOFF_FM_HOME` is pointed inside the temp project so that nothing can read or write the
 * operator's real `~/.handoff-fm` registry during a test run.
 */

export {expect};

export const RUN_ID='run-canary-01';
export const CODEX_SESSION='session-codex-canary-01';
export const DEEPSEEK_SESSION='session-deepseek-canary-02';
export const PUSH_TEXT='CANARY_SSE_PUSH_5e17';

const BASE_MS=Date.UTC(2026,0,15,9,0,0);
/** Recorded timestamps are fixture-owned so replay offsets are exact and never wall-clock. */
const atOffset=(seconds:number):string=>new Date(BASE_MS+seconds*1000).toISOString();

export interface EventSeed{
 id:string;
 actor:FMEvent['actor'];
 kind:FMEvent['kind'];
 evidence?:FMEvent['evidence'];
 data?:Record<string,unknown>;
 at?:string;
 offsetSeconds?:number;
 sessionId?:string;
 runId?:string;
 model?:string;
}

export function makeEvent(seed:EventSeed):FMEvent{
 return {
  version:1,
  id:seed.id,
  runId:seed.runId??RUN_ID,
  actor:seed.actor,
  kind:seed.kind,
  at:seed.at??atOffset(seed.offsetSeconds??0),
  sessionId:seed.sessionId??(seed.actor==='deepseek'?DEEPSEEK_SESSION:CODEX_SESSION),
  evidence:seed.evidence??'observed',
  data:seed.data??{},
  ...(seed.model?{model:seed.model}:{})
 };
}

export interface Watcher{
 root:string;
 url:string;
 token:string;
 webDir:string;
 /** Enqueue through the real store API and wait until the collector journalled every event. */
 seed:(events:FMEvent[])=>Promise<void>;
}

const delay=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms));

/**
 * `enqueue` names inbox files by `Date.now()`, so two events written in the same millisecond
 * would be journalled in UUID order. Bumping the clock guarantees the sequence we assert on.
 */
let lastStamp=0;
async function waitForNextStamp():Promise<void>{
 for(;;){
  const now=Date.now();
  if(now>lastStamp){lastStamp=now;return;}
  await delay(1);
 }
}

/* ------------------------------------------------------------------ assets */

const CHARACTERS=['codex','deepseek'] as const;
/** The exact file names the viewer can ask for (`web/public/characters/README.md`). */
const canonicalArtNames=():string[]=>CHARACTERS.flatMap(character=>POSES.map(pose=>`${character}-${pose}.png`));

/** Which canonical character PNGs the current build actually ships. */
export async function characterArt(webDir:string):Promise<{present:string[];missing:string[]}>{
 const files=await readdir(join(webDir,'characters'));
 const onDisk=new Set(files.filter(file=>/^[a-z-]+\.png$/.test(file)));
 const present:string[]=[];const missing:string[]=[];
 for(const name of canonicalArtNames())(onDisk.has(name)?present:missing).push(name);
 return {present,missing};
}

/* ------------------------------------------------------------ error capture */

export interface ConsoleError{text:string;url:string;}
export interface PageErrors{
 uncaught:string[];
 console:ConsoleError[];
 badResponses:{url:string;status:number}[];
 failedRequests:{url:string;failure:string}[];
 httpRequests:string[];
}

/** Collect browser errors instead of letting them scroll past unnoticed. */
export function capturePageErrors(page:Page):PageErrors{
 const errors:PageErrors={uncaught:[],console:[],badResponses:[],failedRequests:[],httpRequests:[]};
 page.on('pageerror',error=>errors.uncaught.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.console.push({text:message.text(),url:message.location()?.url??''});});
 page.on('response',response=>{if(response.status()>=400)errors.badResponses.push({url:response.url(),status:response.status()});});
 page.on('requestfailed',request=>errors.failedRequests.push({url:request.url(),failure:request.failure()?.errorText??'unknown'}));
 page.on('request',request=>{if(/^https?:/i.test(request.url()))errors.httpRequests.push(request.url());});
 return errors;
}

const ART_PATH=/\/characters\/(?:codex|deepseek)-[a-z-]+\.png$/;
/**
 * Requests Chromium makes by itself, outside the application's URL space: the implicit favicon
 * probe and the DevTools well-known probe. They are never issued by the page.
 */
const BROWSER_PROBES=new Set(['/favicon.ico','/.well-known/appspecific/com.chrome.devtools.json']);
const isBrowserProbe=(url:string):boolean=>{
 try{return BROWSER_PROBES.has(new URL(url).pathname);}catch{return false;}
};
const artNameOf=(url:string):string|null=>{
 try{
  const path=new URL(url).pathname;
  return ART_PATH.test(path)?path.split('/').pop()??null:null;
 }catch{return null;}
};
const isMissingArtUrl=(url:string,missing:Set<string>):boolean=>{
 const name=artNameOf(url);
 return name!==null&&missing.has(name);
};

/** Console chatter that is only the documented "no art yet" fallback for a missing PNG. */
const isArtFallbackNoise=(entry:ConsoleError,missing:Set<string>):boolean=>{
 if(!/Failed to load resource|Refused to load|ERR_FILE_NOT_FOUND|ERR_BLOCKED_BY_CSP|ERR_ABORTED/i.test(entry.text))return false;
 const haystack=`${entry.text} ${entry.url}`;
 for(const name of missing)if(haystack.includes(name))return true;
 return false;
};

const SERIOUS_CONSOLE=/Uncaught|TypeError|ReferenceError|SyntaxError|SecurityError|Content Security Policy|Refused to|Cannot read|is not a function|Warning:/i;

/**
 * Assert the browser reported nothing unexpected.
 *
 * Missing character art is the only tolerated abnormal response: the viewer intentionally falls
 * back to a labelled "立绘待补" tile until the raster assets exist. Everything else — uncaught
 * exceptions, unexpected 4xx/5xx, failed requests, serious console errors — fails the test, and
 * the captured payload is included in the failure message.
 */
export function expectNoUnexpectedErrors(errors:PageErrors,options:{missingArt?:Iterable<string>}={}):void{
 const missing=new Set(options.missingArt??[]);
 expect(errors.uncaught,`uncaught page errors:\n${errors.uncaught.join('\n')}`).toEqual([]);
 const bad=errors.badResponses.filter(row=>!isBrowserProbe(row.url)&&!isMissingArtUrl(row.url,missing));
 expect(bad,`unexpected error responses:\n${JSON.stringify(bad,null,2)}`).toEqual([]);
 const failed=errors.failedRequests.filter(row=>!isMissingArtUrl(row.url,missing));
 expect(failed,`unexpected failed requests:\n${JSON.stringify(failed,null,2)}`).toEqual([]);
 const serious=errors.console.filter(entry=>SERIOUS_CONSOLE.test(entry.text)&&!isArtFallbackNoise(entry,missing));
 expect(serious,`unexpected console errors:\n${serious.map(entry=>`${entry.text} (${entry.url})`).join('\n')}`).toEqual([]);
}

/* ----------------------------------------------------------------- fixture */

export const test=base.extend<{watcher:Watcher;pageErrors:PageErrors}>({
 watcher:async ({},use,testInfo)=>{
  const root=await mkdtemp(join(tmpdir(),'handoff-fm-browser-'));
  const previousHome=process.env.HANDOFF_FM_HOME;
  process.env.HANDOFF_FM_HOME=join(root,'home');
  await initProject(root);
  const server=await startWatch(root,{port:0});
  let expected=0;
  const watcher:Watcher={
   root,
   url:`http://127.0.0.1:${server.port}/#token=${server.token}`,
   token:server.token,
   webDir:webDirectory,
   seed:async events=>{
    expected+=events.length;
    for(const event of events){await waitForNextStamp();await enqueue(root,event);}
    for(let attempt=0;attempt<80;attempt++){
     await collect(root);
     if((await allEvents(root)).length>=expected)return;
     await delay(25);
    }
    throw new Error(`seeded records did not reach ${expected} entries`);
   }
  };
  try{
   await use(watcher);
  }finally{
   await server.close();
   if(previousHome===undefined)delete process.env.HANDOFF_FM_HOME;else process.env.HANDOFF_FM_HOME=previousHome;
   try{
    await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
   }catch(error){
    // A held handle must not flip a passing test to failed; surface it in the report instead.
    await testInfo.attach('temp-project-cleanup-error.txt',{body:`${root}\n${String(error)}`,contentType:'text/plain'});
   }
  }
 },
 pageErrors:[async ({page},use,testInfo)=>{
  const errors=capturePageErrors(page);
  await use(errors);
  if(errors.uncaught.length||errors.console.length||errors.badResponses.length||errors.failedRequests.length)
   await testInfo.attach('browser-errors.json',{body:JSON.stringify(errors,null,2),contentType:'application/json'});
 },{auto:true}]
});

/* ---------------------------------------------------------------- helpers */

export const timelineRows=(page:Page)=>page.locator('.timeline-row');
export const selectedSeq=(page:Page)=>page.locator('.timeline-row.is-selected .t-seq');
export const selectedKind=(page:Page)=>page.locator('.timeline-row.is-selected .t-kind');
export const selectedTime=(page:Page)=>page.locator('.timeline-row.is-selected .t-time');
export const replayRange=(page:Page)=>page.getByLabel('回放时间位置');
export const speedSelect=(page:Page)=>page.getByLabel('回放速度');

export async function openMore(page:Page):Promise<void>{
 const button=page.getByRole('button',{name:'更多',exact:true});
 if(await button.getAttribute('aria-expanded')!=='true')await button.click();
}
export async function openHistory(page:Page):Promise<void>{
 if(await page.locator('.history-details').getAttribute('open')===null)await page.locator('.history-details > summary').click();
}
export async function openEvidence(page:Page):Promise<void>{
 if(await page.locator('.evidence-details').getAttribute('open')===null)await page.locator('.evidence-details > summary').click();
}
export async function openReplayControls(page:Page):Promise<void>{
 if(!await page.locator('.replay-bar').isVisible()){
  const handoff=page.getByRole('button',{name:'重播最近交接',exact:true});
  if(await handoff.isEnabled())await handoff.click();
  else{await openMore(page);await page.getByRole('button',{name:'回放全部记录',exact:true}).click();}
  const pause=page.getByRole('button',{name:'暂停',exact:true});
  if(await pause.isVisible())await pause.click();
 }
 if(await page.locator('.replay-advanced').getAttribute('open')===null)await page.locator('.replay-advanced > summary').click();
}

/** Enter the built-in sample replay from the empty live view. */
export async function enterDemo(page:Page,expectedEvents:number):Promise<void>{
 await openMore(page);
 await page.getByRole('button',{name:'试玩示例'}).click();
 await expect(timelineRows(page)).toHaveCount(expectedEvents);
}
