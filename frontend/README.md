# Frontend — User-Facing Web Application
# 前端 — 用户界面 Web 应用

> **EN:** This folder is the user-facing web layer — a **Single Page Application (SPA)** that handles the entire user experience: login, world selection, photo upload, story display, 3D model preview, and AR launching. Built with vanilla JavaScript (no framework), Three.js for 3D, and CSS animations.
>
> **中文：** 这个文件夹是用户界面层——一个**单页应用（SPA）**，处理整个用户体验：登录、世界选择、照片上传、故事显示、3D 模型预览和 AR 启动。使用原生 JavaScript（无框架）、Three.js 做 3D、CSS 动画。

---

## What This Folder Does / 这个文件夹做了什么

| # | Responsibility / 职责 | How / 怎么做 |
|---|---|---|
| 1 | **Page flow** / 页面流转 | State machine manages transitions: auth → world select → photo upload → processing → result → AR / 状态机管理页面切换 |
| 2 | **Backend communication** / 后端通信 | API wrapper methods for all backend endpoints, with error handling and retry / API 封装方法，带错误处理和重试 |
| 3 | **Dual 3D preview** / 双 3D 模型预览 | Side-by-side Three.js viewers showing real photo 3D model and fictional item 3D model / 并排 Three.js 查看器显示照片 3D 和虚构物品 3D |
| 4 | **AR launching** / AR 启动 | Builds AR page URLs with model paths and interaction type, navigates to appropriate AR sub-page / 构建 AR 页面 URL 并跳转到对应的 AR 子页面 |

---

## File Guide / 文件说明

| File / 文件 | When to use / 什么时候用 | Description / 说明 |
|:------------|:------------------------|:-------------------|
| `index.html` | 🏠 **Layout & structure** / 布局和结构 | The single HTML file for the entire SPA. Contains all page sections (auth, world-select, camera, processing, result, complete), hidden/shown by JavaScript. All text copy lives here. / 整个 SPA 的唯一 HTML 文件。包含所有页面区块，由 JavaScript 控制显示/隐藏。所有文案都在这里。 |
| `style.css` | 🎨 **Styling** / 样式 | All styles, animations, responsive design, dark theme, loading spinners, glassmorphism effects. / 所有样式、动画、响应式设计、深色主题、加载动画、毛玻璃效果。 |
| `app.js` | 🔧 **Shared utilities** / 公共工具 | Shared utility functions, module initialization, global event listeners, page routing. The "glue" that connects all modules. / 公共工具函数、模块初始化、全局事件监听、页面路由。连接所有模块的「胶水」。 |
| `config.js` | ⚙️ **Configuration** / 配置 | API base URL, polling intervals, debug flags, feature toggles (e.g., `SKIP_3D_GENERATION`), timeout values. / API 基础 URL、轮询间隔、调试标志、功能开关、超时值。 |
| `viewer3d.js` | 🎮 **Single 3D viewer** / 单模型查看器 | Three.js-based single GLB model viewer with orbit controls, lighting, auto-rotation. Used as base for dual viewer. / 基于 Three.js 的单 GLB 模型查看器，带轨道控制、灯光、自动旋转。是双模型查看器的基础。 |
| `test-api.html` | 🧪 **API tester** / API 测试器 | Standalone HTML page for manually testing backend API endpoints. Useful for debugging. / 独立 HTML 页面，手动测试后端 API 接口。调试时有用。 |

### `js/` Module Files / `js/` 模块文件

| File / 文件 | When to use / 什么时候用 | Description / 说明 |
|:------------|:------------------------|:-------------------|
| `js/story.js` | 🧠 **Core logic (most complex)** / 核心逻辑（最复杂） | The main state machine and story flow controller. Manages the entire user journey: starting a story, handling photo uploads, displaying processing steps with typewriter effects, polling for 3D job completion, showing results, and navigating between events. This is the largest and most important frontend file. / 主状态机和故事流程控制器。管理整个用户旅程。这是最大、最重要的前端文件。 |
| `js/story-api.js` | 📡 **API wrapper** / API 封装 | All backend API request methods — start journey, upload photo, check job status, get story details. Handles response parsing, error extraction, and data normalization. / 所有后端 API 请求方法——开始旅程、上传照片、查询任务状态、获取故事详情。处理响应解析、错误提取和数据规范化。 |
| `js/dual-viewer.js` | 👀 **Dual 3D preview** / 双模型预览 | Side-by-side 3D model viewer showing "Real" (from photo) and "Fictional" (AI-generated) models. Supports fullscreen mode, model swapping, and loading states. / 并排 3D 模型查看器，显示「真实」和「虚构」模型。支持全屏、模型切换和加载状态。 |
| `js/ar-launcher.js` | 🚀 **AR navigation** / AR 跳转 | Builds AR page URLs based on interaction type (Tap/Rotate/Track) and model paths. Handles navigation to the correct AR sub-page under `/ar/`. / 根据互动类型和模型路径构建 AR 页面 URL。跳转到 `/ar/` 下正确的 AR 子页面。 |
| `js/gpu-manager.js` | 📊 **GPU panel** / GPU 面板 | GPU status monitoring panel — shows worker health, instance status, and provides start/stop/restart controls for the Vast.ai GPU instance. / GPU 状态监控面板——显示工作站健康、实例状态，提供启停控制。 |
| `js/ambient-sound.js` | 🔊 **Sound engine** / 音效引擎 | Background ambient sound system — plays world-themed audio during the story experience. / 背景环境音效系统——在故事体验中播放世界主题音频。 |

