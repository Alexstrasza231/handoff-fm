const secretKey=/^(authorization|proxy-authorization|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|cookie|set-cookie)$/i;
export function cleanText(s:string):string {
 return s.replace(/\b(?:Bearer\s+)[\w.\-+/=]+/gi,'Bearer [redacted]')
 .replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,'Basic [redacted]')
 .replace(/\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_\-]{8,}/g,'[redacted]')
 .replace(/(["']?\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|PASSWORD|SECRET)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;,}]+)/gi,'$1"[redacted]"')
 .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[redacted]@');
}
export function sanitize(v:unknown,depth=0):unknown {
 if(depth>12)return '[depth limit]';
 if(typeof v==='string')return cleanText(v.length>65536?v.slice(0,65536)+'\n[truncated]':v);
 if(Array.isArray(v))return v.slice(0,256).map(x=>sanitize(x,depth+1));
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).slice(0,128).map(([k,x])=>[k.slice(0,256),secretKey.test(k)?'[redacted]':sanitize(x,depth+1)]));
 return v;
}
