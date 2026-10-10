import type {Page} from '@playwright/test';
import {test,expect,makeEvent,characterArt,expectNoUnexpectedErrors,selectedSeq,timelineRows,RUN_ID,CODEX_SESSION,DEEPSEEK_SESSION} from './fixture';

const PROMPT='CANARY_PROMPT_补齐空桌提示_7f3a';
const PRIVATE_PATH='canary-private-dir/notes/label.ts';
const DIFF='--- a/web/label.ts\n+++ b/web/label.ts\n@@ -1,2 +1,3 @@\n CANARY_DIFF_LINE_9b21\n';
const OUTPUT='CANARY_OUTPUT_4c8d';

type PreviewEvent={id:string;runId:string;sessionId:string;kind:string;seq:number;at:string;data:Record<string,unknown>};

/** `pre.share-preview` carries `aria-label="分享导出预览"`; the class keeps the locator engine-neutral. */
const preview=(page:Page)=>page.locator('pre.share-preview');
async function previewEvents(page:Page):Promise<PreviewEvent[]>{
 const text=await preview(page).evaluate(element=>element.textContent??'');
 return JSON.parse(text) as PreviewEvent[];
}

test('share preview excludes prompts, paths, diffs and outputs by default',async ({page,watcher,pageErrors})=>{
 await watcher.seed([
  makeEvent({id:'canary-41',actor:'codex',kind:'task.started',offsetSeconds:0,data:{prompt:PROMPT}}),
  makeEvent({id:'canary-42',actor:'deepseek',kind:'file.changed',offsetSeconds:1,data:{path:PRIVATE_PATH,change:'modified',beforeBlob:'blob-before',afterBlob:'blob-after',diff:DIFF,candidateActor:'deepseek',reason:'观测到写工具与前后快照'}}),
  makeEvent({id:'canary-43',actor:'deepseek',kind:'tool.completed',offsetSeconds:2,data:{tool:'bash',callId:'c9',exitCode:0,status:'completed',output:OUTPUT}}),
  makeEvent({id:'canary-44',actor:'codex',kind:'turn.completed',offsetSeconds:3,data:{}})
 ]);
 await page.goto(watcher.url);
 await expect(timelineRows(page)).toHaveCount(4);

 await page.getByRole('button',{name:'分享预览'}).click();
 const dialog=page.getByRole('dialog',{name:'分享与导出预览'});
 await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('默认只包含角色、通用事件类型与相对时间');

 const boxes=['任务提示文本','文件路径','代码差异','命令输出'];
 for(const label of boxes)await expect(page.getByRole('checkbox',{name:label})).not.toBeChecked();
 await expect(page.locator('.modal .warn')).toHaveCount(0);

 const shared=await previewEvents(page);
 expect(shared).toHaveLength(4);
 const defaultText=await preview(page).evaluate(element=>element.textContent??'');
 for(const marker of [PROMPT,PRIVATE_PATH,'CANARY_DIFF_LINE_9b21',OUTPUT,RUN_ID,CODEX_SESSION,DEEPSEEK_SESSION])
  expect(defaultText).not.toContain(marker);
 for(const event of shared)expect(Object.keys(event.data)).toEqual([]);

 const art=await characterArt(watcher.webDir);
 expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
});

test('each opt-in is exact and identifiers stay aliased',async ({page,watcher,pageErrors})=>{
 await watcher.seed([
  makeEvent({id:'canary-51',actor:'codex',kind:'task.started',offsetSeconds:0,data:{prompt:PROMPT}}),
  makeEvent({id:'canary-52',actor:'deepseek',kind:'file.changed',offsetSeconds:1,data:{path:PRIVATE_PATH,change:'modified',beforeBlob:'blob-before',afterBlob:'blob-after',diff:DIFF,candidateActor:'deepseek',reason:'观测到写工具与前后快照'}}),
  makeEvent({id:'canary-53',actor:'deepseek',kind:'tool.completed',offsetSeconds:2,data:{tool:'bash',callId:'c9',exitCode:0,status:'completed',output:OUTPUT}}),
  makeEvent({id:'canary-54',actor:'codex',kind:'turn.completed',offsetSeconds:3,data:{}})
 ]);
 await page.goto(watcher.url);
 await expect(timelineRows(page)).toHaveCount(4);
 await page.getByRole('button',{name:'分享预览'}).click();

 await page.getByRole('checkbox',{name:'任务提示文本'}).check();
 await expect(preview(page)).toContainText(PROMPT);
 await page.getByRole('checkbox',{name:'文件路径'}).check();
 await expect(preview(page)).toContainText(PRIVATE_PATH);
 await expect(page.locator('.modal .warn')).toBeVisible();
 await page.getByRole('checkbox',{name:'代码差异'}).check();
 await expect(preview(page)).toContainText('CANARY_DIFF_LINE_9b21');
 await page.getByRole('checkbox',{name:'命令输出'}).check();
 await expect(preview(page)).toContainText(OUTPUT);

 const shared=await previewEvents(page);
 const task=shared.find(event=>event.kind==='task.started');
 const changed=shared.find(event=>event.kind==='file.changed');
 const completed=shared.find(event=>event.kind==='tool.completed');
 expect(task?.data.prompt).toBe(PROMPT);
 expect(changed?.data.path).toBe(PRIVATE_PATH);
 expect(changed?.data.diff).toBe(DIFF);
 expect(completed?.data.output).toBe(OUTPUT);

 // Opting into content never opts into raw run/session identifiers or wall-clock time.
 const optedInText=await preview(page).evaluate(element=>element.textContent??'');
 for(const marker of [RUN_ID,CODEX_SESSION,DEEPSEEK_SESSION])expect(optedInText).not.toContain(marker);
 expect(shared[0]?.at).toBe('1970-01-01T00:00:00.000Z');
 expect(shared[0]?.runId).not.toBe(RUN_ID);

 // Escape closes the dialog without disturbing the recorded view.
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog',{name:'分享与导出预览'})).toHaveCount(0);
 await expect(timelineRows(page)).toHaveCount(4);
 await expect(selectedSeq(page)).toHaveText('#4');

 const art=await characterArt(watcher.webDir);
 expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
});
