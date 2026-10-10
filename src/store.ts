import { mkdir,readFile,writeFile,rename,readdir,unlink,open,realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {acquireCollectorLock} from './collector-lock';
import { randomUUID } from 'node:crypto';
import type { FMEvent,ProjectConfig } from './types';
import { sanitize } from './privacy';
export const dir=(root:string)=>join(root,'.handoff-fm');
export const safeId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(id);
export async function initProject(root:string):Promise<ProjectConfig> {
 root=await realpath(root);await mkdir(dir(root),{recursive:true});
 for(const d of ['inbox','objects','pending','quarantine'])await mkdir(join(dir(root),d),{recursive:true});
 const config:ProjectConfig={version:1,root,boundSessions:[]};
 try {await writeFile(join(dir(root),'config.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
 try{await writeFile(join(dir(root),'CONNECT.md'),'# HandoffFM local recording\n\nThis project is enabled. Only new events in this project are observed.\n\n1. Install the GitHub Codex plugin (see docs/usage.md). Review and trust its exact hooks through /hooks. Installing does not trust hooks.\n2. Run handoff-fm doctor. Codex Hooks remain not yet verified until real records arrive.\n3. Run handoff-fm watch and open its local token URL.\n4. Use delegate deepseek with a task file and actual parent-session ID.\n\nRecords are local and ignored by Git. Do not commit or share this directory. Export defaults exclude task text, paths, diffs and outputs; review any opt-in content.\n',{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
 let ignored='';try{ignored=await readFile(join(root,'.gitignore'),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(!ignored.split(/\r?\n/).some(x=>x.trim()==='.handoff-fm/'))await writeFile(join(root,'.gitignore'),ignored+(ignored&&!ignored.endsWith('\n')?'\n':'')+'.handoff-fm/\n');
 return loadConfig(root);
}
export async function loadConfig(root:string):Promise<ProjectConfig>{const v=JSON.parse(await readFile(join(dir(root),'config.json'),'utf8'));if(v.version!==1||!Array.isArray(v.boundSessions))throw new Error('Unsupported project config');return v;}
const kinds=new Set(['session.started','task.started','delegate.started','tool.started','tool.completed','file.changed','agent.message','delegate.completed','delegate.failed','turn.completed','turn.interrupted','recording.gap']);
export function validEvent(e:FMEvent):boolean{return e?.version===1&&safeId(e.id)&&safeId(e.runId)&&typeof e.sessionId==='string'&&e.sessionId.length<200&&['codex','deepseek','unknown','system'].includes(e.actor)&&kinds.has(e.kind)&&['observed','declared','unknown'].includes(e.evidence)&&Number.isFinite(Date.parse(e.at))&&!!e.data&&typeof e.data==='object'&&!Array.isArray(e.data);}
export async function enqueue(root:string,event:FMEvent):Promise<void> {
 if(!validEvent(event))throw new Error('Invalid event');
 const e={...event,data:sanitize(event.data),model:event.model?String(sanitize(event.model)):undefined};delete e.seq;
 const name=Date.now().toString().padStart(13,'0')+'-'+randomUUID();const file=join(dir(root),'inbox',name+'.json');
 await writeFile(file+'.tmp',JSON.stringify(e),{flag:'wx'});await rename(file+'.tmp',file);
}
export async function allEvents(root:string):Promise<FMEvent[]> {
 let source='';try{source=await readFile(join(dir(root),'events.jsonl'),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 // Ignore an uncommitted trailing fragment; the collector repairs it under its lock.
 const lines=source.slice(0,source.lastIndexOf('\n')+1).split('\n').filter(Boolean);
 return lines.map(x=>JSON.parse(x)).filter(validEvent);
}
const queues=new Map<string,Promise<unknown>>();
const delayedReleases=new Map<string,()=>Promise<void>>();
export async function collect(root:string):Promise<FMEvent[]> {
 root=await realpath(root);
 const prior=queues.get(root)||Promise.resolve();const p=prior.catch(()=>{}).then(()=>collectLocked(root));queues.set(root,p);try{return await p;}finally{if(queues.get(root)===p)queues.delete(root);}
}
async function collectLocked(root:string):Promise<FMEvent[]> {
 const delayed=delayedReleases.get(root);if(delayed){try{await delayed();delayedReleases.delete(root);}catch{return [];}}
 // Never steal a live owner's directory by age. Recovery removes only a dead
 // owner's exact nonce marker, then an empty directory; a fresh owner survives.
 const release=await acquireCollectorLock(join(dir(root),'journal.lock'));if(!release)return [];
 try{
  const log=join(dir(root),'events.jsonl');let raw='';try{raw=await readFile(log,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  let damaged=false;if(raw&&!raw.endsWith('\n')){raw=raw.slice(0,raw.lastIndexOf('\n')+1);const repair=await open(log,'r+');try{await repair.truncate(Buffer.byteLength(raw));await repair.sync();}finally{await repair.close();}damaged=true;}
  const rows=await allEvents(root),seen=new Set(rows.map(x=>x.id));let seq=rows.at(-1)?.seq||0;const out:FMEvent[]=[];
  const files=(await readdir(join(dir(root),'inbox'))).filter(x=>x.endsWith('.json')).sort();
  const journal=await open(log,'a');
  try{
   for(const name of files){
    const file=join(dir(root),'inbox',name);let e:FMEvent;
    try{const value=await readFile(file,'utf8');if(value.length>1024*1024)throw new Error('oversized');e=JSON.parse(value);if(!validEvent(e))throw new Error('invalid');}
    catch{await rename(file,join(dir(root),'quarantine',name));damaged=true;continue;}
    if(!seen.has(e.id)){e={...e,data:sanitize(e.data) as Record<string,unknown>,seq:++seq};await journal.write(JSON.stringify(e)+'\n');await journal.sync();seen.add(e.id);out.push(e);}
    await unlink(file);
   }
   if(damaged){const e:FMEvent={version:1,id:randomUUID(),runId:rows.at(-1)?.runId||out.at(-1)?.runId||'system',sessionId:'collector',actor:'system',kind:'recording.gap',evidence:'unknown',at:new Date().toISOString(),seq:++seq,data:{message:'Incomplete or invalid records were excluded.'}};await journal.write(JSON.stringify(e)+'\n');await journal.sync();out.push(e);}
  }finally{await journal.close();}return out;
 }finally{try{await release();}catch(e){
  // A Windows directory handle can delay removal. Committed records are already
  // fsynced; retain the result and retry this exact ownership marker next time.
  if(!['EPERM','EBUSY','ENOENT','ERELEASED'].includes((e as NodeJS.ErrnoException).code||''))throw e;
  delayedReleases.set(root,release);
  process.stderr.write('HandoffFM: journal unlock delayed; committed records are safe.\n');
 }}
}
export async function readRun(root:string,run:string):Promise<FMEvent[]>{if(!safeId(run))throw new Error('Invalid run ID');return (await allEvents(root)).filter(x=>x.runId===run);}
