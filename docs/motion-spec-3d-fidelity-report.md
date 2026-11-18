# MotionSpec 3D 覆盖层 fidelity 报告（CP-6）

## 对比对象

- 前端 CSS3D 覆盖层截图：`docs/e2e/motion-spec-3d-overlay.jpg`
- 服务端 Hyperframes PNG：`docs/e2e/motion-spec-3d-server.png`
- 同一 clip、local 0.2s、相同文案。

## 指标

| 指标 | 当前值 | 阈值 | 结果 |
|---|---:|---:|---|
| yellow bbox left Δ | 0.0005 | — | — |
| yellow bbox top Δ | 0.0081 | — | — |
| yellow bbox right Δ | 0.0015 | — | — |
| yellow bbox bottom Δ | 0.0247 | — | — |
| mask IoU | 0.4516 | ≥ 0.40 | PASS |
| mask SSIM | 0.4133 | ≥ 0.40 | PASS |
| mean span Δ | 0.0356 | — | — |
| geometry edge Δ @512 | 6.34 px | ≤ 8.0 px | PASS |

## Δedge 定义

本报告中的 `geometry edge Δ @512` 是**几何边缘位移**：

```text
max(
  |left_overlay - left_server| * 512,
  |right_overlay - right_server| * 512,
  |top_overlay - top_server| * 256,
  |bottom_overlay - bottom_server| * 256,
)
```

它不是像素强度 10%–90% 的边缘扩散宽度；后者在带视频背景的覆盖层截图上无法可靠测量，因此本报告不使用伪造的 intensity-edge 数值。

## 阈值

```text
mask IoU     ≥ 0.40
mask SSIM    ≥ 0.40
geometry Δ   ≤ 8.0 px @512
```

该阈值只允许标记 **approx**，不允许标记 exact。

## 复现

```powershell
python scripts/compare-mg-frame.py docs/e2e/motion-spec-3d-overlay.jpg docs/e2e/motion-spec-3d-server.png
```

## 限制

- 覆盖层截图带视频背景，服务端 PNG 为白底/透明；
- 文本抗锯齿与字体 hinting 不同；
- 因此 SSIM 只有 0.41，不能宣称像素等价；
- exact 需要隔离背景的 10%–90% 边缘扩散或同渲染器 PNG。
