import {test,expect,makeEvent,PUSH_TEXT,CODEX_SESSION,DEEPSEEK_SESSION,characterArt,expectNoUnexpectedErrors,selectedSeq} from './fixture';

/**
 * The live view must be fed by the real loopback SSE endpoint: a record enqueued after the page
 * has loaded has to appear without a reload, and selecting it must show its raw evidence.
 */
test('a real SSE update appears without a reload and can be selected as evidence',async ({page,watcher,pageErrors})=>{
 await watcher.seed([
  makeEvent({id:'canary-01',actor:'codex',kind:'session.started',offsetSeconds:0,data:{source:'browser-fixture'}}),
  makeEvent({id:'canary-02',actor:'codex',kind:'task.started',offsetSeconds:1,data:{prompt:'整理空桌提示'}}),
  makeEvent({id:'canary-03',actor:'deepseek',kind:'tool.started',offsetSeconds:2,data:{tool:'read_file',callId:'c1',input:{path:'web/label.ts'}}})
 ]);

 await page.goto(watcher.url);
 await expect(page.locator('.timeline-row')).toHaveCount(3);
 await expect(page.locator('.status')).toHaveText('已连接');
 await expect(selectedSeq(page)).toHaveText('#3');

 // Prove the push arrives over the open stream rather than through a navigation or a reload.
 await page.evaluate(()=>{Reflect.set(window,'__handoffKept','kept');});

 await watcher.seed([
  makeEvent({id:'canary-04',actor:'deepseek',kind:'agent.message',evidence:'declared',offsetSeconds:3,data:{text:PUSH_TEXT}})
 ]);

 const pushed=page.locator('.timeline-row',{hasText:PUSH_TEXT});
 await expect(pushed).toHaveCount(1);
 await expect(page.locator('.timeline-row')).toHaveCount(4);
 await expect(pushed.locator('.t-seq')).toHaveText('#4');
 expect(await page.evaluate(()=>Reflect.get(window,'__handoffKept'))).toBe('kept');
 await expect(page.locator('.status')).toHaveText('已连接');

 // Evidence selection: the pushed record's own fields, including the declared evidence level.
 await pushed.locator('.timeline-button').click();
 await expect(selectedSeq(page)).toHaveText('#4');
 const evidence=page.locator('.evidence');
 await expect(evidence.locator('.evidence-meta')).toContainText('代理声明');
 await expect(evidence.locator('.evidence-meta')).toContainText('declared');
 await expect(evidence.locator('.evidence-meta')).toContainText(DEEPSEEK_SESSION);
 await expect(evidence.locator('pre.raw')).toContainText(PUSH_TEXT);

 // Selecting an older record swaps the evidence panel back.
 await page.locator('.timeline-row',{hasText:'整理空桌提示'}).locator('.timeline-button').click();
 await expect(evidence.locator('pre.raw')).toContainText('整理空桌提示');
 await expect(evidence.locator('pre.raw')).not.toContainText(PUSH_TEXT);

 const art=await characterArt(watcher.webDir);
 expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
});

test('the run list and the recorded sequence come from the service, not from the page',async ({page,watcher,pageErrors})=>{
 await watcher.seed([
  makeEvent({id:'canary-11',actor:'codex',kind:'task.started',offsetSeconds:0,data:{prompt:'第一条任务'}}),
  makeEvent({id:'canary-12',actor:'deepseek',kind:'tool.completed',offsetSeconds:1,data:{tool:'bash',callId:'c9',exitCode:0,status:'completed',output:'ok'}})
 ]);
 await page.goto(watcher.url);
 const picker=page.getByLabel('选择运行记录');
 await expect(picker.locator('option')).toHaveCount(1);
 await expect(picker.locator('option')).toContainText('第一条任务');
 await expect(page.locator('.task-line')).toContainText('第一条任务');
 await expect(page.locator('.timeline-row')).toHaveCount(2);
 await expect(page.locator('.timeline-row',{hasText:'#1'}).locator('.timeline-button')).toHaveAttribute('aria-label',/^任务开始，Codex/);
 await expect(page.locator('.desk-extra')).toContainText(CODEX_SESSION);
 await expect(page.locator('.desk-extra')).toContainText(DEEPSEEK_SESSION);
 const art=await characterArt(watcher.webDir);
 expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
});
