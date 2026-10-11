import { readdir,lstat,readFile,writeFile,realpath,unlink } from 'node:fs/promises';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { safeRelative,cleanText } from './privacy';
import { dir } from './store';
import {transcriptExclusions,pathKey} from './transcript-privacy';
export type Snapshot=Record<string,{hash:string;text:string}>;
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function snapshotWithStatus(root:string):Promise<{files:Snapshot;available:boolean}>{
 root=await realpath(root);
 const excluded=await transcriptExclusions(root);if(excluded.uncertain)return {files:{},available:false};
 const out:Snapshot={};let visited=0;
 async function scan(path:string){for(const name of await readdir(path)){if(++visited>5000)return;
  const file=join(path,name),rel=safeRelative(root,file);if(!rel)continue;
  const stat=await lstat(file);if(stat.isSymbolicLink())continue;
  const canonical=await realpath(file);if(!safeRelative(root,canonical))continue;
  if(excluded.paths.has(pathKey(file))||excluded.paths.has(pathKey(canonical))||excluded.identities.has(`${stat.dev}:${stat.ino}`))continue;
  if(stat.isDirectory()){await scan(file);continue;}
  if(!stat.isFile()||stat.size>1024*1024)continue;
  const bytes=await readFile(file);if(bytes.includes(0))continue;const text=bytes.toString('utf8');if(text.includes('\uFFFD'))continue;
  const content=cleanText(text);out[rel]={hash:hash(content),text:content};
 }}await scan(root);return {files:out,available:true};
}
export async function snapshot(root:string):Promise<Snapshot>{return (await snapshotWithStatus(root)).files;}
export async function blob(root:string,text:string):Promise<string>{const key=hash(text);try{await writeFile(join(dir(root),'objects',key+'.txt'),text,{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}return key;}
export function changes(before:Snapshot,after:Snapshot){return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]?.hash!==after[p]?.hash).map(path=>({path,before:before[path]?.text||'',after:after[path]?.text||'',beforeHash:before[path]?.hash,afterHash:after[path]?.hash,diff:createTwoFilesPatch(path,path,before[path]?.text||'',after[path]?.text||'')}));}
export async function regularInside(root:string,path:string):Promise<string|null>{
 const candidate=resolve(root,path);if(!safeRelative(root,candidate))return null;
 try{const canonical=await realpath(candidate);if(!safeRelative(root,canonical)||(await lstat(candidate)).isSymbolicLink())return null;return canonical;}catch{return null;}
}
