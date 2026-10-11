import {openMore,test,expect,makeEvent} from './fixture';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {offlineHTML} from '../../src/export';
import {DEFAULT_SHARE} from '../../src/types';

test('refresh keeps the explicitly selected live run, even while viewing a sample',async({page,watcher})=>{
 await watcher.seed([
  makeEvent({id:'pick-a',runId:'a',actor:'codex',kind:'task.started',offsetSeconds:0,data:{prompt:'Older selected task'}}),
  makeEvent({id:'pick-b',runId:'b',actor:'codex',kind:'task.started',offsetSeconds:1,data:{prompt:'Latest task'}})
 ]);
 await page.goto(watcher.url);
 await expect(page.locator('.task-line')).toContainText('Latest task');
 await openMore(page);
 await page.getByLabel('选择运行记录').selectOption('a');
 await expect(page.locator('.task-line')).toContainText('Older selected task');
 await page.reload();
 await expect(page.locator('.task-line')).toContainText('Older selected task');
 await openMore(page);
 await page.getByRole('button',{name:'试玩示例',exact:true}).click();
 await openMore(page);
 await page.getByLabel('选择运行记录').selectOption('demo-run');
 await page.reload();
 await expect(page.locator('.task-line')).toContainText('Older selected task');
});

test('a removed saved run falls back to the latest available live run',async({page,watcher})=>{
 await watcher.seed([makeEvent({id:'fallback',runId:'available',actor:'codex',kind:'task.started',data:{prompt:'Available task'}})]);
 await page.goto(watcher.url);
 await page.evaluate(()=>sessionStorage.setItem('handoff-fm-selected-run','removed'));
 await page.reload();
 await expect(page.locator('.task-line')).toContainText('Available task');
});

test('selecting an offline run never replaces the saved live choice',async({page,watcher})=>{
 const events=[
  makeEvent({id:'offline-a',runId:'a',actor:'codex',kind:'task.started'}),
  makeEvent({id:'offline-b',runId:'b',actor:'codex',kind:'task.started',offsetSeconds:1})
 ];
 const path=join(watcher.root,'selection-offline.html');
 await writeFile(path,await offlineHTML(watcher.webDir,events,DEFAULT_SHARE));
 await page.addInitScript(()=>sessionStorage.setItem('handoff-fm-selected-run','saved-live-run'));
 await page.goto(pathToFileURL(path).href);
 await expect(page.locator('.status')).toHaveText('离线回放');
 await openMore(page);
 await page.getByLabel('选择运行记录').selectOption({index:1});
 expect(await page.evaluate(()=>sessionStorage.getItem('handoff-fm-selected-run'))).toBe('saved-live-run');
});
