export const BLUR_CALIBRATION_VERSION = 1;
export interface BlurBucket { scale:number; dpr:1|2; a:number; b:number; maxSsimError:number; }
export const BLUR_BUCKETS: BlurBucket[] = [
  {
    "scale": 1,
    "dpr": 1,
    "a": 1,
    "b": 0,
    "maxSsimError": 0.00004479834965920304
  },
  {
    "scale": 1,
    "dpr": 2,
    "a": 1.25,
    "b": 0,
    "maxSsimError": 0.010325328300746839
  }
];
