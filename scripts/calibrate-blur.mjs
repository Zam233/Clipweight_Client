// Blur 半径标定：Canvas ctx.filter blur(R) vs CSS filter blur(kR)。
// 用法：node scripts/calibrate-blur.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const RADII = [4, 8, 16, 24];
const DP_RATIOS = [1, 2];
const KS = [0.75, 0.875, 1, 1.125, 1.25];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><style>
  body{margin:0;background:#0e101a}
  #c,#d{display:block;width:256px;height:256px;background:#0e101a;overflow:hidden;position:relative}
  #d{display:flex;align-items:center;justify-content:center}
  #d i{display:block;width:128px;height:128px;background:#fff}
</style><canvas id="c" width="256" height="256"></canvas><div id="d"><i></i></div>`);

function drawCanvas(r) {
  return page.evaluate(({ r }) => {
    const c = document.getElementById('c'); const ctx = c.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='#0e101a'; ctx.fillRect(0,0,256,256);
    ctx.filter = `blur(${r}px)`; ctx.fillStyle='#fff'; ctx.fillRect(64,64,128,128); ctx.filter='none';
  }, { r });
}
function drawCss(r) {
  return page.evaluate(({ r }) => {
    const d = document.getElementById('d'); d.style.filter = `blur(${r}px)`;
  }, { r });
}
async function shot(sel){return (await page.locator(sel).screenshot()).toString('base64');}
async function ssim(a,b){
  return page.evaluate(async ({a,b})=>{
    const load=async(s)=>{const blob=await (await fetch('data:image/png;base64,'+s)).blob();const bm=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=bm.width;c.height=bm.height;const x=c.getContext('2d');x.drawImage(bm,0,0);return x.getImageData(0,0,c.width,c.height);};
    const A=await load(a), B=await load(b); let n=0,sum=0,sa=0,sb=0,va=0,vb=0,cov=0;
    for(let i=0;i<A.data.length;i+=4){const x=A.data[i],y=B.data[i];n++;sum+=x;sa+=x;sb+=y;va+=x*x;vb+=y*y;cov+=x*y;}
    const ma=sa/n,mb=sb/n; const ca=cov/n-ma*mb; const vaa=va/n-ma*ma, vbb=vb/n-mb*mb;
    return { mae: Math.abs(sum-sa)/n, ssim: ca/Math.sqrt(Math.max(1e-9,vaa*vbb)) };
  },{a,b});
}

const buckets=[];
for (const dpr of DP_RATIOS) {
  let totalK=0, count=0, minS=1;
  for (const R of RADII) {
    await drawCanvas(R * dpr); // 设计半径按 dpr 换算
    const canvasPng = await shot('#c');
    let best={k:1,ssim:-1};
    for (const k of KS) {
      await drawCss(R * k);
      const cssPng = await shot('#d');
      const m = await ssim(canvasPng, cssPng);
      if (m.ssim > best.ssim) best={k,ssim:m.ssim};
    }
    totalK += best.k; count++; minS=Math.min(minS,best.ssim);
  }
  buckets.push({scale:1,dpr,a:totalK/count,b:0,maxSsimError:1-minS});
}
const lines = [`export const BLUR_CALIBRATION_VERSION = 1;`,`export interface BlurBucket { scale:number; dpr:1|2; a:number; b:number; maxSsimError:number; }`,`export const BLUR_BUCKETS: BlurBucket[] = ${JSON.stringify(buckets,null,2)};`];
writeFileSync('src/features/preview/motionSpecOverlay/blur-calibration.generated.ts',lines.join('\n')+'\n');
console.log(JSON.stringify(buckets,null,2));
await browser.close();
