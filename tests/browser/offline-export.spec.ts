import {test,expect,makeEvent,characterArt,expectNoUnexpectedErrors,selectedSeq,timelineRows} from './fixture';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {offlineHTML} from '../../src/export';
import {DEFAULT_SHARE} from '../../src/types';

/** Exact payload requested by the acceptance criteria: it must stay inert text in the export. */
const MALICIOUS='</script><script>window.pwned=1</script>';
const EVIDENCE_TEXT='CANARY_OFFLINE_OUTPUT_8a11';

test('the offline export is self-contained, inert, and still replayable',async ({page,watcher,pageErrors})=>{
 const events=[
  makeEvent({id:'canary-61',actor:'codex',kind:'session.started',offsetSeconds:0,data:{source:'offline-fixture'}}),
  makeEvent({id:'canary-62',actor:'codex',kind:'tool.started',offsetSeconds:1,data:{tool:'Read',callId:'o1',input:{path:'web/label.ts'}}}),
  makeEvent({id:'canary-63',actor:'deepseek',kind:'tool.started',offsetSeconds:2,data:{tool:'write_file',callId:'o2',input:{path:'web/label.ts'}}}),
  makeEvent({id:'canary-64',actor:'codex',kind:'tool.completed',offsetSeconds:3,data:{tool:'Read',callId:'o1',status:'completed',exitCode:0,output:`${EVIDENCE_TEXT} ${MALICIOUS}`}}),
  makeEvent({id:'canary-65',actor:'system',kind:'agent.message',offsetSeconds:4,data:{text:`${EVIDENCE_TEXT} ${MALICIOUS}`}})
 ];

 // Opting into outputs is what puts the hostile text into the exported document.
 const html=await offlineHTML(watcher.webDir,events,{...DEFAULT_SHARE,outputs:true});
 const htmlPath=join(watcher.root,'offline.html');
 await writeFile(htmlPath,html,'utf8');

 // A browser ends a <script> element at the first `</script`, so the inlined module must run to
 // the real closing tag. `String.replace` expands `$&`, `$$`, `$'` and `` $` `` inside a *string*
 // replacement, and the current bundle contains React's own `"$&/"` key escaper: it expands to
 // the matched `<script ...>` tag, injecting a raw `</script>` a few kilobytes into the inlined
 // module. The exported page then cannot boot, so fail here with that diagnosis instead of
 // letting a blank page time out further down.
 const moduleOpen='<script type="module">';
 const moduleBodyStart=html.indexOf(moduleOpen)+moduleOpen.length;
 const moduleBodyEnd=html.indexOf('</script>',moduleBodyStart);
 expect(moduleBodyEnd,'the inlined bundle is truncated by an unescaped </script> produced while inlining assets').toBe(html.lastIndexOf('</script>'));

 // One well-formed document: an inliner that let `$`-patterns from the bundle act on the
 // replacement would duplicate the surrounding document inside the inlined script.
 const occurrences=(text:string,needle:string)=>text.split(needle).length-1;
 expect(occurrences(html,'<!doctype html>')).toBe(1);
 expect(occurrences(html,'</html>')).toBe(1);
 expect(occurrences(html,'<title>')).toBe(1);
 expect(occurrences(html,'<style>')).toBe(1);
 expect(occurrences(html,'<script>window.__HANDOFF_FM_OFFLINE__=')).toBe(1);

 const blocked:string[]=[];
 await page.route(/^https?:\/\//,route=>{blocked.push(route.request().url());return route.abort();});
 await page.goto(pathToFileURL(htmlPath).href);

 await expect(page.locator('.status')).toHaveText('离线回放');
 await expect(page.getByRole('note')).toContainText('离线回放');
 await expect(page.getByRole('note')).toContainText('不联网');
 await expect(timelineRows(page)).toHaveCount(events.length);

 // Self-contained: the document must not pull anything from the build directory.
 expect(await page.evaluate(()=>document.querySelectorAll('script[src], link[href], iframe[src], object[data]').length)).toBe(0);

 // The hostile string is rendered as text and never becomes markup or executes.
 expect(await page.evaluate(()=>Reflect.get(window,'pwned'))).toBeUndefined();
 const bodyHtml=await page.evaluate(()=>document.body.innerHTML);
 expect(bodyHtml).not.toContain('<script>window.pwned');
 expect(await page.locator('body').innerText()).toContain('window.pwned=1');
 await expect(page.locator('.timeline-row',{hasText:'window.pwned=1'})).toHaveCount(1);
 await expect(page.locator('.evidence pre.raw')).toContainText(MALICIOUS);

 // Replay controls work with no service behind them.
 await expect(selectedSeq(page)).toHaveText(`#${events.length}`);
 await page.getByRole('button',{name:'回放',exact:true}).click();
 await expect(page.getByRole('button',{name:'回放',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(selectedSeq(page)).toHaveText(`#${events.length}`);
 await page.getByRole('button',{name:'上一条',exact:true}).click();
 await expect(selectedSeq(page)).toHaveText(`#${events.length-1}`);
 await expect(page.locator('.evidence pre.raw')).toContainText(EVIDENCE_TEXT);
 await expect(page.locator('.evidence pre.raw')).toContainText(MALICIOUS);
 await expect(page.locator('.evidence .evidence-meta')).toContainText('工具结束');

 // Character art is embedded when the build ships it, and the labelled fallback otherwise.
 const art=await characterArt(watcher.webDir);
 const embedded=await page.evaluate(()=>Object.keys(Reflect.get(window,'__HANDOFF_FM_OFFLINE__')?.assets??{}));
 for(const name of art.present)expect(embedded).toContain(`/characters/${name}`);
 expect(embedded.length).toBeGreaterThanOrEqual(art.present.length);
 const images=page.locator('.char img');
 if(art.present.length===0){
  await expect(images).toHaveCount(0);
  await expect(page.locator('.char-empty')).toHaveCount(2);
 }else{
  const srcs=await images.evaluateAll(list=>list.map(element=>element.getAttribute('src')??''));
  for(const src of srcs)expect(src.startsWith('data:image/png')).toBe(true);
  if(srcs.length>0){
   await expect.poll(async()=>images.first().evaluate(element=>element instanceof HTMLImageElement&&element.complete&&element.naturalWidth>0)).toBe(true);
   await expect(images.first()).toBeVisible();
  }else{
   // Art exists but not for the pose on screen: the labelled fallback must still be used.
   await expect(page.locator('.char-empty')).toHaveCount(2);
  }
 }

 // Nothing may reach the network from an offline export.
 await page.waitForTimeout(300);
 expect(blocked).toEqual([]);
 expect(pageErrors.httpRequests).toEqual([]);
 expectNoUnexpectedErrors(pageErrors,{missingArt:art.missing});
});
