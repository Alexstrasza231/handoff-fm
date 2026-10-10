import { relative,resolve,basename,isAbsolute,sep } from 'node:path';
import {sanitize} from './privacy-text';
export {sanitize,cleanText} from './privacy-text';
export function redact(value:unknown):string {return typeof value==='string'?String(sanitize(value)):JSON.stringify(sanitize(value));}
export function safeRelative(root:string,path:string):string|null {
 const rel=relative(resolve(root),resolve(root,path));
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))return null;
 const parts=rel.split(/[\\/]/);
 if(parts.some(x=>['.git','.work','.handoff-fm','node_modules','dist','web-dist','build','coverage','test-results','playwright-report'].includes(x)))return null;
 if(/^(?:\.env(?:\..*)?|credentials(?:\..*)?|auth\.json|id_rsa|id_ed25519)$/i.test(basename(rel))||/\.(?:pem|key|p12|pfx|kubeconfig)$/i.test(rel))return null;
 return parts.join('/');
}
