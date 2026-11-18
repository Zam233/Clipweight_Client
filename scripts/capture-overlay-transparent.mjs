// 抓取隔离背景的 CSS3D 覆盖层 PNG（透明），用于 CP-6 强度 Δedge。
import { chromium } from 'playwright';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
await page.goto('http://127.0.0.1:5173/editor/proj_f4727a36c443?clip=tc_e9831d60&t=60.81',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>{const t=window.__cwStores?.timeline.getState().timeline; return t && t.tracks.some(tr=>tr.clips.some(c=>c.id==='tc_e9831d60'));}, {timeout:30000});
await page.evaluate(()=>{const d=window.__cwStores; d.selection.getState().selectClip('tc_e9831d60'); d.preview.getState().setCurrentTime(60.81); d.preview.getState().setPlaying(false);});
await page.waitForTimeout(1500);
const info=await page.evaluate(()=>{const d=window.__cwStores; const clip=d.timeline.getState().timeline.tracks.flatMap(t=>t.clips).find(c=>c.id==='tc_e9831d60'); document.body.style.background='transparent'; const ov=document.querySelector('[data-testid="mg-overlay"]'); if(!ov) return null; let n=ov; while(n.parentElement){ for(const sib of Array.from(n.parentElement.children)){ if(sib!==n) sib.style.visibility='hidden'; } n=n.parentElement; } if(ov.firstElementChild) ov.firstElementChild.style.display='none'; return {t:d.preview.getState().currentTimeSec, sel:d.selection.getState().selectedClipIds, clip:{start:clip?.start_sec,spec:!!clip?.metadata?.motion_spec,overlay:!!ov}, text:ov.textContent?.slice(0,80)};});
if(!info){console.error('no overlay');process.exit(2);} 
await page.locator('[data-testid="mg-overlay"]').screenshot({path:'docs/e2e/motion-spec-3d-overlay-transparent.png',omitBackground:true,animations:'disabled'});
console.log(info);
await browser.close();
