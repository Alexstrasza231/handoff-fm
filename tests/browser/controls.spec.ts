import {test,expect,makeEvent,characterArt,expectNoUnexpectedErrors,timelineRows} from './fixture';

const EVIDENCE_TEXT='CANARY_CAPTION_EVIDENCE_3d07';
const CAPTIONS_OFF='舞台字幕已关闭（证据面板仍然保留全部记录）。';

async function seedCaptionedRun(watcher:{seed:(events:ReturnType<typeof makeEvent>[])=>Promise<void>}){
 await watcher.seed([
  makeEvent({id:'canary-21',actor:'codex',kind:'session.started',offsetSeconds:0,data:{source:'browser-fixture'}}),
  makeEvent({id:'canary-22',actor:'codex',kind:'tool.started',offsetSeconds:1,data:{tool:'Read',callId:'c1',input:{path:'web/label.ts'}}}),
  makeEvent({id:'canary-23',actor:'deepseek',kind:'tool.completed',offsetSeconds:2,data:{tool:'bash',callId:'c9',exitCode:0,status:'completed',output:EVIDENCE_TEXT}})
 ]);
}

test.describe('stage captions',()=>{
 test('captions are labelled, can be switched off, and never hide the evidence',async ({page,watcher,pageErrors})=>{
  await seedCaptionedRun(watcher);
  await page.goto(watcher.url);
  await expect(timelineRows(page)).toHaveCount(3);

  const stage=page.locator('.stage-line p');
  await expect(page.locator('.stage-line')).toContainText('舞台字幕');
  const captioned=await stage.innerText();
  expect(captioned.length).toBeGreaterThan(0);
  expect(captioned).not.toContain('已关闭');

  const toggle=page.getByRole('checkbox',{name:'舞台字幕'});
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(stage).toHaveText(CAPTIONS_OFF);

  // The evidence panel keeps rendering the selected record's raw fields.
  await expect(page.locator('.evidence pre.raw')).toContainText(EVIDENCE_TEXT);
  await expect(page.locator('.evidence .evidence-meta')).toContainText('工具结束');

  await toggle.check();
  await expect(stage).toHaveText(captioned);

  const art=await characterArt(watcher.webDir);
  expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
 });
});

test.describe('reduced motion',()=>{
 test.use({reducedMotion:'reduce'});

 test('the operating-system preference is honoured and can be overridden',async ({page,watcher,pageErrors})=>{
  await seedCaptionedRun(watcher);
  await page.goto(watcher.url);
  await expect(timelineRows(page)).toHaveCount(3);

  expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

  const app=page.locator('.app');
  const calm=page.getByRole('checkbox',{name:'减少动效'});
  await expect(calm).toBeChecked();
  await expect(app).toHaveClass(/\bcalm\b/);

  await calm.uncheck();
  await expect(app).not.toHaveClass(/\bcalm\b/);

  await calm.check();
  await expect(app).toHaveClass(/\bcalm\b/);

  const art=await characterArt(watcher.webDir);
  expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
 });
});

test.describe('motion default',()=>{
 test.use({reducedMotion:'no-preference'});

 test('calm stays off when reduced motion is not requested',async ({page,watcher,pageErrors})=>{
  await seedCaptionedRun(watcher);
  await page.goto(watcher.url);
  await expect(timelineRows(page)).toHaveCount(3);

  expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
  await expect(page.getByRole('checkbox',{name:'减少动效'})).not.toBeChecked();
  await expect(page.locator('.app')).not.toHaveClass(/\bcalm\b/);

  const art=await characterArt(watcher.webDir);
  expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
 });
});
