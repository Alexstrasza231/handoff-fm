import {lstat,realpath,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {safeRelative} from './privacy';
import {transcriptExclusions,pathKey} from './transcript-privacy';
const excludedMention=/(?:^|[\s"'\\/=:])(?:\.env(?:[.\s"'\\/]|$)|auth\.json|credentials(?:\.|[\s"'\\/])|id_rsa\b|id_ed25519\b|node_modules[\\/]|\.git[\\/]|\.handoff-fm[\\/]|(?:dist|web-dist|build|coverage)[\\/])|\.(?:pem|key|p12|pfx|kubeconfig)\b/i;
/** Conservative content suppression for known file references; not a universal secret detector. */
export async function excludedEvidence(root:string,input:unknown,cwd=root):Promise<boolean>{
 const transcripts=await transcriptExclusions(root);if(transcripts.uncertain)return true;
 const tool=input&&typeof input==='object'?input as Record<string,unknown>:{};
 const base=resolve(cwd,typeof tool.workdir==='string'?tool.workdir:typeof tool.cwd==='string'?tool.cwd:'.');
 const paths:string[]=[];let excluded=false;
 function visit(v:unknown,depth=0){if(depth>8)return;
  if(typeof v==='string'){const text=v.replaceAll('\\','/');if(excludedMention.test(v)||v.includes('\0')||transcripts.mentions.some(path=>(process.platform==='win32'?text.toLowerCase():text).includes(path)))excluded=true;return;}
  if(v&&typeof v==='object')for(const [key,val] of Object.entries(v)){
   if(/^(file_path|path|filename|file)$/i.test(key)&&typeof val==='string')paths.push(val);
   if(key==='command'&&typeof val==='string')for(const m of val.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm))paths.push(m[1]);
   visit(val,depth+1);
  }
 }visit(input);if(excluded)return true;
 for(const path of paths){const target=resolve(base,path);if(transcripts.paths.has(pathKey(target))||!safeRelative(root,target)||/\.(png|jpe?g|gif|webp|pdf|zip|exe|dll|bin|mp[34]|webm)$/i.test(path))return true;
  try{const st=await lstat(target),canonical=await realpath(target);if(st.isSymbolicLink()||st.size>1024*1024||transcripts.paths.has(pathKey(canonical))||transcripts.identities.has(`${st.dev}:${st.ino}`)||!safeRelative(await realpath(root),canonical))return true;
   if(st.isFile()){const content=await readFile(target);if(content.includes(0)||content.toString('utf8').includes('\ufffd'))return true;}
  }catch{}
 }return false;
}
