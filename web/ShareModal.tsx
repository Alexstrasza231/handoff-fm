import {useEffect,useMemo,useRef} from 'react';
import type {FMEvent,ShareOptions} from '../src/types';
import {shareEvents} from '../src/share';

export function ShareModal({events,options,onToggle,onClose,onConfirm,disabled,disabledReason,busy,error}:{
 events:FMEvent[];
 options:ShareOptions;
 onToggle:(key:keyof ShareOptions)=>void;
 onClose:()=>void;
 onConfirm:()=>void;
 disabled:boolean;
 disabledReason:string|null;
 busy:boolean;
 error:string|null;
}){
 const closeRef=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{closeRef.current?.focus();},[]);
 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
  window.addEventListener('keydown',onKey);
  return ()=>window.removeEventListener('keydown',onKey);
 },[onClose]);

 const preview=useMemo(()=>{
  try{return JSON.stringify(shareEvents(events,options),null,1);}catch{return '预览生成失败：导出函数不可用。';}
 },[events,options]);

 const risky=(options.diffs||options.outputs||options.paths)&&!disabled;

 return <div className="modal-backdrop" role="presentation">
  <div className="modal" role="dialog" aria-modal="true" aria-label="分享与导出预览" onKeyDown={event=>{if(event.key==='Escape')onClose();}}>
   <header className="modal-head">
    <h2>分享预览</h2>
    <button type="button" ref={closeRef} className="ghost" onClick={onClose}>关闭</button>
   </header>
   <p className="muted">
    默认只包含角色、通用事件类型与相对时间。以下复选框按需加入更细的内容，预览与下载内容完全一致。
   </p>
   <fieldset className="share-options">
    <legend>可选项</legend>
    {([['prompts','任务提示文本'],['paths','文件路径'],['diffs','代码差异'],['outputs','命令输出']] as [keyof ShareOptions,string][]).map(([key,label])=>
     <label key={key} className="check">
      <input type="checkbox" checked={options[key]} onChange={()=>onToggle(key)} disabled={disabled}/>
      <span>{label}</span>
     </label>)}
   </fieldset>
   {risky?<p className="warn">提示：路径、差异与输出可能包含私有路径、密钥或敏感片段，请人工确认后再导出。</p>:null}
   <h3>预览（纯文本）</h3>
   <pre className="share-preview" aria-label="分享导出预览">{preview}</pre>
   {error?<p className="error" role="alert">{error}</p>:null}
   <footer className="modal-foot">
    {disabled?<p className="muted">{disabledReason||'当前模式不可导出。'}</p>:
     <button type="button" onClick={onConfirm} disabled={busy}>{busy?'导出中…':'确认并下载 HTML'}</button>}
    <button type="button" className="ghost" onClick={onClose}>返回</button>
   </footer>
  </div>
 </div>;
}