### `ar/` Sub-Pages / `ar/` AR 子页面

| Folder / 文件夹 | AR Interaction / AR 互动 | Description / 说明 |
|:------------|:------------------------|:-------------------|
| `ar/tap/` | 👆 **Tap** / 点击 | User taps on the screen to trigger the 3D model interaction (appears, animates, reveals). Maps to `Touch` action category. / 用户点击屏幕触发 3D 模型互动。对应 `Touch` 动作类别。 |
| `ar/rotate/` | 🔄 **Rotate** / 旋转 | User rotates the device or drags to spin the 3D model. Maps to `Turning` action category. / 用户旋转设备或拖拽来旋转 3D 模型。对应 `Turning` 动作类别。 |
| `ar/track/` | 📍 **Track** / 追踪 | User moves the phone to follow/track a 3D model in AR space. Maps to `Following` action category. / 用户移动手机在 AR 空间中追踪 3D 模型。对应 `Following` 动作类别。 |
| `ar/viewer/` | 🔍 **Viewer** / 查看器 | Simple single-model AR viewer without specific interaction type. / 简单的单模型 AR 查看器，无特定互动类型。 |

Each AR sub-folder contains pre-built files (`index.html`, `bundle.js`, `external/`) that run independently.

每个 AR 子文件夹包含预构建的文件，独立运行。

---

## Page Flow / 页面流转

```
Auth Page / 认证页面
  │ (login or register / 登录或注册)
  ▼
World Select / 世界选择
  │ (choose 1 of 6 worlds / 选择 6 个世界之一)
  ▼
Opening Story / 开场故事
  │ (AI generates story text with typewriter effect / AI 生成故事文字，打字机效果)
  ▼
┌─── Photo Upload / 照片上传 ◄──────────────────┐
│     │ (take photo or select from gallery)       │
│     ▼                                           │
│   Processing / 处理中                            │
│     ├─ Step 1: Analyzing photo... / 分析照片      │
│     ├─ Step 2: Generating event... / 生成事件      │
│     ├─ Step 3: Creating fictional image... / 生成图 │
│     └─ Step 4: Building 3D models... / 构建 3D     │
│     ▼                                           │
│   Result Page / 结果页                            │
│     ├─ Story event text (typewriter) / 故事文字    │
│     ├─ Dual 3D viewer (real + fictional) / 双 3D   │
│     └─ AR launch button / AR 启动按钮              │
│     ▼                                           │
│   (if events < 3, loop back / 事件 < 3 则循环) ──┘
│
▼
Complete Page / 完成页
  └─ Full story summary + all 3D models / 完整故事摘要 + 所有 3D 模型
```

---

## Common Change Entry Points / 常用修改入口

| Want to change... / 想改... | Edit this file / 编辑这个文件 |
|---|---|
| Text copy, layout, page structure / 文案、布局、页面结构 | `index.html` |
| Colors, fonts, animations, responsive design / 颜色、字体、动画、响应式 | `style.css` |
| Story flow logic, state transitions / 故事流程逻辑、状态切换 | `js/story.js` |
| API parameters, request/response handling / API 参数、请求响应处理 | `js/story-api.js` |
| AR page routing, URL construction / AR 页面路由、URL 构建 | `js/ar-launcher.js` |
| 3D model display, lighting, controls / 3D 模型显示、灯光、控制 | `viewer3d.js`, `js/dual-viewer.js` |
| API URL, polling intervals, debug flags / API 地址、轮询间隔、调试标志 | `config.js` |

---

## Test Mode / 测试模式

Visit `/test` or add `?test=1` to enter test mode:

访问 `/test` 或加 `?test=1` 进入测试模式：

- Frontend shows a 🧪 TEST MODE badge / 前端显示测试模式标识
- All data writes to `data_test/` instead of `data/` / 所有数据写到 `data_test/`
- No impact on production users / 不影响正式用户

You can also use `test-api.html` to manually test individual API endpoints.

也可以用 `test-api.html` 手动测试单个 API 接口。

---

## Troubleshooting / 故障排除

**Q: Page stuck on loading? / 页面卡在加载？**
A: Check browser console (F12) for errors. Most likely the backend is not running or `config.js` has a wrong API URL.
检查浏览器控制台（F12）的错误。最可能是后端没启动或 `config.js` 中 API 地址错误。

**Q: 3D models not appearing? / 3D 模型不显示？**
A: Check if the `.glb` file URL returns 200. Common issue: Vast.ai GPU was off so no model was generated (placeholder cube may appear instead).
检查 `.glb` 文件 URL 是否返回 200。常见问题：GPU 没开所以没生成模型（可能显示占位立方体）。

**Q: AR not working on my phone? / AR 在手机上不工作？**
A: AR requires HTTPS and a device with ARCore (Android) or ARKit (iOS) support. WebXR won't work over plain HTTP.
AR 需要 HTTPS 和支持 ARCore（Android）或 ARKit（iOS）的设备。WebXR 不支持纯 HTTP。

---

_Last updated / 最后更新: 2026-04-01_
