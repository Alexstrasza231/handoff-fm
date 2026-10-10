import {test,expect,makeEvent} from './fixture';

test('compact landing makes each participant action clear and opens a diff with one click',async({page,watcher})=>{
 await watcher.seed([
  makeEvent({id:'simple-1',kind:'task.started',actor:'codex',data:{prompt:'<in-app-browser-context>metadata</in-app-browser-context>\n## My request:\n改善交接卡片'}}),
  makeEvent({id:'simple-2',kind:'delegate.started',actor:'codex',offsetSeconds:1,data:{title:'改善交接卡片'}}),
  makeEvent({id:'simple-3',kind:'file.changed',actor:'deepseek',evidence:'unknown',offsetSeconds:2,data:{path:'src/Card.tsx',diff:'-old\n+new',candidateActor:'deepseek'}}),
  makeEvent({id:'simple-4',kind:'tool.completed',actor:'codex',offsetSeconds:3,data:{tool:'bash',exitCode:0}})
 ]);
 await page.goto(watcher.url);
 await expect(page.locator('.task-line')).toContainText('改善交接卡片');
 await expect(page.locator('.task-line')).not.toContainText('metadata');
 await expect(page.getByRole('button',{name:'查看最近修改',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'证据面板'})).not.toBeVisible();
 await expect(page.getByRole('button',{name:'上一条',exact:true})).not.toBeVisible();
 const recent=page.getByRole('region',{name:'最近活动'});
 await expect(recent).toContainText('Codex');
 await expect(recent).toContainText('DeepSeek');
 await expect(recent).toContainText('归属未知');
 await page.getByRole('button',{name:'查看最近修改',exact:true}).click();
 await expect(page.locator('.evidence .diff')).toContainText('+new');
 await expect(page.locator('.evidence')).toContainText('归属未知');
});

test('latest handoff replay starts at the latest dispatch and characters stay side by side at panel width',async({page,watcher})=>{
 await watcher.seed([
  makeEvent({id:'simple-r1',kind:'delegate.started',actor:'codex',offsetSeconds:0}),
  makeEvent({id:'simple-r2',kind:'delegate.completed',actor:'deepseek',offsetSeconds:1}),
  makeEvent({id:'simple-r3',kind:'delegate.started',actor:'codex',offsetSeconds:1000,data:{title:'新的交接'}}),
  makeEvent({id:'simple-r4',kind:'delegate.completed',actor:'deepseek',offsetSeconds:1005})
 ]);
 await page.setViewportSize({width:780,height:900});
 await page.goto(watcher.url);
 await page.getByRole('button',{name:'重播最近交接',exact:true}).click();
 await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 const position=Number(await page.getByRole('slider',{name:'回放时间位置'}).inputValue());
 expect(position).toBeGreaterThanOrEqual(1000000);
 expect(position).toBeLessThan(1005000);
 const left=await page.locator('.actor-codex').boundingBox();
 const right=await page.locator('.actor-deepseek').boundingBox();
 expect(left).not.toBeNull();expect(right).not.toBeNull();
 expect(Math.abs(left!.y-right!.y)).toBeLessThan(10);
 await page.setViewportSize({width:390,height:844});
 const mobileLeft=await page.locator('.actor-codex').boundingBox();
 const mobileRight=await page.locator('.actor-deepseek').boundingBox();
 expect(Math.abs(mobileLeft!.y-mobileRight!.y)).toBeLessThan(10);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('a dispatch with no subsequent record is located and labelled rather than pretending to play',async({page,watcher})=>{
 await watcher.seed([makeEvent({id:'pending-1',kind:'delegate.started',actor:'codex',offsetSeconds:0})]);
 await page.goto(watcher.url);
 await page.getByRole('button',{name:'重播最近交接',exact:true}).click();
 await expect(page.getByText('这次派活后暂无后续记录，已定位到派活。',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'暂停',exact:true})).not.toBeVisible();
});
