import {test,expect,makeEvent} from './fixture';
test('novice homepage, usage tabs, character filter and narrow-screen keyboard access',async({page,watcher})=>{
 const task={...makeEvent({id:'task',kind:'task.started',actor:'codex',data:{prompt:'Fix the card'},offsetSeconds:0}),taskId:'turn'};
 const sample={...makeEvent({id:'usage',kind:'usage.recorded',actor:'codex',offsetSeconds:2,data:{sampleKey:'turn',source:'codex-transcript',input:100,output:20,cacheRead:80,cacheWrite:0,total:120,coverage:'complete'}}),taskId:'turn'};
 await watcher.seed([task,sample]);await page.goto(watcher.url);
 await expect(page.getByRole('button',{name:'查看详情',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'回放过程',exact:true})).toBeVisible();
 await expect(page.locator('.usage-summary')).toContainText('120');
 await page.getByRole('button',{name:'查看详情',exact:true}).click();
 await expect(page.getByRole('tab',{name:'过程记录',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'用量明细',exact:true}).click();
 await expect(page.getByRole('tabpanel')).toContainText('缓存读取');
 await expect(page.getByRole('tabpanel')).toContainText('80');
 await expect(page.getByRole('region',{name:'Codex 用量',exact:true})).toContainText('缓存读取');
 await page.getByRole('tab',{name:'用量明细',exact:true}).press('ArrowLeft');
 await expect(page.getByRole('tab',{name:'过程记录',exact:true})).toBeFocused();
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('replay detail never shows future usage and usage does not change the stage',async({page,watcher})=>{
 await watcher.seed([
 {...makeEvent({id:'t',actor:'codex',kind:'task.started',data:{prompt:'Replay numeric task'}}),taskId:'turn'},
 {...makeEvent({id:'c',actor:'codex',kind:'tool.started',offsetSeconds:1,data:{tool:'read_file',callId:'c',input:{path:'config.ts'}}}),taskId:'turn'},
 {...makeEvent({id:'u',actor:'codex',kind:'usage.recorded',offsetSeconds:10,data:{sampleKey:'s',source:'codex-transcript',input:800,output:77,total:877,coverage:'complete'}}),taskId:'turn'}]);
 await page.goto(watcher.url);await expect(page.locator('.usage-summary')).toContainText('877');
 await expect(page.locator('.actor-codex .actor-latest')).toContainText('读取');
 const caption=await page.locator('.stage-line p').innerText();expect(caption).not.toContain('用量');
 await page.getByRole('button',{name:'回放过程',exact:true}).click();
 await page.getByRole('slider',{name:'回放时间位置'}).focus();await page.keyboard.press('Home');
 await expect(page.locator('.usage-summary')).not.toContainText('877');
 await page.getByRole('button',{name:'查看详情',exact:true}).click();
 await page.getByRole('tab',{name:'用量明细',exact:true}).click();await expect(page.getByRole('tabpanel')).not.toContainText('877');
 await page.getByRole('tab',{name:'过程记录',exact:true}).click();await expect(page.locator('.timeline-row')).toHaveCount(1);
 await page.keyboard.press('Escape');await expect(page.getByRole('region',{name:'详情面板',exact:true})).not.toBeVisible();
 await expect(page.getByRole('button',{name:'查看详情',exact:true})).toBeFocused();
});
test('usage export is opt-in and keeps transcript paths private',async({page,watcher})=>{
 await watcher.seed([{...makeEvent({id:'u',kind:'usage.recorded',actor:'codex',data:{sampleKey:'PRIVATE_SAMPLE_PATH',source:'codex-transcript',input:100,output:20,total:120,coverage:'complete',transcriptPath:'PRIVATE_TRANSCRIPT_PATH'}}),taskId:'turn'}]);
 await page.goto(watcher.url);await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('button',{name:'分享预览',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'用量数据',exact:true})).not.toBeChecked();
 await expect(page.locator('pre.share-preview')).toHaveText('[]');
 await page.getByRole('checkbox',{name:'用量数据',exact:true}).check();
 await expect(page.locator('pre.share-preview')).toContainText('120');
 await expect(page.locator('pre.share-preview')).not.toContainText('PRIVATE_');
});
test('empty state offers an explicitly labelled example',async({page,watcher})=>{
 await page.goto(watcher.url);await page.getByRole('button',{name:'看个例子',exact:true}).click();
 await expect(page.getByRole('status').first()).toContainText('示例回放');
 await expect(page.locator('.conn-line')).not.toContainText('实时');
});
test('offline usage details use the record clock rather than wall time',async({page,watcher})=>{
 const {offlineHTML}=await import('../../src/export');const {DEFAULT_SHARE}=await import('../../src/types');const {writeFile}=await import('node:fs/promises');const {join}=await import('node:path');const {pathToFileURL}=await import('node:url');
 const events=[{...makeEvent({id:'t',actor:'codex',kind:'task.started'}),taskId:'turn'},{...makeEvent({id:'u',actor:'codex',kind:'usage.recorded',offsetSeconds:30,data:{sampleKey:'s',source:'codex-transcript',input:100,output:20,total:120,coverage:'complete'}}),taskId:'turn'}];
 const path=join(watcher.root,'usage-offline.html');await writeFile(path,await offlineHTML(watcher.webDir,events,{...DEFAULT_SHARE,usage:true}));await page.goto(pathToFileURL(path).href);
 await expect(page.locator('.usage-summary')).toContainText('30 秒');await page.getByRole('button',{name:'查看详情',exact:true}).click();await page.getByRole('tab',{name:'用量明细',exact:true}).click();
 await expect(page.locator('.usage-panel')).toContainText('用时 30 秒');await expect(page.getByRole('region',{name:'Codex 用量',exact:true})).toContainText('刚刚更新');
});
