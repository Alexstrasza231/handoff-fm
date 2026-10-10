import type {FMEvent} from '../src/types';

/**
 * 试玩示例：完全静态的 FMEvent 列表，只用于演示界面。
 * 不发起任何网络请求、不调用任何模型；因为可能出现归属未知的文本，这里也故意保留了一条
 * 恶意/畸形输出样本，用于验证转义与文本渲染。
 */
const RUN='demo-run';
const CODEX='demo-codex-01';
const DEEPSEEK='demo-deepseek-01';
const TASK='task-demo';
const T0=Date.UTC(2026,0,1,9,0,0);

let index=0;
function at(offsetSeconds:number):string{return new Date(T0+offsetSeconds*1000).toISOString();}

function event(partial:{
 actor:FMEvent['actor'];
 kind:FMEvent['kind'];
 offset:number;
 sessionId:string;
 data:Record<string,unknown>;
 evidence?:FMEvent['evidence'];
 model?:string;
 taskId?:string;
}):FMEvent{
 const {offset,...rest}=partial;
 return {
  version:1,id:`demo-${++index}`,runId:RUN,at:at(offset),evidence:'observed',taskId:TASK,seq:index,
  ...rest
 } as FMEvent;
}
const codex=(kind:FMEvent['kind'],offset:number,data:Record<string,unknown>,evidence:FMEvent['evidence']='observed')=>
 event({actor:'codex',kind,offset,sessionId:CODEX,model:'codex-desktop',data,evidence});
const ds=(kind:FMEvent['kind'],offset:number,data:Record<string,unknown>,evidence:FMEvent['evidence']='observed')=>
 event({actor:'deepseek',kind,offset,sessionId:DEEPSEEK,model:'deepseek-chat',data,evidence});
const sys=(kind:FMEvent['kind'],offset:number,data:Record<string,unknown>)=>
 event({actor:'system',kind,offset,sessionId:'collector',data,evidence:'unknown'});

const BEFORE='export function label(count: number) {\n  return `cards: ${count}`;\n}\n';
const AFTER='export function label(count: number) {\n  if (count === 0) return "empty desk";\n  return `cards: ${count}`;\n}\n';
const DIFF=`--- a/web/label.ts\n+++ b/web/label.ts\n@@ -1,3 +1,4 @@\n export function label(count: number) {\n+  if (count === 0) return "empty desk";\n   return \`cards: \${count}\`;\n }\n`;

export function demoEvents():FMEvent[]{
 index=0;
 return [
  codex('session.started',0,{source:'desktop-hook'}),
  codex('task.started',1,{prompt:'把 web/label.ts 的空桌提示补上，保持现有风格。'}),
  codex('tool.started',3,{tool:'Read',callId:'demo-c1',input:{path:'web/label.ts'}}),
  codex('tool.completed',5,{tool:'Read',callId:'demo-c1',status:'completed',output:'已读取 3 行'}),
  codex('agent.message',7,{text:'文件已确认，交给 DeepSeek 改这一处。'},'declared'),
  codex('delegate.started',9,{title:'补空桌提示',prompt:'在 label() 中为空数量补一条可读提示。',parentSession:CODEX}),
  ds('session.started',10,{sessionId:DEEPSEEK}),
  ds('tool.started',12,{tool:'read_file',callId:'demo-d1',input:{path:'web/label.ts'}}),
  ds('tool.completed',13,{tool:'read_file',callId:'demo-d1',status:'completed',output:'已读取 3 行'}),
  ds('tool.started',15,{tool:'write_file',callId:'demo-d2',input:{path:'web/label.ts',content:AFTER}}),
  ds('file.changed',17,{path:'web/label.ts',change:'modified',beforeBlob:'blob-before',afterBlob:'blob-after',diff:DIFF,callId:'demo-d2',candidateActor:'deepseek',reason:'观测到写工具与前后快照'}),
  ds('tool.completed',18,{tool:'write_file',callId:'demo-d2',status:'completed',output:'写入完成'}),
  ds('tool.started',20,{tool:'bash',callId:'demo-d3',input:{command:'npx tsc --noEmit'}}),
  ds('tool.completed',23,{tool:'bash',callId:'demo-d3',exitCode:0,status:'completed',output:'没有类型错误'}),
  ds('agent.message',24,{text:'已补齐空桌提示，类型检查通过。'},'declared'),
  ds('delegate.completed',25,{exitCode:0,reason:'completed'}),
  codex('tool.started',27,{tool:'Bash',callId:'demo-c2',input:{command:'npx tsc --noEmit && npx vite build'}}),
  codex('tool.completed',33,{tool:'Bash',callId:'demo-c2',exitCode:0,status:'completed',output:'构建完成'}),
  sys('recording.gap',35,{message:'采集间隔超过阈值，这段时间没有记录'}),
  codex('tool.started',37,{tool:'Bash',callId:'demo-c3',input:{command:'node scripts/refresh.mjs'}}),
  sys('file.changed',39,{path:'web/cache.json',change:'modified',beforeBlob:'blob-before',afterBlob:'blob-after',diff:'二进制或生成文件差异已省略',candidateActor:'codex',reason:'间接写入或操作重叠，作者归属未知'}),
  codex('tool.completed',40,{tool:'Bash',callId:'demo-c3',exitCode:1,status:'failed',output:'malformed </script><img src=x onerror="alert(1)"> sample kept as plain text'}),
  codex('agent.message',42,{text:'刷新脚本以退出码 1 结束；该命令未见成功状态，未推测其他结论。'},'declared'),
  codex('turn.interrupted',44,{}),
  ds('delegate.failed',46,{exitCode:1,reason:'interrupted',message:'示例：代理在检查阶段被中断'}),
  codex('turn.completed',48,{})
 ];
}
