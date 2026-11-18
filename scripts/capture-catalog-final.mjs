import { chromium } from 'playwright';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('http://127.0.0.1:5173/settings/types',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500); await p.screenshot({path:'docs/e2e/video-type-forge/10-current-type-catalog.png'}); await b.close(); console.log('done');
