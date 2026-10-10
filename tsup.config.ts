import {defineConfig} from 'tsup';
export default defineConfig({entry:['src/cli.ts'],format:['esm'],platform:'node',target:'node22',clean:true,noExternal:['diff'],banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
