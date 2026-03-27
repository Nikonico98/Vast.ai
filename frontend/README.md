# Imaginary World 前端 - 界面指南

> 写给文科工程师的前端说明书 📖
>
> 前端是用户直接看到和触摸的部分。如果后端是"厨房"，前端就是"餐厅"——菜单、桌椅、灯光，都属于前端的工作。

---

## 这个前端做了什么？

当用户打开 `niko.ngrok.app`，他们看到的一切——页面、按钮、动画、3D 预览、AR 体验——都由前端负责。

**用户的旅程：**

```
登录 → 选择幻想世界 → 阅读故事背景 → 拍照 →
→ 等待处理 → 查看事件结果（含 3D 预览）→ 进入 AR 体验 →
→ 拍下一张照片 → …… → 故事结束
```

---

## 文件总览

| 文件 | 行数 | 一句话说明 | 类比 |
|------|------|-----------|------|
| `index.html` | 878 | 所有页面的 HTML 结构 | 🏗️ 建筑蓝图 |
| `style.css` | 4647 | 所有视觉样式 | 🎨 装修方案 |
| `app.js` | 762 | 工具函数、模块初始化 | 🧰 工具箱 |
| `config.js` | 60 | API 地址、轮询间隔等配置 | ⚙️ 遥控器设置 |
| `viewer3d.js` | 521 | 独立 3D 查看器 | 🔍 放大镜 |
| `js/story.js` | 4406 | 页面状态机与交互控制 | 🎬 导演 |
| `js/story-api.js` | 766 | 与后端 API 通信 | 📡 无线电 |
| `js/dual-viewer.js` | 1460 | 双 3D 模型对比预览 | 🖼️ 双联画框 |
| `js/ar-launcher.js` | 186 | AR 体验启动器 | 🚀 发射台 |
| `js/gpu-manager.js` | 259 | GPU 状态监控面板 | 📊 仪表盘 |
| `js/ambient-sound.js` | 252 | 程序化环境音效引擎 | 🔊 背景音乐 |

---

## 关键概念

### 页面（Pages）

`index.html` 包含多个 `<section>` 页面，同一时间只显示一个。`story.js` 像导演一样控制"现在该演哪一幕"。

| 页面 ID | 用途 | 用户看到什么 |
|---------|------|-------------|
| `page-auth` | 登录/注册 | 用户名输入框 |
| `page-story-history` | 历史故事列表 | 过去的冒险记录 |
| `page-world-selection` | 选择幻想世界 | 6 个世界卡片 |
| `page-story-background` | 故事背景展示 | AI 生成的故事开头 |
| `page-photo-upload` | 拍照/上传 | 相机按钮 |
| `page-processing` | 处理等待 | 加载动画 |
| `page-event-result` | 事件结果 | 故事 + 图片 + 3D 预览 |
| `page-story-complete` | 故事结束 | 完整旅程回顾 |

### 3D 预览

事件结果页面有两个 3D 预览窗口（由 `dual-viewer.js` 控制）：
- **左边**：真实物体的 3D 模型（从你的照片生成）
- **右边**：虚构物体的 3D 模型（从 AI 图像生成）

用户可以：
- 拖拽旋转模型
- 双指/滚轮缩放
- 点击全屏查看

### AR 启动

`ar-launcher.js` 负责把用户送到 AR 体验：

- **`launchAR('photo')`** → 打开 `/ar/viewer/`，单独查看真实物体 3D
- **`launchAR('fictional')`** → 打开 `/ar/viewer/`，单独查看虚构物体 3D
- **`launchARInteraction()`** → 打开 `/ar/tap/`、`/ar/rotate/` 或 `/ar/track/`，两个物体互动

---

## 文件详解

### index.html — 🏗️ 建筑蓝图

整个应用的 HTML 结构。所有页面都写在这一个文件里（单页应用 SPA 模式），通过 CSS 的 `display: none` 和 JavaScript 控制显示哪一页。

**重要区域：**
- 第 31-85 行：登录/注册页面
- 第 551 行：AR Photo Model 按钮 → `launchAR('photo')`
- 第 568 行：AR Fictional Model 按钮 → `launchAR('fictional')`
- 第 589 行：AR Interaction 按钮 → `launchARInteraction()`

### style.css — 🎨 装修方案

所有视觉效果：颜色、字体、动画、响应式布局。使用 CSS 变量方便统一调整主题色。

### app.js — 🧰 工具箱

提供通用工具函数：
- `$()` / `$$()` — 简化的 DOM 选择器（类似 jQuery）
- `show()` / `hide()` — 显示/隐藏元素
- `apiFetch()` — 统一的 API 请求封装
- `isTestMode()` — 检测是否在测试模式下
- `PollingManager` — 轮询管理器（用于等待 3D 生成完成）

