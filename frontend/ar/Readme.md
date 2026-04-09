# AR — Augmented Reality Experience Pages
# AR — 增强现实体验页面

> **EN:** This folder contains pre-built AR experience pages, one for each interaction type. These are self-contained web pages that use 8th Wall WebAR + A-Frame 1.4.1 to display 3D models overlaid on the real world through the phone's camera. They receive model URLs and parameters via query strings from the main app.
>
> **中文：** 这个文件夹包含预构建的 AR 体验页面，每种互动类型一个。这些是独立的网页，使用 8th Wall WebAR + A-Frame 1.4.1 通过手机摄像头将 3D 模型叠加到现实世界上。它们通过主应用的查询字符串接收模型 URL 和参数。

---

## Folder Guide / 文件夹说明

| Folder / 文件夹 | AR Type / AR 类型 | Action Category / 动作类别 | Description / 说明 |
|:------------|:---|:---|:-------------------|
| `tap/` | 👆 **Tap interaction** / 点击互动 | Touch | 3 stars fly around the model; user taps each star to trigger halo + fadeout. After all 3 stars tapped, the model swaps (real ↔ fictional). / 3 颗星星围绕模型飞行，用户依次点击每颗星触发光晕+淡出效果，全部点击后模型切换（真实 ↔ 虚构）。 |
| `rotate/` | 🔄 **Rotate interaction** / 旋转互动 | Turning | A ring UI overlays the screen; user drags to rotate the model. Checkpoints at random angles trigger bounce + model swap after 3 completions. / 屏幕叠加环形 UI，用户拖拽旋转模型。随机角度的检查点触发弹跳+模型切换，完成 3 次后结束。 |
| `track/` | 📍 **Track interaction** / 追踪互动 | Following | A 3D object roams the sky; user aims the crosshair at it for 5 seconds. Progress ring fills up; at 100% the model transforms. / 3D 物体在天空中漫游，用户将准星对准它保持 5 秒。进度环逐渐填满，100% 时模型变形。 |
| `blow/` | 💨 **Blow interaction** / 吹气互动 | Microphone | User blows into the mic; Web Audio FFT detects airflow. Progress meter fills at checkpoints (33%/66%/100%), model rolls away and swaps. / 用户对麦克风吹气，Web Audio FFT 检测气流。进度计在检查点（33%/66%/100%）填充，模型滚走并切换。 |
| `viewer/` | 🔍 **Simple viewer** / 简单查看器 | (any) | A generic AR model viewer without specific interaction. Displays a single model in AR for drag/rotate/pinch viewing. Used as fallback. / 通用 AR 模型查看器，无特定互动。在 AR 中显示单个模型供拖拽/旋转/缩放查看。用作兜底。 |

---

## File Structure / 文件结构

Each sub-folder typically contains:

每个子文件夹通常包含：

```
tap/  (or rotate/, track/, blow/, viewer/)
├── index.html      ← AR page entry point / AR 页面入口
├── bundle.js       ← Compiled JavaScript (registers the A-Frame component)
│                      编译后的 JavaScript（注册 A-Frame 组件）
├── ar-config.js    ← Runtime config (window.*_CONFIG), optional
│                      运行时配置（window.*_CONFIG），可选
├── assets/         ← Local assets (images, test models), optional
│                      本地素材（图片、测试模型），可选
└── external/       ← 8th Wall + A-Frame 1.4.1 libraries
                       8th Wall + A-Frame 1.4.1 库
```

These are **pre-built, self-contained pages** — you don't need to compile or build them. The main app navigates to them via URL with query parameters.

这些是**预构建的独立页面**——不需要编译。主应用通过带查询参数的 URL 跳转到它们。

---

## How AR Pages Are Launched / AR 页面如何启动

The `js/ar-launcher.js` module in the main app builds the URL:

主应用中的 `js/ar-launcher.js` 模块构建 URL：

```
/ar/{type}/?real_glb=...&fictional_glb=...&interaction={type}&item_name=...&real_name=...&return_url=...
```

| Param / 参数 | Description / 说明 |
|:---|:---|
| `real_glb` | URL of the "real" GLB model / "真实"模型 GLB URL |
| `fictional_glb` | URL of the "fictional" GLB model / "虚构"模型 GLB URL |
| `interaction` | Interaction type name (Tap, Rotate, Track, Blow) / 互动类型名 |
| `item_name` | Display name for the fictional item / 虚构物品显示名 |
| `real_name` | Display name for the real item / 真实物品显示名 |
| `return_url` | URL to navigate back after completion / 完成后返回的 URL |

The AR page reads these query parameters, fetches the GLB files, and renders them in 8th Wall AR mode.

AR 页面读取这些查询参数，获取 GLB 文件，并在 8th Wall AR 模式中渲染。

---

## Shared Technical Stack / 共享技术栈

- **A-Frame 1.4.1** via `8frame-1.4.1.min.js` (Three.js-based 3D framework)
- **8th Wall WebAR** — `xrweb`, `xrextras`, `landing-page` packages
- **AR Mode** — `xrweb="allowedDevices: any; delayRun: true"`
- **Pre-AR Overlay** — every page has `#pre-ar-overlay` with loading screen + "Enter AR" button
- **Lighting** — identical 6-light setup: key + fill + back + bottom directional, ambient, hemisphere
- **Back Button** — sets `iw_ar_completed` in `localStorage` and navigates to `return_url`
- **Config Pattern** — each `bundle.js` defines internal defaults then deep-merges with `window.*_CONFIG` from `ar-config.js`

---

## Requirements / 要求

- **HTTPS** — WebXR requires a secure context / WebXR 需要安全上下文
- **ARCore** (Android) or **ARKit** (iOS) — device must support AR / 设备必须支持 AR
- **Compatible browser** — Chrome (Android) or Safari (iOS) with WebXR support / 支持 WebXR 的浏览器
- **Microphone** (Blow only) — `getUserMedia` audio permission for blow detection / 吹气互动需麦克风权限

---

_Last updated / 最后更新: 2026-04-09_
