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

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: compare-mg-frame.py overlay.jpg server.png")
    a = yellow_bbox(sys.argv[1]); b = yellow_bbox(sys.argv[2])
    print({"overlay": a, "server": b})
    if not a or not b:
        raise SystemExit("no yellow bbox")
    for k in ("left", "top", "right", "bottom"):
        print(k, "delta", round(abs(a[k] - b[k]), 4))
