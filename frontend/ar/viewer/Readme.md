# viewer 目录说明 / viewer Folder Guide

本目录是 **单模型 AR 查看器** 页面发布产物。
This folder contains the deployed build for the **AR model viewer**.

## 互动机制 / Interaction Mechanic

被动查看模式，无游戏化互动机制。从 URL 参数加载单个 GLB 模型并放置在 AR 空间中供用户查看。支持拖拽、双指旋转和缩放手势。用作兜底查看器或直接模型检查。

Passive viewing mode with no game-like interaction mechanic. Loads a single GLB model from URL parameters and places it in AR space for the user to view. Supports hold-drag, two-finger rotate, and pinch-scale gestures. Used as a fallback viewer or for direct model inspection.

## A-Frame 组件 / A-Frame Components

- **`dynamic-model-loader`** — loads the model from URL parameters at runtime
- **`responsive-immersive`** — handles responsive scaling/placement
- Model supports `xrextras-hold-drag`, `xrextras-two-finger-rotate`, `xrextras-pinch-scale`, and `reflections="type: realtime"`

## UI 元素 / UI Elements

| Element ID | Purpose / 用途 |
|:-----------|:---------------|
| `#pre-ar-overlay` | Loading screen + "Enter AR" button / 加载画面 + 进入 AR 按钮 |
| `#model-title` | Fixed top bar showing model title (blurred backdrop) / 顶部模型标题栏 |

## 文件结构 / File Structure

```
viewer/
├── index.html          ← AR page entry point / 入口
├── bundle.js           ← dynamic-model-loader + responsive-immersive
├── external/           ← 8th Wall + A-Frame 1.4.1
└── Readme.md
```

注意：此目录没有 `ar-config.js` 和 `assets/`，配置和模型全部通过 URL 参数传入。
Note: No `ar-config.js` or `assets/` directory — all config and models are passed via URL parameters.

_最后更新 Last updated: 2026-04-09_
