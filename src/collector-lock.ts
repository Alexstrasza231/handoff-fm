import * as filesystem from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

interface LockFilesystem {
 mkdir(path:string):Promise<unknown>;
 readdir(path:string):Promise<string[]>;
 lstat(path:string):Promise<Stats>;
 open(path:string,flags:string):Promise<FileHandle>;
 unlink(path:string):Promise<void>;
 rmdir(path:string):Promise<void>;
}
export interface CollectorLockOptions { fs?:LockFilesystem; }
const ownerName=/^owner-([1-9]\d*)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
const code=(error:unknown)=>(error as NodeJS.ErrnoException).code;
const contention=(error:unknown)=>['EEXIST','ENOENT','ENOTEMPTY','EPERM','EBUSY'].includes(code(error)||'');
function deadOwner(name:string):boolean {
 const match=ownerName.exec(name);if(!match)return false;
 const pid=Number(match[1]);if(!Number.isSafeInteger(pid)||pid>2147483647)return false;
 try{process.kill(pid,0);return false;}catch(error){return code(error)==='ESRCH';}
}

/** A PID's age is irrelevant: only an owner confirmed dead can be reclaimed. */
async function reclaim(path:string,fs:LockFilesystem):Promise<boolean>{
 const directory=await fs.lstat(path);if(!directory.isDirectory()||directory.isSymbolicLink())return false;
 const observed=await fs.readdir(path);
 if(!observed.length){
  if(Date.now()-directory.mtimeMs<10000)return false;
 }else{
  // Freeze exact nonce names before doing anything. A fresh owner's nonce can
  // never be removed using this snapshot, even if the directory gets replaced.
  for(const name of observed){
   if(!deadOwner(name))return false;
   const entry=await fs.lstat(join(path,name));if(!entry.isFile()||entry.isSymbolicLink())return false;
  }
  for(const name of observed){try{await fs.unlink(join(path,name));}catch(error){if(code(error)!=='ENOENT')throw error;}}
 }
 // Never recurse: if a new owner arrived, the nonempty directory protects it.
 await fs.rmdir(path);return true;
}

function releaseOwner(path:string,owner:string,fs:LockFilesystem):()=>Promise<void>{
 let markerRemoved=false;
 return async()=>{
  if(!markerRemoved){
   for(let attempt=0;attempt<3;attempt++){
    try{await fs.unlink(join(path,owner));markerRemoved=true;break;}
    catch(error){
     if(code(error)==='ENOENT'){markerRemoved=true;break;}
     if(!['EPERM','EBUSY'].includes(code(error)||''))throw error;
     if(attempt<2)await new Promise(done=>setTimeout(done,25));
    }
   }
  }
  if(!markerRemoved)throw Object.assign(new Error('Owner cleanup is busy; retry release'),{code:'EBUSY'});
  try{await fs.rmdir(path);}catch(error){if(!contention(error))throw error;}
 };
}

/**
 * Returns a release function only after proving sole nonce ownership. Callers
 * must always release in finally. Busy or transiently inaccessible locks return
 * null. The parent directory must already exist; at most three claims are tried.
 */
export async function acquireCollectorLock(path:string,options:CollectorLockOptions={}):Promise<(()=>Promise<void>)|null>{
 const fs=options.fs||filesystem,owner=`owner-${process.pid}-${randomUUID()}.json`;
 for(let attempt=0;attempt<3;attempt++){
  try{await fs.mkdir(path);}catch(error){
   if(code(error)!=='EEXIST'){if(contention(error))return null;throw error;}
   try{if(!await reclaim(path,fs))return null;}
   catch(recoveryError){if(!contention(recoveryError))throw recoveryError;}
   continue;
  }
  const release=releaseOwner(path,owner,fs);let published=false;
  try{
   const handle=await fs.open(join(path,owner),'wx');published=true;
   try{await handle.writeFile(JSON.stringify({pid:process.pid}));}finally{await handle.close();}
   const names=await fs.readdir(path);
   if(names.length===1&&names[0]===owner)return release;
   await release();return null;
  }catch(error){
   if(published)await release();
   if(!contention(error))throw error;
  }
 }
 return null;
}
