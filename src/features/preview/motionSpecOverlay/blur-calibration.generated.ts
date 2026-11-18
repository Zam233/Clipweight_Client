export const BLUR_CALIBRATION_VERSION = 1;
export interface BlurBucket { scale:number; dpr:1|2; a:number; b:number; maxSsimError:number; }
export const BLUR_BUCKETS: BlurBucket[] = [
  {
    "scale": 0.25,
    "dpr": 1,
    "a": 0.9,
    "b": 0,
    "maxSsimError": 0.000021688918767304166
  },
  {
    "scale": 0.25,
    "dpr": 2,
    "a": 0.9,
    "b": 0,
    "maxSsimError": 0.0055711887050224895
  },
  {
    "scale": 0.5,
    "dpr": 1,
    "a": 1,
    "b": 0,
    "maxSsimError": 0.000010832184038966908
  },
  {
    "scale": 0.5,
    "dpr": 2,
    "a": 1,
    "b": 0,
    "maxSsimError": 0.0056589122075320075
  },
  {
    "scale": 1,
    "dpr": 1,
    "a": 1,
    "b": 0,
    "maxSsimError": 0.000007385682410099292
  },
  {
    "scale": 1,
    "dpr": 2,
    "a": 1,
    "b": 0,
    "maxSsimError": 0.0059568578952683415
  }
];