### config.js — ⚙️ 遥控器设置

```javascript
CONFIG = {
  API_BASE_URL: "",              // API 地址（空 = 使用当前域名）
  OPENAI_API_BASE_URL: "",       // OpenAI API 代理地址（空 = 使用后端转发）
  POLLING_INTERVAL: 2000,        // 每 2 秒检查一次任务状态
  MAX_POLLING_ATTEMPTS: 300,     // 最多检查 300 次（10 分钟）
  PHOTOS_PER_STORY: 3,           // 每个故事拍 3 张照片
  API_TIMEOUT: 30000,            // API 请求超时（30 秒）
  SKIP_3D_GENERATION: false,     // 设为 true 可跳过 3D 生成（测试用）
  DEBUG: true,                   // 显示调试日志
}
```

同时导出了 `Logger` 工具（包含 `log`、`error`、`warn` 方法），供其他模块统一输出调试信息。

### js/story.js — 🎬 导演

这是最大的前端文件（4406 行），控制整个故事流程：

1. 初始化页面状态机
2. 处理用户交互（点击、拍照、滑动）
3. 调用 `story-api.js` 与后端通信
4. 管理 3D 模型的加载和展示
5. 控制页面之间的切换和动画

### js/story-api.js — 📡 无线电

负责与后端 API 通信，封装了所有 HTTP 请求：

- `startJourney()` — 告诉后端"开始新故事"
- `feedbackStory()` — 告诉后端"我喜欢/不喜欢这个故事"
- `processFullPhotoEvent()` — 发送照片，获取事件 + 3D 模型

包含六个幻想世界的显示名称和图标。

### js/dual-viewer.js — 🖼️ 双联画框

使用 Three.js 渲染 3D 模型：
- `DualViewer` — 并排显示两个 3D 模型
- `FullscreenViewer` — 全屏查看单个模型
- `MiniViewer` — 小窗口预览

### js/ar-launcher.js — 🚀 发射台

AR 体验的启动器。两种模式：
- **单模型查看** → `/ar/viewer/?model=URL&name=Name`
- **双模型互动** → `/ar/tap/`（或 rotate、track），携带两个模型的 URL

### js/gpu-manager.js — 📊 仪表盘

GPU 状态监控，每 10 秒刷新一次。显示：
- 有多少 GPU 可用
- 当前是并行还是顺序模式
- 可以切换模式

### js/ambient-sound.js — 🔊 背景音乐

程序化环境音效引擎（252 行），使用 Web Audio API 生成背景音效：
- 根据不同幻想世界类型生成对应的环境音
- 使用振荡器和滤波噪声合成，无需外部音频文件
- 支持淡入/淡出和静音切换

---

## AR 体验目录

`ar/` 文件夹包含四个独立的 AR 项目（从 8thWall 迁移而来）：

| 目录 | 路由 | 功能 | 说明 |
|------|------|------|------|
| `ar/tap/` | `/ar/tap/` | 点击互动 | 两个 3D 物体，点击触发动画 |
| `ar/rotate/` | `/ar/rotate/` | 旋转互动 | 旋转物体发现故事线索 |
| `ar/track/` | `/ar/track/` | 追踪互动 | 镜头跟随移动的 3D 物体 |
| `ar/viewer/` | `/ar/viewer/` | 单模型预览 | 查看单个 3D 模型 |

每个 AR 项目包含：
- `index.html` — 入口页面
- `bundle.js` — webpack 打包后的 JavaScript
- `external/` — 8thWall AR SDK 文件（自托管）

---

## 技术栈

| 技术 | 用途 |
|------|------|
| HTML/CSS/JS | 原生网页技术，无前端框架 |
| Three.js | 3D 模型渲染和预览 |
| A-Frame | AR 场景构建（8thWall SDK 的基础） |
| 8thWall XR | AR 相机追踪和场景叠加 |
| ES Modules | JavaScript 模块化（import/export） |
| importmap | 在 `index.html` 中映射 Three.js CDN |

---

## 如果我想修改……

| 我想要…… | 去哪里改 |
|----------|---------|
| 改页面文字或布局 | `index.html` |
| 改颜色、字体、动画 | `style.css` |
| 改故事流程逻辑 | `js/story.js` |
| 改 API 调用方式 | `js/story-api.js` |
| 改 3D 预览效果 | `js/dual-viewer.js` |
| 改 AR 启动逻辑 | `js/ar-launcher.js` |
| 改每个故事的照片数量 | `config.js` 的 `PHOTOS_PER_STORY` |
| 跳过 3D 生成（测试用） | `config.js` 的 `SKIP_3D_GENERATION` 设为 `true` |
| 添加新页面 | `index.html` 加 `<section>`，`story.js` 加页面切换逻辑 |

---

_最后更新：2026年3月_
