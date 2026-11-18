import { chromium } from 'playwright';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('http://127.0.0.1:5173/settings/types',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500); await p.screenshot({path:'docs/e2e/video-type-forge/10-current-type-catalog.png'});
await p.goto('http://127.0.0.1:5173/settings/type-maker/forge',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500);
const s=p.getByText('快节奏科技评论').first(); if(await s.count()){await s.click(); await p.waitForTimeout(1200);}
const ta=p.locator('textarea[placeholder*="描述视频类型"]'); await ta.fill('补充：音效要强节奏，字幕高亮关键词'); await p.locator('button:has(svg.lucide-send)').click();
await p.waitForTimeout(35000); await p.screenshot({path:'docs/e2e/video-type-forge/12-current-typeforge-session.png'});
await b.close(); console.log('done');
