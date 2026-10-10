import type {FMEvent,ShareOptions} from './types';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {sanitize} from './privacy';
import {shareEvents} from './share';
export {shareEvents} from './share';
export async function offlineHTML(webDir:string,events:FMEvent[],options:ShareOptions){
 const html=await readFile(join(webDir,'index.html'),'utf8');const assets:Record<string,string>={};
 const chars=join(webDir,'characters');
 for(const file of await readdir(chars))if(/^[a-z-]+\.png$/.test(file))assets[`/characters/${file}`]='data:image/png;base64,'+(await readFile(join(chars,file))).toString('base64');
 // Escape JSON at the HTML parser boundary, including malicious </script> in selected logs.
 const json=JSON.stringify({events:shareEvents(events,options),options,assets}).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
 let result=html.replace(/<link rel="modulepreload"[^>]*>/g,'');
 const scripts=[...result.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)];
 for(const match of scripts){const path=match[1].replace(/^\//,'');if(!/^assets\/[a-zA-Z0-9_.-]+\.js$/.test(path))throw new Error('Unexpected build script');const code=await readFile(join(webDir,path),'utf8');result=result.replace(match[0],()=>`<script type="module">${code.replace(/<\/script/gi,'<\\/script')}</script>`);}
 for(const match of [...result.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)]){const path=match[1].replace(/^\//,'');if(!/^assets\/[a-zA-Z0-9_.-]+\.css$/.test(path))throw new Error('Unexpected build CSS');const css=await readFile(join(webDir,path),'utf8');result=result.replace(match[0],()=>`<style>${css.replace(/<\/style/gi,'<\\/style')}</style>`);}
 // A callback preserves literal dollar replacement patterns in selected text.
 result=result.replace(/<head>/,()=>'<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><script>window.__HANDOFF_FM_OFFLINE__='+json+'</script>');
 return result;
}
