# tap 目录说明 / tap Folder Guide

本目录是 **点击互动** AR 页面发布产物。
This folder contains the deployed build for **Tap interaction** AR.

## 互动机制 / Interaction Mechanic

3 颗星星同时围绕 3D 模型飞行。用户逐一点击每颗星，触发光晕效果并淡出。全部 3 颗点击完成后，模型在"真实"与"虚构"版本之间切换，然后生成新一轮 3 颗星。

Three stars fly simultaneously around the 3D model. The user taps each star, triggering a halo effect and fadeout. After all 3 are tapped, the model swaps between "real" and "fictional" versions. Then 3 new stars spawn for the next round.

## A-Frame 组件 / A-Frame Component

- **`tap-ar-interaction`** — registered on `<a-scene>`, handles star spawning, tap detection, model swap logic
- Camera raycaster targets `.cantap` / `.can-tap` elements
- Model holder supports `xrextras-hold-drag`, `xrextras-two-finger-rotate`, `xrextras-pinch-scale`

## 配置 / Configuration

`ar-config.js` defines `window.TAP_CONFIG`, merged with internal defaults in `bundle.js`:

| Key | Description / 说明 |
|:----|:-------------------|
| `star.count` | Number of flying stars (default: 3) / 飞行星星数量 |
| `star.color` | Star color (default: `#ffd54a`) / 星星颜色 |
| `star.flySpeed` | Star orbit speed in ms (default: 1600) / 飞行速度 |
| `star.pulseScale` | Pulse animation scale (default: 1.35) / 脉动缩放 |
| `star.haloDuration` | Halo effect duration in ms (default: 600) / 光晕持续时间 |
| `spawn.duration` | Star spawn animation duration (default: 360ms) / 星星生成动画时长 |
| `spawn.staggerDelay` | Delay between star spawns (default: 300ms) / 生成间隔 |
| `burst.count` | Particle burst count on tap (default: 4) / 点击粒子爆发数 |
| `swap.delay` | Delay before model swap (default: 500ms) / 模型切换延迟 |

## UI 元素 / UI Elements

| Element ID | Purpose / 用途 |
|:-----------|:---------------|
| `#pre-ar-overlay` | Loading screen + "Enter AR" button / 加载画面 + 进入 AR 按钮 |
| `#ar-hint` | Top hint bar: "Tap all 3 flying stars!" / 顶部提示栏 |
| `#star-counter` | Filled/empty star display / 星星计数器 |
| `#combo-display` | Combo counter (hidden initially) / 连击计数器 |
| `#sprite-burst-overlay` | Full-screen star burst animation / 全屏星爆动画 |
| `#item-name-display` | Item name on reveal / 物品名称显示 |
| `#back-to-main` | Return button (shown after interaction) / 返回按钮 |

## 文件结构 / File Structure

```
tap/
├── index.html          ← AR page entry point / 入口
├── bundle.js           ← tap-ar-interaction component
├── ar-config.js        ← window.TAP_CONFIG
├── assets/
│   ├── star-burst.png  ← Burst overlay sprite
│   └── star-fly.mp4    ← Star flying video texture
├── external/           ← 8th Wall + A-Frame 1.4.1
└── Readme.md
```

_最后更新 Last updated: 2026-04-09_
