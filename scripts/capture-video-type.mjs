import { chromium } from 'playwright';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('http://127.0.0.1:5173/settings/type-maker/forge',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500);
const s=p.getByText('2分钟硬切数码评测'); if(await s.count()){await s.first().click(); await p.waitForTimeout(1200);} await p.screenshot({path:'docs/e2e/video-type-forge/01-typeforge-session.png'});
await p.goto('http://127.0.0.1:5173/settings/type-maker/knowledge_longform',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500);
const tab=p.getByRole('button',{name:'Prompt'}); if(await tab.count()){await tab.click(); await p.waitForTimeout(500);} await p.screenshot({path:'docs/e2e/video-type-forge/02-detail-builtin-prompt.png'});
await b.close(); console.log('done');
