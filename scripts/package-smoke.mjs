import {mkdtemp,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
// Exercise the actual packed files, with no development dependencies available.
const packagePath=resolve(process.argv[2]||'handoff-fm-0.1.0.tgz');
const temp=await mkdtemp(join(tmpdir(),'hfm-install-'));
function run(command,args,options={}){const result=spawnSync(command,args,{encoding:'utf8',windowsHide:true,...options});assert.equal(result.status,0,result.stderr||result.stdout);return result.stdout;}
try{
 const args=['install','--prefix',temp,'--omit=dev','--ignore-scripts','--no-audit','--no-fund',packagePath];
 if(process.platform==='win32')run(process.execPath,[join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'),...args]);
 else run('npm',args);
 const installed=join(temp,'node_modules','handoff-fm'),cli=join(installed,'dist','cli.js');
 const metadata=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));assert.equal(metadata.version,'0.1.0');
 const project=join(temp,'project');await mkdir(project);const env={...process.env,HANDOFF_FM_HOME:join(temp,'registry')};
 const output=run(process.execPath,[cli,'init','--project',project],{env});assert.match(output,/Enabled/);
 run(process.execPath,[cli,'init','--project',project],{env});
 assert.equal(JSON.parse(await readFile(join(project,'.handoff-fm','config.json'),'utf8')).version,1);
 assert.match(await readFile(join(installed,'web-dist','index.html'),'utf8'),/assets\/index.js/);
 assert.match(await readFile(join(installed,'hooks','hooks.json'),'utf8'),/PLUGIN_ROOT/);
 await readFile(join(installed,'.codex-plugin','plugin.json'));await readFile(join(installed,'LICENSE-ASSETS'));
 console.log('Packed CLI, repeat init, viewer, hook manifest and asset license verified.');
}finally{await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
