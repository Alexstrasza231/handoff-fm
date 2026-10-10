import { homedir } from 'node:os';
import { resolve,join,dirname,relative,isAbsolute,sep } from 'node:path';
import { readFile,writeFile,mkdir,rename,realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './store';
export const within=(root:string,path:string)=>{const r=relative(resolve(root),resolve(path));return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep));};
const registryPath=()=>join(process.env.HANDOFF_FM_HOME||join(homedir(),'.handoff-fm'),'projects.json');
export async function projects():Promise<string[]>{try{const v=JSON.parse(await readFile(registryPath(),'utf8'));return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}}
export async function register(root:string){root=await realpath(root);const roots=await projects();if(roots.includes(root))return;roots.push(root);const file=registryPath();await mkdir(dirname(file),{recursive:true});const temp=file+'.'+randomUUID();await writeFile(temp,JSON.stringify(roots));await rename(temp,file);}
export async function findProject(input:any):Promise<string|null>{
 for(const root of await projects()){
  try{const cfg=await loadConfig(root);const cwd=typeof input.cwd==='string'?input.cwd:'';
   const child=input.tool_input?.workdir||input.tool_input?.cwd;
   const scope=typeof child==='string'?child:cwd;
   if(scope&&within(root,scope))return root;
   // Binding is explicit during setup, useful when this desktop chat lives in a parent project.
   if(cfg.boundSessions.includes(input.session_id)&&!input.tool_name)return root;
   if(cfg.boundSessions.includes(input.session_id)&&input.tool_name==='apply_patch'&&String(input.tool_input?.command).includes(root.replace(/\\/g,'/')))return root;
  }catch{}
 }return null;
}
