"""对比 3D 覆盖层截图与服务端 PNG 的黄色文字 bbox（归一化）。"""
from PIL import Image
import sys

def yellow_bbox(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r > 190 and g > 140 and b < 120 and r > b + 60:
                xs.append(x); ys.append(y)
    if not xs:
        return None
    return {
        "left": min(xs) / w, "top": min(ys) / h,
        "right": max(xs) / w, "bottom": max(ys) / h, "ratio": len(xs) / (w * h),
    }

def yellow_mask_box(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r > 190 and g > 140 and b < 120 and r > b + 60:
                mp[x, y] = 255; xs.append(x); ys.append(y)
    if not xs:
        return None, None
    return mask.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1)), (min(xs), min(ys), max(xs), max(ys))

def mask_ssim(a_path, b_path):
    ma, _ = yellow_mask_box(a_path); mb, _ = yellow_mask_box(b_path)
    if ma is None or mb is None:
        return None
    size = (512, 256)
    ma = ma.resize(size).convert("L"); mb = mb.resize(size).convert("L")
    pa, pb = ma.load(), mb.load()
    n = size[0] * size[1]
    sa = sb = saa = sbb = sab = 0.0
    for y in range(size[1]):
        for x in range(size[0]):
            a = pa[x, y]; b = pb[x, y]
            sa += a; sb += b; saa += a*a; sbb += b*b; sab += a*b
    ma_ = sa/n; mb_ = sb/n
    va = saa/n - ma_*ma_; vb = sbb/n - mb_*mb_; cov = sab/n - ma_*mb_
    c1 = (0.01*255)**2; c2 = (0.03*255)**2
    return ((2*ma_*mb_ + c1)*(2*cov + c2)) / ((ma_*ma_ + mb_*mb_ + c1)*(va + vb + c2))

def mask_iou(a_path, b_path):
    ma, _ = yellow_mask_box(a_path); mb, _ = yellow_mask_box(b_path)
    if ma is None or mb is None:
        return None
    size = (640, 320)
    ma = ma.resize(size); mb = mb.resize(size)
    pa, pb = ma.load(), mb.load(); inter = union = 0
    for y in range(size[1]):
        for x in range(size[0]):
            a = pa[x, y] > 64; b = pb[x, y] > 64
            inter += a and b; union += a or b
    return inter / union if union else 0.0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: compare-mg-frame.py overlay.jpg server.png")
    a = yellow_bbox(sys.argv[1]); b = yellow_bbox(sys.argv[2])
    print({"overlay": a, "server": b})
    if not a or not b:
        raise SystemExit("no yellow bbox")
    for k in ("left", "top", "right", "bottom"):
        print(k, "delta", round(abs(a[k] - b[k]), 4))
    print("yellow_mask_iou", round(mask_iou(sys.argv[1], sys.argv[2]) or 0, 4))
    print("yellow_mask_ssim", round(mask_ssim(sys.argv[1], sys.argv[2]) or 0, 4))
