# track 目录说明 / track Folder Guide

本目录是 **追踪互动** AR 页面发布产物。
This folder contains the deployed build for **Track interaction** AR.

## 互动机制 / Interaction Mechanic

一个 3D 物体（shell entity）在 AR 天空中自主漫游。用户将屏幕中央的准星对准飞行物体并保持瞄准 5 秒。环形进度条随追踪时间填充，100% 时模型发生溶解变形。如果准星偏离目标，进度会衰减。

A 3D object (shell entity) roams autonomously in the AR sky. The user aims the center crosshair at the flying object and holds for 5 seconds. A circular progress indicator fills while tracking. At 100%, the model dissolves and transforms. Progress decays if the crosshair drifts off-target.

## A-Frame 组件 / A-Frame Components

- **`track-ar-interaction`** — registered on `<a-scene>`, handles raycast hit detection, progress tracking, model transform
- **`sky-roam`** — autonomous roaming movement for the shell entity
- **`sky-shell-core`** — core component for the trackable target entity
- No gesture components (drag/rotate/pinch) — the object moves on its own

## 配置 / Configuration

`ar-config.js` defines `window.TRACK_CONFIG`, merged with internal defaults in `bundle.js`:

| Key | Description / 说明 |
|:----|:-------------------|
| `debug` | Enable debug raycast visualization (default: false) / 调试射线可视化 |
| `targetSize` | Size of the trackable target (default: 0.6) / 追踪目标大小 |
| `roam.speed` | Roaming movement speed (default: 1.1) / 漫游速度 |
| `roam.radius` | Roaming area radius (default: 6) / 漫游半径 |
| `roam.minY` / `maxY` | Vertical roaming range (default: 1–5) / 垂直漫游范围 |
| `track.duration` | Required tracking time in ms (default: 5000) / 所需追踪时间 |
| `track.hitboxPadding` | Extra hitbox padding (default: 0.5) / 额外碰撞区域 |
| `dissolve.duration` | Dissolve animation duration (default: 600ms) / 溶解动画时长 |
| `material.metalness` | Model metalness (default: 0.15) / 金属度 |
| `material.roughness` | Model roughness (default: 0.85) / 粗糙度 |

## UI 元素 / UI Elements

| Element ID | Purpose / 用途 |
|:-----------|:---------------|
| `#pre-ar-overlay` | Loading screen + "Enter AR" button / 加载画面 + 进入 AR 按钮 |
| `#ar-hint` | Top hint bar: "Aim at the flying object for 5 seconds" / 顶部提示栏 |
| `#aim-icon` | Center crosshair SVG (circle + lines), adds `.targeting` class when on-target / 准星图标 |
| `#track-progress` | Circular SVG progress ring (stroke-dashoffset animation) / 环形进度条 |
| `#tracking-text` | Text: "Tracking... 0.0s / 5.0s" / 追踪进度文字 |
| `#item-name-display` | Item name after transformation / 物品名称 |
| `#back-to-main` | Return button / 返回按钮 |

## A-Frame 场景结构 / Scene Structure

- Camera at `(0, 1.6, 0)` — no raycaster/cursor attribute (tracking done programmatically)
- `#sky-container` at origin → `#shellEntity` with `sky-roam` + `sky-shell-core` at `(0, 2, -3)`
- Shadow-receiving ground plane

## 文件结构 / File Structure

```
track/
├── index.html          ← AR page entry point / 入口
├── bundle.js           ← track-ar-interaction + sky-roam + sky-shell-core
├── ar-config.js        ← window.TRACK_CONFIG
├── external/           ← 8th Wall + A-Frame 1.4.1
└── Readme.md
```

注意：此目录没有 `assets/` 文件夹，模型全部通过 URL 参数加载。
Note: No `assets/` directory — all models are loaded via URL parameters.

_最后更新 Last updated: 2026-04-09_
