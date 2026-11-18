// 可靠矩形标定：同背景、同 bbox、同尺寸；覆盖 3 scale × 2 dpr × 4 半径。
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const RADII=[4,8,16,24], SCALES=[0.25,0.5,1], DP=[1,2], KS=[0.9,1,1.1];
const browser=await chromium.launch(); const page=await browser.newPage({deviceScaleFactor:1});
await page.setContent(`<!doctype html><style>body{margin:0;background:#0e101a}#c,#d{width:256px;height:256px;display:block;background:#0e101a;transform-origin:center}#d{position:relative}#d i{position:absolute;left:64px;top:64px;width:128px;height:128px;background:#fff;display:block}</style><canvas id="c" width="256" height="256"></canvas><div id="d"><i></i></div>`);
async function paint(r,scale){await page.evaluate(({r,scale})=>{const c=document.getElementById('c'),x=c.getContext('2d');x.setTransform(1,0,0,1,0,0);x.fillStyle='#0e101a';x.fillRect(0,0,256,256);x.filter=r?`blur(${r}px)`:'none';x.fillStyle='#fff';x.fillRect(64,64,128,128);x.filter='none';c.style.transform=`scale(${scale})`;const d=document.getElementById('d');d.style.filter=r?`blur(${r}px)`:'none';d.style.transform=`scale(${scale})`;},{r,scale});}
async function shot(s){return (await page.locator(s).screenshot()).toString('base64');}
async function ssim(a,b){return page.evaluate(async({a,b})=>{const load=async s=>{const blob=await(await fetch('data:image/png;base64,'+s)).blob();const bm=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=bm.width;c.height=bm.height;const x=c.getContext('2d');x.drawImage(bm,0,0);return x.getImageData(0,0,c.width,c.height);};const A=await load(a),B=await load(b);let n=0,sa=0,sb=0,va=0,vb=0,cov=0;for(let i=0;i<A.data.length;i+=4){const x=A.data[i],y=B.data[i];n++;sa+=x;sb+=y;va+=x*x;vb+=y*y;cov+=x*y;}const ma=sa/n,mb=sb/n,ca=cov/n-ma*mb,vaa=va/n-ma*ma,vbb=vb/n-mb*mb;return ca/Math.sqrt(Math.max(1e-9,vaa*vbb));},{a,b});}
const buckets=[];
for(const scale of SCALES)for(const dpr of DP){let bestK=1,bestS=-1;for(const R of RADII){await paint(R*dpr,scale);const cp=await shot('#c');for(const k of KS){await paint(R*k,scale);const dp=await shot('#d');const s=await ssim(cp,dp);if(s>bestS){bestS=s;bestK=k;}}}buckets.push({scale,dpr,a:bestK,b:0,maxSsimError:Math.max(0,1-bestS)});}
writeFileSync('src/features/preview/motionSpecOverlay/blur-calibration.generated.ts',`export const BLUR_CALIBRATION_VERSION = 1;\nexport interface BlurBucket { scale:number; dpr:1|2; a:number; b:number; maxSsimError:number; }\nexport const BLUR_BUCKETS: BlurBucket[] = ${JSON.stringify(buckets,null,2)};\n`);
console.log(JSON.stringify(buckets,null,2));await browser.close();
