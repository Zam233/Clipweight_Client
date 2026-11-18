// 3D 覆盖层快速切换/拖动/泄漏冒烟测试（真实浏览器）。
import { chromium } from 'playwright';
const CLIP='tc_e9831d60';
const browser=await chromium.launch(); const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[]; page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto('http://127.0.0.1:5173/editor/proj_f4727a36c443?clip=tc_e9831d60&t=60.81',{waitUntil:'domcontentloaded'});
await page.waitForFunction(({CLIP})=>{const t=window.__cwStores?.timeline.getState().timeline; return t&&t.tracks.some(tr=>tr.clips.some(c=>c.id===CLIP));},{CLIP},{timeout:30000});
await page.evaluate(({CLIP})=>{const d=window.__cwStores; d.selection.getState().selectClip(CLIP); d.preview.getState().setCurrentTime(60.81);},{CLIP});
await page.waitForTimeout(1000);
const count=async()=>page.evaluate(()=>({overlays:document.querySelectorAll('[data-testid="mg-overlay"]').length, animations:document.getAnimations().length, nodes:document.querySelectorAll('*').length}));
const start=await count();
if(start.overlays!==1) throw new Error('overlay not active: '+JSON.stringify(start));
// 播放/暂停/移出片段 10 次
for(let i=0;i<10;i++){
 await page.evaluate(()=>{const d=window.__cwStores; d.preview.getState().setCurrentTime(0);});
 await page.waitForTimeout(60);
 await page.evaluate(()=>{const d=window.__cwStores; d.preview.getState().setCurrentTime(60.81); d.preview.getState().setPlaying(false);});
 await page.waitForTimeout(80);
 const c=await count(); if(c.overlays!==1) throw new Error('toggle overlay count '+c.overlays);
}
// 拖动 20 次
for(let i=0;i<20;i++){
 const t=60.7+((i%10)/10)*1.2;
 await page.evaluate(({t})=>window.__cwStores.preview.getState().setCurrentTime(t),{t});
 await page.waitForTimeout(40);
 const c=await count(); if(c.overlays>1) throw new Error('duplicate overlay '+c.overlays);
}
await page.evaluate(()=>window.__cwStores.preview.getState().setCurrentTime(0));
await page.waitForTimeout(600);
const end=await count();
const mem=await page.evaluate(()=>performance.memory ? performance.memory.usedJSHeapSize : null);
const report={start,end,errors,mem,passed:end.overlays===0&&errors.length===0&&end.animations<=start.animations+2};
console.log(JSON.stringify(report,null,2));
await browser.close();
if(!report.passed) process.exit(1);
