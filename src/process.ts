import {spawnSync} from 'node:child_process';
export function commandSpec(command:string,args:string[],platform=process.platform){
 if(platform==='win32'&&process.platform==='win32'&&command==='dsh'){
  const found=spawnSync('where.exe',['dsh'],{encoding:'utf8',windowsHide:true,timeout:5000});
  const path=found.stdout?.trim().split(/\r?\n/)[0];if(found.status===0&&path)command=path;
 }
 if(platform==='win32' && /\.(cmd|bat)$/i.test(command)){
  if(/[\r\n"&|<>^%!]/.test(command)||args.some(a=>!/^[-a-zA-Z0-9_]+$/.test(a)))throw new Error('Unsafe DSH path or argument');
  // cmd.exe needs the outer quoting unchanged; Node's default argv escaping breaks .cmd paths.
  // Only fixed flags and validated identifiers reach this shell. Task text travels over stdin.
  return {command:'cmd.exe',args:['/d','/s','/c',`""${command}" ${args.join(' ')}"`],options:{windowsHide:true,windowsVerbatimArguments:true}};
 }
 return {command,args,options:{windowsHide:true}};
}
