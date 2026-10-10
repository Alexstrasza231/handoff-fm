import {createServer,type ServerResponse} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collect,allEvents,readRun,safeId} from './store';
import {offlineHTML} from './export';
import {DEFAULT_SHARE,type ShareOptions} from './types';
export const webDirectory=resolve(fileURLToPath(new URL('../web-dist',import.meta.url)));
export async function startWatch(root:string,options:{port:number;webDir?:string}){
 const token=randomBytes(32).toString('hex');const streams=new Set<ServerResponse>();let ticking=false;
 const server=createServer(async(req,res)=>{try{
  const port=(server.address() as {port:number}).port,expected=`127.0.0.1:${port}`;
  const fail=(code:number,msg:string)=>{res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8'});res.end(msg);};
  if(req.headers.host!==expected)return fail(403,'Invalid Host');
  if(req.headers.origin&&req.headers.origin!==`http://${expected}`)return fail(403,'Invalid Origin');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return fail(405,'Read-only service');
  const url=new URL(req.url||'/',`http://${expected}`);
  if(url.pathname.startsWith('/api/')){
   const offered=String(req.headers.authorization||'').replace(/^Bearer /,'')||url.searchParams.get('token')||'';
   const a=Buffer.from(offered),b=Buffer.from(token);if(a.length!==b.length||!timingSafeEqual(a,b))return fail(401,'Access token required');
   const reply=(value:unknown)=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
   if(url.pathname==='/api/runs'){const rows=await allEvents(root);const runs=new Map();for(const e of rows)runs.set(e.runId,{id:e.runId,title:e.kind==='task.started'?e.data.prompt||'Recorded task':runs.get(e.runId)?.title||'Recorded collaboration',updated:e.at,count:(runs.get(e.runId)?.count||0)+1});return reply([...runs.values()].reverse());}
   if(url.pathname==='/api/events'){const run=url.searchParams.get('run');if(run&&!safeId(run))return fail(400,'Invalid run');return reply(run?await readRun(root,run):await allEvents(root));}
   if(url.pathname==='/api/export'){
    const run=url.searchParams.get('run');if(!run||!safeId(run))return fail(400,'Invalid run');const opts={...DEFAULT_SHARE};for(const k of Object.keys(opts) as (keyof ShareOptions)[])opts[k]=url.searchParams.get(k)==='true';
    const body=await offlineHTML(options.webDir||webDirectory,await readRun(root,run),opts);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="handoff-fm.html"'});return res.end(body);
   }
   if(url.pathname==='/api/stream'){
    let since=Number(req.headers['last-event-id']||url.searchParams.get('since')||0);if(!Number.isSafeInteger(since)||since<0)return fail(400,'Invalid sequence');
    res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});
    for(const e of await allEvents(root))if((e.seq||0)>since){res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);since=e.seq!;}
    res.write(': connected\n\n');(res as any).lastSeq=since;streams.add(res);res.on('close',()=>streams.delete(res));return;
   }return fail(404,'Unknown endpoint');
  }
  const web=await realpath(options.webDir||webDirectory);const target=await realpath(join(web,decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1))));const rel=relative(web,target);
  if(rel.startsWith('..')||isAbsolute(rel))return fail(403,'Invalid path');
  const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json; charset=utf-8'};
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.writeHead(200,{'Content-Type':types[extname(target)]||'application/octet-stream'});res.end(await readFile(target));
 }catch(e){res.writeHead((e as NodeJS.ErrnoException).code==='ENOENT'?404:500);res.end('Resource unavailable');}});
 await collect(root);
 await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(options.port,'127.0.0.1',()=>{server.removeListener('error',reject);done();});}).catch(e=>{if((e as NodeJS.ErrnoException).code==='EADDRINUSE')throw new Error(`Port ${options.port} is in use. Choose --port NUMBER.`);throw e;});
 const timer=setInterval(async()=>{if(ticking)return;ticking=true;try{await collect(root);const events=streams.size?await allEvents(root):[];for(const res of streams){for(const e of events)if((e.seq||0)>(res as any).lastSeq){if(res.writableLength>1024*1024){res.destroy();break;}res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);(res as any).lastSeq=e.seq;}res.write(': heartbeat\n\n');}}catch{for(const res of streams)res.destroy();streams.clear();}finally{ticking=false;}},300);
 return {port:(server.address() as {port:number}).port,token,close:async()=>{clearInterval(timer);for(const s of streams)s.end();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}};
}
