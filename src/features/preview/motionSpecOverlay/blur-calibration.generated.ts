export const BLUR_CALIBRATION_VERSION = 1;
export interface BlurBucket { scale:number; dpr:1|2; a:number; b:number; maxSsimError:number; }
export const BLUR_BUCKETS: BlurBucket[] = [
  {
    "scale": 0.25,
    "dpr": 1,
    "a": 0.25,
    "b": 0,
    "maxSsimError": 0.01622
  },
  {
    "scale": 0.25,
    "dpr": 2,
    "a": 0.5,
    "b": 0,
    "maxSsimError": 0.01116
  },
  {
    "scale": 0.5,
    "dpr": 1,
    "a": 0.5,
    "b": 0,
    "maxSsimError": 0.01116
  },
  {
    "scale": 0.5,
    "dpr": 2,
    "a": 1,
    "b": 0,
    "maxSsimError": 0.013912
  },
  {
    "scale": 1,
    "dpr": 1,
    "a": 1,
    "b": 0,
    "maxSsimError": 0.013912
  },
  {
    "scale": 1,
    "dpr": 2,
    "a": 2,
    "b": 0,
    "maxSsimError": 0.012597
  }
];
