# AR — Augmented Reality Experience Pages
# AR — 增强现实体验页面

> **EN:** This folder contains pre-built AR experience pages, one for each interaction type. These are self-contained web pages that use WebXR to display 3D models overlaid on the real world through the phone's camera. They receive model URLs and parameters via query strings from the main app.
>
> **中文：** 这个文件夹包含预构建的 AR 体验页面，每种互动类型一个。这些是独立的网页，使用 WebXR 通过手机摄像头将 3D 模型叠加到现实世界上。它们通过主应用的查询字符串接收模型 URL 和参数。

---

## Folder Guide / 文件夹说明

| Folder / 文件夹 | AR Type / AR 类型 | Action Category / 动作类别 | Description / 说明 |
|:------------|:---|:---|:-------------------|
| `tap/` | 👆 **Tap interaction** / 点击互动 | Touch | User taps on screen to place or reveal the 3D model in AR space. The model appears at the tapped position and may animate (grow, glow, bounce). Typical use: touching a magical item to activate it. / 用户点击屏幕在 AR 空间中放置或显示 3D 模型。模型出现在点击位置并可能有动画。典型场景：触摸魔法物品以激活。 |
| `rotate/` | 🔄 **Rotate interaction** / 旋转互动 | Turning | User drags on screen or physically rotates the device to spin the 3D model. The model responds to rotation gestures. Typical use: turning a key, spinning a wheel, rotating a compass. / 用户拖拽屏幕或物理旋转设备来旋转 3D 模型。典型场景：转动钥匙、旋转轮盘、转动指南针。 |
| `track/` | 📍 **Track interaction** / 追踪互动 | Following | User moves the phone through space to follow or chase a 3D model. The model leads the user or responds to device movement. Typical use: following a floating guide creature, chasing a wisp of light. / 用户在空间中移动手机来跟随或追踪 3D 模型。典型场景：跟随浮游引导生物、追逐光点。 |
| `viewer/` | 🔍 **Simple viewer** / 简单查看器 | (any) | A generic AR model viewer without specific interaction mechanics. Displays the model in AR space for viewing from different angles. Used as a fallback or for direct model inspection. / 通用 AR 模型查看器，无特定互动机制。在 AR 空间中显示模型供多角度查看。用作兜底或直接模型检查。 |

---

## File Structure / 文件结构

Each sub-folder typically contains:

每个子文件夹通常包含：

```
tap/  (or rotate/, track/, viewer/)
├── index.html      ← AR page entry point / AR 页面入口
├── bundle.js       ← Compiled JavaScript / 编译后的 JavaScript
└── external/       ← Third-party libraries (Three.js, WebXR polyfill, etc.)
                       第三方库
```

These are **pre-built, self-contained pages** — you don't need to compile or build them. The main app navigates to them via URL with query parameters.

这些是**预构建的独立页面**——不需要编译。主应用通过带查询参数的 URL 跳转到它们。

---

## How AR Pages Are Launched / AR 页面如何启动

The `js/ar-launcher.js` module in the main app builds the URL:

主应用中的 `js/ar-launcher.js` 模块构建 URL：

```
/ar/{type}/?model=/user/{user_id}/real_3d/event_1.glb&fictional=/user/{user_id}/fictional_3d/event_1.glb
```

The AR page reads these query parameters, fetches the GLB files, and renders them in WebXR AR mode.

AR 页面读取这些查询参数，获取 GLB 文件，并在 WebXR AR 模式中渲染。

---

## Requirements / 要求

- **HTTPS** — WebXR requires a secure context / WebXR 需要安全上下文
- **ARCore** (Android) or **ARKit** (iOS) — device must support AR / 设备必须支持 AR
- **Compatible browser** — Chrome (Android) or Safari (iOS) with WebXR support / 支持 WebXR 的浏览器

---

_Last updated / 最后更新: 2026-04-01_
