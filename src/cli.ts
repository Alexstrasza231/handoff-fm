#!/usr/bin/env node
import { readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { initProject,loadConfig,collect,allEvents,dir } from './store';
import { register,findProject } from './registry';
import { captureHook } from './hooks';
import { delegate } from './delegate';
import {commandSpec} from './process';
import {startWatch,webDirectory} from './server';
import {offlineHTML} from './export';
import {readRun} from './store';
import {DEFAULT_SHARE,type ShareOptions} from './types';
function args(v:string[]){const options:Record<string,string>={};const positional:string[]=[];for(let i=0;i<v.length;i++){if(v[i].startsWith('--'))options[v[i].slice(2)]=v[i+1]&&!v[i+1].startsWith('--')?v[++i]:'true';else positional.push(v[i]);}return {options,positional};}
async function stdin(){let s='';for await(const chunk of process.stdin){s+=chunk;if(s.length>1024*1024)throw new Error('Input too large');}return s;}
export async function run(argv=process.argv.slice(2)){
 const {options:o,positional:p}=args(argv),command=p[0]||'help',root=resolve(o.project||process.cwd());
 if(command==='hook'){
  try{const input=JSON.parse(await stdin());const project=await findProject(input);if(project)await captureHook(project,input);}
  catch{process.stderr.write('HandoffFM: recording gap; tool execution is unaffected.\n');}return 0;
 }
 if(command==='init'){
  const cfg=await initProject(root);if(o['dsh-command'])cfg.dshCommand=o['dsh-command'];
  const bound=o['bind-session'];if(bound&&!cfg.boundSessions.includes(bound))cfg.boundSessions.push(bound);
  await writeFile(join(dir(root),'config.json'),JSON.stringify(cfg,null,2)+'\n');await register(root);
  console.log(`Enabled ${root}\nNext: install the Codex plugin, review/trust its hooks, then run handoff-fm watch.\nOnly new recorded activity can be replayed.`);return 0;
 }
 if(command==='doctor'){
  const cfg=await loadConfig(root);const rows=await allEvents(root);const node=process.versions.node.split('.').map(Number);
  const nodeOK=node[0]>22||(node[0]===22&&node[1]>=12);
  const s=commandSpec(cfg.dshCommand||'dsh',['headless','--help']);const help=spawnSync(s.command,s.args,{...s.options,encoding:'utf8',timeout:10000});
  const jsonOK=help.status===0&&help.stdout.includes('--json');const received=rows.some(x=>x.actor==='codex'&&x.kind==='tool.started');
  console.log(JSON.stringify({node:nodeOK?'ok':'Node 22.12+ required',deepseekJSON:jsonOK?'ok':'not available',codexHooks:received?'observed':'not yet verified',project:root},null,2));return nodeOK&&jsonOK?0:1;
 }
 if(command==='collect'){await collect(root);console.log(JSON.stringify(await allEvents(root),null,2));return 0;}
 if(command==='watch'){
  await loadConfig(root);const port=Number(o.port||4417);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
  const server=await startWatch(root,{port});console.log(`HandoffFM watching enabled project\nhttp://127.0.0.1:${server.port}/#token=${server.token}\nKeep this process running. The URL grants access to local records; do not share it.`);
  const stop=()=>server.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);return 0;
 }
 if(command==='export'){
  if(!p[1]||!o.output)throw new Error('Use export RUN --output PATH [--prompts --paths --diffs --outputs] [--confirm]');await collect(root);
  const selection={...DEFAULT_SHARE};for(const key of Object.keys(selection) as (keyof ShareOptions)[])selection[key]=o[key]==='true';
  const events=await readRun(root,p[1]);if(!events.length)throw new Error('Run has no recorded events');
  const output=resolve(o.output),preview=o.confirm==='true'?output:output+'.preview.html';
  await writeFile(preview,await offlineHTML(webDirectory,events,selection),{flag:'wx'});
  console.log(`Offline ${o.confirm==='true'?'export':'preview'}: ${preview}\nIncluded: ${Object.entries(selection).filter(([,v])=>v).map(([k])=>k).join(', ')||'roles, generic event types and relative timing only'}.\nReview selected content for secrets. Automatic masking cannot find everything.${o.confirm==='true'?'':'\nAfter reviewing, repeat the same command with --confirm to export.'}`);return 0;
 }
 if(command==='delegate'){
  if(p[1]!=='deepseek'||!o['task-file']||!o['parent-session'])throw new Error('Use delegate deepseek --task-file PATH --title TITLE --parent-session ID [--parent-turn ID]');
  return delegate(root,{taskFile:resolve(root,o['task-file']),title:o.title||'Delegated task',parentSession:o['parent-session'],parentTurn:o['parent-turn'],sessionId:o['session-id']});
 }
 console.log('HandoffFM 0.1.0\ninit | doctor | watch | delegate deepseek | export\nUse --project PATH to select an enabled project.');return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)run().then(code=>{process.exitCode=code;}).catch(e=>{console.error(e.message);process.exitCode=1;});
