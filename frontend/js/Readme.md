# JS Modules — Frontend Business Logic
# JS 模块 — 前端业务逻辑

> **EN:** This folder contains the core frontend business logic modules. The main state machine (`story.js`) orchestrates the entire user journey, while other modules handle specific responsibilities like API communication, 3D rendering, and AR launching.
>
> **中文：** 这个文件夹包含核心前端业务逻辑模块。主状态机（`story.js`）编排整个用户旅程，其他模块各自负责 API 通信、3D 渲染、AR 启动等功能。

---

## File Guide / 文件说明

| File / 文件 | When to use / 什么时候用 | Description / 说明 |
|:------------|:------------------------|:-------------------|
| `story.js` | 🧠 **Core flow logic** / 核心流程逻辑 | The largest and most complex file. Implements the page state machine (auth → world → photo → processing → result → complete), manages photo upload, calls story-api for backend communication, displays typewriter-effect story text, polls 3D job status, triggers dual 3D viewer and AR launcher. If something is broken in the user flow, start debugging here. / 最大最复杂的文件。实现页面状态机，管理照片上传、调用 API、显示打字机效果故事文字、轮询 3D 任务、触发 3D 查看器和 AR 启动。用户流程出问题从这里开始调试。 |
| `story-api.js` | 📡 **API communication** / API 通信 | Wraps all backend API calls — `startJourney()`, `submitPhotoEvent()`, `pollJobStatus()`, `getStoryDetails()`, etc. Handles response parsing, error extraction, base URL construction, and data normalization (maps backend field names to frontend-friendly names like `fictionalImageUrl`). / 封装所有后端 API 调用。处理响应解析、错误提取、URL 构建和数据规范化（将后端字段名映射为前端友好名称）。 |
| `dual-viewer.js` | 👀 **Dual 3D rendering** / 双 3D 渲染 | Renders two Three.js GLB model viewers side-by-side: "Real" (from user's photo) and "Fictional" (AI-generated). Supports fullscreen toggle, loading spinner states, model swap, and orbit controls for each viewer independently. / 并排渲染两个 Three.js GLB 模型查看器。支持全屏切换、加载状态、模型交换和独立轨道控制。 |
| `ar-launcher.js` | 🚀 **AR page routing** / AR 页面路由 | Builds the correct AR page URL based on the event's `ar_interaction_type` (Tap → `/ar/tap/`, Rotate → `/ar/rotate/`, Track → `/ar/track/`) and appends query parameters for model paths. Handles navigation to the AR sub-page. / 根据事件的 `ar_interaction_type` 构建正确的 AR 页面 URL 并附加模型路径参数。 |
| `gpu-manager.js` | 📊 **GPU status panel** / GPU 状态面板 | Displays Vast.ai GPU worker health, instance status (running/stopped), and provides UI controls for starting, stopping, and restarting the GPU instance and its services. / 显示 GPU 工作站健康状态、实例状态，提供启停和重启的 UI 控制。 |
| `ambient-sound.js` | 🔊 **Background audio** / 背景音频 | Ambient sound engine that plays world-themed audio loops during the story experience. Manages audio context, volume, fade in/out, and user interaction requirements for autoplay. / 环境音效引擎，在故事体验中播放世界主题音频循环。管理音频上下文、音量、淡入淡出。 |

---

## Recommended Reading Order / 推荐阅读顺序

1. **`story.js`** — understand the state machine and overall flow first / 先理解状态机和整体流程
2. **`story-api.js`** — understand how frontend talks to backend / 理解前后端如何通信
3. **`dual-viewer.js`** — understand 3D model rendering / 理解 3D 模型渲染
4. **`ar-launcher.js`** — understand AR page navigation / 理解 AR 页面跳转

---

## Module Dependency Diagram / 模块依赖关系

```
story.js (main controller / 主控制器)
    ├── story-api.js    (API calls / API 调用)
    ├── dual-viewer.js  (3D rendering / 3D 渲染)
    ├── ar-launcher.js  (AR navigation / AR 跳转)
    └── ambient-sound.js (audio / 音频)

gpu-manager.js          (independent panel / 独立面板)
```

`story.js` imports and orchestrates all other modules. `gpu-manager.js` runs independently as an admin panel.

`story.js` 导入并编排所有其他模块。`gpu-manager.js` 作为管理面板独立运行。

---

_Last updated / 最后更新: 2026-04-01_
