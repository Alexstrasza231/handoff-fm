import type {Page} from '@playwright/test';
import {test,expect,characterArt,enterDemo,expectNoUnexpectedErrors,replayRange,selectedKind,selectedSeq,speedSelect,selectedTime} from './fixture';
import {demoEvents} from '../../web/demo';

/**
 * The sample replay is baked into the bundle and must stay fully offline, clearly labelled, and
 * driven by the recorded-time playhead (pause / scrub / speed / jump).
 */
const DEMO_COUNT=demoEvents().length;
const playButton=(page:Page)=>page.getByRole('button',{name:'播放',exact:true});
const pauseButton=(page:Page)=>page.getByRole('button',{name:'暂停',exact:true});
const modeButton=(page:Page,name:'实时'|'回放')=>page.getByRole('button',{name,exact:true});

test('sample replay is labelled and playback can be paused',async ({page,watcher,pageErrors})=>{
 await page.goto(watcher.url);
 await enterDemo(page,DEMO_COUNT);

 await expect(page.getByRole('note')).toContainText('示例回放');
 await expect(page.getByRole('note')).toContainText('不会请求网络');
 await expect(page.locator('.status')).toHaveText('示例回放');
 await expect(page.getByRole('button',{name:'返回实时'})).toBeVisible();
 await expect(modeButton(page,'实时')).toHaveAttribute('aria-pressed','true');
 await expect(selectedSeq(page)).toHaveText(`#${DEMO_COUNT}`);

 // Live mode parks the playhead at the end of the recording window.
 const parked=Number(await replayRange(page).inputValue());
 expect(parked).toBeGreaterThan(2_000);

 // Play restarts from the head of the recording.
 await playButton(page).click();
 await expect(pauseButton(page)).toBeVisible();
 await expect(modeButton(page,'回放')).toHaveAttribute('aria-pressed','true');
 await expect.poll(async()=>Number(await replayRange(page).inputValue())).toBeLessThan(5_000);

 // Pause: the playhead must freeze completely.
 await pauseButton(page).click();
 await expect(playButton(page)).toBeVisible();
 const frozen=await selectedSeq(page).innerText();
 const frozenRange=await replayRange(page).inputValue();
 await page.waitForTimeout(500);
 expect(await selectedSeq(page).innerText()).toBe(frozen);
 expect(await replayRange(page).inputValue()).toBe(frozenRange);

 const art=await characterArt(watcher.webDir);
 expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
});

test('scrubbing moves the playhead to the recorded position',async ({page,watcher,pageErrors})=>{
 await page.goto(watcher.url);
 await enterDemo(page,DEMO_COUNT);

 // Drive the scrub control the way a user does. `fill()` cannot be used here: it assigns
 // `input.value` through React's own value tracker, so React would not observe the change.
 const range=replayRange(page);
 await range.focus();

 await page.keyboard.press('Home');
 await expect(selectedSeq(page)).toHaveText('#1');
 await expect(selectedTime(page)).toHaveText('00:00.0');
 await expect(page.locator('.scrub .muted')).toContainText('00:00.0');
 await expect(modeButton(page,'回放')).toHaveAttribute('aria-pressed','true');

 await page.keyboard.press('End');
 await expect(selectedSeq(page)).toHaveText(`#${DEMO_COUNT}`);
 await expect(selectedTime(page)).toHaveText('00:48.0');

 // One 100ms step back leaves the last record, so the desk must regress with the playhead.
 await page.keyboard.press('ArrowLeft');
 await expect(selectedSeq(page)).toHaveText(`#${DEMO_COUNT-1}`);
 await expect(selectedTime(page)).toHaveText('00:46.0');
 await expect(page.locator('.scrub .muted')).toContainText('00:46.0');
 await expect(page.locator('.evidence .evidence-meta')).toContainText('代理失败');

 const art=await characterArt(watcher.webDir);
 expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
});

test('the speed control changes the playback rate',async ({page,watcher,pageErrors})=>{
 await page.goto(watcher.url);
 await enterDemo(page,DEMO_COUNT);

 const speed=speedSelect(page);
 await expect(speed.locator('option')).toHaveText(['1x','2x','4x']);
 await speed.selectOption('4');
 await expect(speed).toHaveValue('4');

 // Live mode parks the playhead at the end, so Play restarts the window from the head.
 const parked=Number(await replayRange(page).inputValue());
 expect(parked).toBeGreaterThan(2_000);
 const started=Date.now();
 await playButton(page).click();
 await expect.poll(async()=>Number(await replayRange(page).inputValue()),{timeout:5_000}).toBeGreaterThanOrEqual(3_000);
 const elapsed=Date.now()-started;
 // 3s of recorded time at 4x needs ~0.75s; 1x would need 3s, so this bound is only met with 4x.
 expect(elapsed).toBeLessThan(2_400);
 await pauseButton(page).click();

 const art=await characterArt(watcher.webDir);
 expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
});

test('jump buttons land on handoff and failure records',async ({page,watcher,pageErrors})=>{
 await page.goto(watcher.url);
 await enterDemo(page,DEMO_COUNT);

 await page.getByRole('button',{name:'下一处交接',exact:true}).click();
 await expect(selectedKind(page)).toHaveText('派发代理');
 await expect(modeButton(page,'回放')).toHaveAttribute('aria-pressed','true');

 await page.getByRole('button',{name:'下一处失败或交接',exact:true}).click();
 await expect(selectedKind(page)).toHaveText('代理交稿');

 await page.getByRole('button',{name:'下一处失败或交接',exact:true}).click();
 await expect(selectedKind(page)).toHaveText('回合已中断');

 const art=await characterArt(watcher.webDir);
 expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
});
