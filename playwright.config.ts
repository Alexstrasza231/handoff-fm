import {defineConfig} from '@playwright/test';

/**
 * Browser acceptance tests for HandoffFM.
 *
 * There is deliberately no `webServer` block: every test starts the real `startWatch` server
 * in-process over its own temporary project (see `tests/browser/fixture.ts`), so the browser
 * always talks to the built `web-dist` bundle through the actual loopback service.
 *
 * No screenshot baselines and no video/trace artifacts are produced; assertions are made on
 * user-visible behaviour and on errors captured from the page.
 */
export default defineConfig({
 testDir:'./tests/browser',
 fullyParallel:true,
 forbidOnly:!!process.env.CI,
 retries:0,
 workers:process.env.CI?2:undefined,
 reporter:[['list']],
 timeout:30_000,
 expect:{timeout:7_000},
 use:{
  browserName:'chromium',
  headless:true,
  viewport:{width:1280,height:900},
  actionTimeout:10_000,
  trace:'off',
  screenshot:'off',
  video:'off'
 },
 outputDir:'test-results'
});
