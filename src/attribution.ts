import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// This guard lives outside pending/: recovering that directory must not revive
// a pre-outage edit window as proof of an isolated writer.
const path=(root:string)=>join(root,'.handoff-fm','attribution-epoch');
export async function attributionEpoch(root:string):Promise<string|null>{
 try{const value=await readFile(path(root),'utf8');return /^[a-f0-9-]{36}$/.test(value)?value:null;}
 catch(e){return (e as NodeJS.ErrnoException).code==='ENOENT'?'initial':null;}
}
export async function rotateAttributionEpoch(root:string):Promise<boolean>{
 const value=randomUUID(),temporary=path(root)+'.'+value+'.tmp';
 try{await writeFile(temporary,value,{flag:'wx'});await rename(temporary,path(root));return true;}
 catch{return false;}finally{await unlink(temporary).catch(()=>{});}
}
