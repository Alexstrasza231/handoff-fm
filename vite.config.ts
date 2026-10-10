import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
// Single entry, no dynamic chunks: the offline export inlines exactly one JS and one CSS asset.
export default defineConfig({
 root:__dirname,
 publicDir:resolve(__dirname,'web/public'),
 base:'/',
 plugins:[react()],
 build:{
  outDir:resolve(__dirname,'web-dist'),emptyOutDir:true,assetsInlineLimit:0,cssCodeSplit:false,
  rollupOptions:{input:resolve(__dirname,'index.html'),output:{inlineDynamicImports:true,entryFileNames:'assets/[name].js',assetFileNames:'assets/[name][extname]',chunkFileNames:'assets/[name].js'}}
 },
 server:{host:'127.0.0.1',port:5173,strictPort:false},
 preview:{host:'127.0.0.1'}
});
