# rotate 目录说明 / rotate Folder Guide

本目录是 **旋转互动** AR 页面发布产物。
This folder contains the deployed build for **Rotate interaction** AR.

## 互动机制 / Interaction Mechanic

屏幕上叠加一个环形 UI，用户拖拽旋转环来转动 3D 模型。检查点随机分布在不同角度，当用户旋转到检查点附近（≤5° 距离），触发弹跳动画。3 次检查点完成后模型在真实与虚构版本间切换。单指拖拽可重新定位模型。

A circular ring UI overlays the screen. The user drags/rotates the ring to rotate the 3D model. Checkpoints are placed at random angles; when the user rotates close enough to a checkpoint (≤5°), a bounce animation plays. After 3 checkpoint completions, the model swaps between real and fictional. Single-finger drag repositions the model.

## A-Frame 组件 / A-Frame Component

- **`rotate-ar-interaction`** — registered on `<a-scene>`, handles ring rotation, checkpoint detection, bounce + swap
- **`rotation-monitor`** — helper component (currently placeholder)
- Model holder supports `xrextras-pinch-scale` (min: 0.25, max: 3)

## 配置 / Configuration

`ar-config.js` defines `window.ROTATE_CONFIG`, merged with internal defaults in `bundle.js`:

| Key | Description / 说明 |
|:----|:-------------------|
| `checkpoint.minAngle` | Min angle between checkpoints (default: 30°) / 检查点最小角间距 |
| `checkpoint.totalChecks` | Number of checkpoints per cycle (default: 3) / 每轮检查点数 |
| `checkpoint.messages` | Messages shown at each checkpoint / 检查点信息 |
| `checkpoint.resetDelay` | Delay before next checkpoint (default: 300ms) / 重置延迟 |
| `ringColor.base` | Ring idle color / 环形默认颜色 |
| `ringColor.active` | Ring active (approaching checkpoint) color / 接近检查点颜色 |
| `ringColor.reached` | Ring checkpoint-reached color / 到达检查点颜色 |
| `bounce.initialHeight` | Bounce height (default: 0.3) / 弹跳高度 |
| `bounce.bounceCount` | Number of bounces (default: 3) / 弹跳次数 |
| `bounce.squashStretch` | Per-bounce squash/stretch params / 每次弹跳形变参数 |

## UI 元素 / UI Elements

| Element ID | Purpose / 用途 |
|:-----------|:---------------|
| `#pre-ar-overlay` | Loading screen + "Enter AR" button / 加载画面 + 进入 AR 按钮 |
| `#ar-hint` | Top hint bar: "Turn the ring to rotate" / 顶部提示栏 |
| `#ring-container` | Main ring UI wrapper / 环形 UI 容器 |
| `#ring-track` | Circular ring border (220×220, 18px border) / 环形轨道 |
| `#checkpoint-dot` | Triangle marker on ring showing target angle / 检查点标记 |
| `#ring-handle` | Draggable handle at ring bottom / 环形拖拽手柄 |
| `#handle-number` | Checkpoint completion count display / 检查点完成计数 |
| `#checkpoint-message` | Temporary message on checkpoint hit / 检查点消息 |
| `#sprite-burst-overlay` | Star burst animation on checkpoint / 星爆动画 |
| `#star-blink-container` | Decorative floating star particles / 装饰浮动星星 |
| `#item-name-display` | Item name on model swap / 物品名称 |
| `#back-to-main` | Return button (shown after 3 toggles) / 返回按钮 |

## 文件结构 / File Structure

```
rotate/
├── index.html          ← AR page entry point / 入口
├── bundle.js           ← rotate-ar-interaction component
├── ar-config.js        ← window.ROTATE_CONFIG
├── assets/
│   ├── star-blink.png  ← Floating star sprite
│   ├── star-burst.png  ← Burst overlay sprite
│   └── ring.png        ← Ring texture
├── external/           ← 8th Wall + A-Frame 1.4.1
└── Readme.md
```

_最后更新 Last updated: 2026-04-09_
