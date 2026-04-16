# blow 目录说明 / blow Folder Guide

本目录是 **吹气互动** AR 页面发布产物。
This folder contains the deployed build for **Blow interaction** AR.

## 互动机制 / Interaction Mechanic

使用 Web Audio API 的 FFT 分析检测用户对麦克风的吹气。系统检查低频占比、频谱平坦度和能量稳定性来区分吹气与环境噪声。吹气时进度计逐渐填充，在检查点（33%/66%/100%）显示消息。100% 时模型滚走，切换为另一版本后滚回。屏幕上同步显示风粒子动画。

Uses Web Audio API FFT analysis to detect user blowing into the microphone. The system checks low-frequency ratio, spectral flatness, and energy stability to distinguish blowing from ambient noise. As the user blows, a progress meter fills up. At checkpoints (33%/66%/100%), messages display. At 100%, the model rolls away, swaps to the other version, and rolls back in. Wind particles animate on screen during blowing.

## A-Frame 组件 / A-Frame Component

- **`blow-ar-interaction`** — registered on `<a-scene>`, handles audio analysis, progress tracking, rolling animation, model swap
- Model holder supports `xrextras-pinch-scale` (min: 0.25, max: 3)

## 配置 / Configuration

`ar-config.js` defines `window.BLOW_CONFIG`, merged with internal defaults in `bundle.js`:

| Key | Description / 说明 |
|:----|:-------------------|
| `blow.fftSize` | FFT analysis size (default: 512) / FFT 分析大小 |
| `blow.lowFreqBins` | Low frequency bins to check (default: 6) / 低频段数 |
| `blow.threshold` | Blow detection threshold (default: 0.06) / 吹气检测阈值 |
| `blow.smoothing` | Audio smoothing factor (default: 0.3) / 音频平滑系数 |
| `blow.calibrationTime` | Calibration period in ms (default: 2000) / 校准时间 |
| `rolling.maxRotationSpeed` | Max roll rotation speed in deg/s (default: 540) / 最大滚动旋转速度 |
| `rolling.rollOutDistance` | Roll-out distance (default: 3.0) / 滚出距离 |
| `rolling.rollInDuration` | Roll-in animation duration (default: 800ms) / 滚入动画时长 |
| `progress.target` | Progress target value (default: 100) / 进度目标值 |
| `progress.blowMultiplier` | Progress fill speed multiplier (default: 1.2) / 填充速度倍率 |
| `progress.checkpoints` | Checkpoint thresholds (default: [33, 66, 100]) / 检查点阈值 |
| `progress.messages` | Checkpoint messages / 检查点消息 |
| `bounce.*` | Bounce animation params (same pattern as rotate) / 弹跳动画参数 |
| `particles.maxCount` | Max wind particles (default: 15) / 最大风粒子数 |

## UI 元素 / UI Elements

| Element ID | Purpose / 用途 |
|:-----------|:---------------|
| `#pre-ar-overlay` | Loading screen + "Enter AR" button / 加载画面 + 进入 AR 按钮 |
| `#ar-hint` | Top hint bar: "Blow on the mic to roll" / 顶部提示栏 |
| `#blow-meter` | Arc-shaped meter container / 弧形进度计容器 |
| `#blow-meter-arc` | Half-circle arc (clipped to top half) / 半圆弧 |
| `#blow-meter-fill` | Rotating fill indicator / 旋转填充指示器 |
| `#blow-meter-icon` | Microphone icon with pulse animation / 麦克风图标 |
| `#blow-prompt` | "Blow on the mic!" prompt text / 吹气提示文字 |
| `#toggle-count` | Toggle counter "0 / 3" / 切换计数 |
| `#checkpoint-message` | Checkpoint message popup / 检查点消息 |
| `#wind-particle-container` | Wind particle animation layer / 风粒子动画层 |
| `#item-name-display` | Item name on model swap / 物品名称 |
| `#back-to-main` | Return button / 返回按钮 |

## 文件结构 / File Structure

```
blow/
├── index.html            ← AR page entry point / 入口
├── bundle.js             ← blow-ar-interaction component
├── ar-config.js          ← window.BLOW_CONFIG
├── assets/
│   ├── realmodel.glb     ← Test real model (TEST_MODE only)
│   └── fictionalmodel.glb ← Test fictional model (TEST_MODE only)
├── external/             ← 8th Wall + A-Frame 1.4.1
└── Readme.md
```

注意：`assets/` 中的 GLB 文件仅供 `TEST_MODE` 本地测试使用。正式运行时模型通过 URL 参数加载。
Note: GLB files in `assets/` are for `TEST_MODE` local testing only. In production, models are loaded via URL parameters.

_最后更新 Last updated: 2026-04-09_
