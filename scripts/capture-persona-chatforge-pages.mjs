import { chromium } from 'playwright';
const base='http://127.0.0.1:5173';
const out='docs/e2e/persona-chatforge';
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const shot=async(name,{fullPage=false}={})=>{await page.waitForTimeout(800); await page.screenshot({path:`${out}/${name}.png`,fullPage}); console.log(name,page.url());};
await page.goto(base+'/persona',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1200); await shot('01-persona-gallery');
await page.goto(base+'/persona/forge',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1200); await shot('02-forge-empty');
await page.goto(base+'/persona/forge?session=9f272fed1803',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500); await shot('03-forge-session');
const rev=page.getByText('修改参数'); if(await rev.count() && await rev.isEnabled()){await rev.click(); await page.waitForTimeout(300); await shot('02b-forge-manual-revision');}

await page.goto(base+'/persona/manual_capture?create=1',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1000); await shot('04-manual-create');
await page.evaluate(()=>{const els=[...document.querySelectorAll('*')]; const el=els.find(e=>e.scrollHeight>e.clientHeight+50); if(el) el.scrollTop=el.scrollHeight;}); await page.waitForTimeout(300); await shot('04b-manual-create-bottom');
await page.goto(base+'/persona/cold_tech_review',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1200); await shot('05-detail-readonly');
const promptTab=page.getByRole('button',{name:/Prompt/}); if(await promptTab.count()){await promptTab.first().click(); await page.waitForTimeout(300); await shot('07-detail-prompt');}
const edit=page.getByRole('button',{name:'编辑'});
if(await edit.count()){await edit.click(); await page.waitForTimeout(400); await shot('06-detail-editing');}
await b.close();
