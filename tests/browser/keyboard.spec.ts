import {openReplayControls,test,expect,makeEvent,characterArt,expectNoUnexpectedErrors,replayRange,selectedSeq,timelineRows} from './fixture';

const KEY_ONE='CANARY_KEYBOARD_ONE_1a2b';
const KEY_TWO='CANARY_KEYBOARD_TWO_3c4d';

/**
 * Keyboard interaction: arrows move the evidence selection, `,` / `.` step the replay, and keys
 * typed into a form control must not steal the shortcuts.
 */
test('keyboard moves the selection, steps the replay, and respects form controls',async ({page,watcher,pageErrors})=>{
 await watcher.seed([
  makeEvent({id:'canary-31',actor:'codex',kind:'session.started',offsetSeconds:0,data:{source:'browser-fixture'}}),
  makeEvent({id:'canary-32',actor:'codex',kind:'task.started',offsetSeconds:1,data:{prompt:'键盘测试任务'}}),
  makeEvent({id:'canary-33',actor:'deepseek',kind:'tool.started',offsetSeconds:2,data:{tool:'read_file',callId:'k1',input:{path:'web/label.ts'},marker:KEY_ONE}}),
  makeEvent({id:'canary-34',actor:'deepseek',kind:'tool.completed',offsetSeconds:3,data:{tool:'read_file',callId:'k1',status:'completed',marker:KEY_TWO}})
 ]);
 await page.goto(watcher.url);
 await expect(timelineRows(page)).toHaveCount(4);
 await expect(selectedSeq(page)).toHaveText('#4');

 // Focus something inside the app frame; the newest record is selected.
 await page.getByRole('button',{name:'更多',exact:true}).focus();

 await page.keyboard.press('ArrowUp');
 await expect(selectedSeq(page)).toHaveText('#3');
 await expect(page.locator('.evidence pre.raw')).toContainText(KEY_ONE);

 await page.keyboard.press('ArrowDown');
 await expect(selectedSeq(page)).toHaveText('#4');
 await expect(page.locator('.evidence pre.raw')).toContainText(KEY_TWO);

 // `,` steps back into replay mode, `.` steps forward again.
 await page.keyboard.press(',');
 await openReplayControls(page);
 await expect(page.getByRole('button',{name:'回放',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(selectedSeq(page)).toHaveText('#3');

 await page.keyboard.press('.');
 await expect(selectedSeq(page)).toHaveText('#4');

 // The same keys inside a form control must not change the selection.
 await replayRange(page).focus();
 await page.keyboard.press(',');
 await expect(selectedSeq(page)).toHaveText('#4');

 const art=await characterArt(watcher.webDir);
 expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
});
