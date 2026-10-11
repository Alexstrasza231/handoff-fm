import {readFile,readdir,realpath} from 'node:fs/promises';
import {join,isAbsolute,resolve,relative} from 'node:path';
import {dir} from './store';
export const pathKey=(path:string)=>{const p=resolve(path).replaceAll('\\','/');return process.platform==='win32'?p.toLowerCase():p;};
/** Registry metadata only: never reads the registered log itself. Fail closed if a registry is malformed. */
export async function transcriptExclusions(root:string):Promise<{paths:Set<string>;identities:Set<string>;mentions:string[];uncertain:boolean}>{
 const paths=new Set<string>(),identities=new Set<string>(),mentions:string[]=[];let uncertain=false;
 for(const directory of ['usage-sources','usage-paths']){
 let names:string[];const folder=join(dir(root),directory);
 try{names=(await readdir(folder)).filter(n=>n.endsWith('.json')&&!n.endsWith('.cursor.json'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')uncertain=true;continue;}
 for(const name of names)try{
  const v=JSON.parse(await readFile(join(folder,name),'utf8'));if(typeof v.path!=='string'||!isAbsolute(v.path)){uncertain=true;continue;}
  const key=pathKey(v.path);paths.add(key);mentions.push(key);
  if(typeof v.identity==='string')identities.add(v.identity);
  const rel=relative(root,v.path).replaceAll('\\','/');if(rel&&!rel.startsWith('..'))mentions.push(process.platform==='win32'?rel.toLowerCase():rel);
  try{paths.add(pathKey(await realpath(v.path)));}catch{}
 }catch{uncertain=true;}}
 return {paths,identities,mentions,uncertain};
}
