# Imaginary World — Project Overview
# 奇幻世界 — 项目总览

> **EN:** A photo-to-story-to-3D-to-AR creative experience. Users take a photo of any real-world object; the system generates a fantasy story, a fictional image, two 3D models, and an interactive AR experience — all automatically.
>
> **中文：** 一个从照片到故事再到 3D 和 AR 的创意体验。用户拍一张任何现实物品的照片，系统自动生成奇幻故事、虚构图片、两个 3D 模型和互动 AR 体验。

---

## System Architecture / 系统架构

Three "machines" work together — remember these and you understand the whole system:

三台「机器」协同工作——记住这三台就理解了整个系统：

```
User's Phone Browser / 用户手机浏览器
      │
      │  (ask for story, upload photo / 请求故事、上传照片)
      ▼
┌─────────────────────────────┐
│  Hostinger VPS (Main Server)│  ← Cheap cloud VPS / 便宜的云主机
│  - Auth / Story / Images    │     Handles login, story, images
│  - No GPU needed            │     不需要 GPU
└──────────────┬──────────────┘
               │  (only for 3D generation / 只在生成 3D 时调用)
               ▼
┌─────────────────────────────┐
│  Vast.ai (GPU Worker)       │  ← Auto-discovered by label / 按 label 自动发现
│  - Photo → 3D model         │     Connects via public IP + port (no manual URL)
│  - Requires GPU              │     需要 GPU，按 label 自动查找 IP 和端口
└─────────────────────────────┘
               +
┌─────────────────────────────┐
│  OpenAI API (GPT-5.2)       │  ← Story generation & photo analysis
│  Luma AI API (Photon-1)     │  ← Fictional image generation
└─────────────────────────────┘
```

---

## Full User Journey (9 Steps) / 完整用户体验流程（9 步）

```
1. Open website → Login or Register
   打开网页 → 登录/注册账号
         ↓
2. Choose a "world type" (6 options: Historical, Overlaid, Alternate, SciFi_Earth, SciFi_Galaxy, Fantasy)
   选择「世界类型」（6 种：历史、叠加、平行、地球科幻、银河科幻、奇幻）
         ↓
3. AI generates an opening story
   AI 生成一段开场故事
         ↓
4. User takes or uploads a photo (any real-world object)
   用户拍照或上传一张照片（任何现实物品都可以）
         ↓
5. AI analyzes photo → identifies object → generates a story event related to the photo
   AI 分析照片 → 识别物品 → 生成与照片相关的剧情事件
         ↓
6. AI generates a "fictional item" image via Luma AI (with retry + placeholder fallback)
   AI 通过 Luma AI 生成「虚构物品」图片（带重试 + 占位图兜底）
         ↓
7. Backend sends both images to Vast.ai GPU → generates two 3D models (.glb files)
   后端把两张图都送去 Vast.ai GPU → 生成两个 3D 模型（.glb 文件）
         ↓
8. User rotates and views both models in the web 3D Viewer
   用户在网页 3D 查看器中旋转查看两个模型
         ↓
9. Tap "AR" → phone camera opens → 3D models overlaid on the real world
   点击「AR」→ 手机镜头打开 → 3D 模型叠加到现实世界
```

**Repeat steps 4–9 three times** to complete a full story arc (3 events per journey).

**重复第 4–9 步三次**完成完整故事弧线（每次旅程 3 个事件）。

---

## Folder Structure / 目录结构

```
imaginaryworld/
├── README.md                ← You are here / 你在这里
│
├── backend/                 ← Server-side Python code / 后端 Python 代码
│   ├── app.py               ← Main app, all API routes / 主程序，所有 API 路由
│   ├── config.py            ← All settings in one place / 集中配置
│   ├── ai_service.py        ← OpenAI + Luma AI integration / AI 服务集成
│   ├── gpu_client.py        ← Vast.ai GPU HTTP client / GPU 客户端
│   ├── database.py          ← SQLite database / 数据库
│   ├── job_manager.py       ← 3D job queue & status / 3D 任务管理
│   ├── user_manager.py      ← User folder management / 用户文件夹管理
│   ├── glb_processor.py     ← 3D model post-processing / 3D 模型后处理
│   ├── requirements.txt     ← Python dependencies / Python 依赖
│   ├── start.sh             ← One-click start script / 一键启动
│   └── templates/
│       └── prompt.md        ← ⭐ AI system prompt — edit to change personality
│                                AI 提示词——改这里换风格
│
├── frontend/                ← User-facing web pages / 用户界面
│   ├── index.html           ← Single Page Application / 单页应用
│   ├── style.css            ← All styles & animations / 样式和动画
│   ├── app.js               ← Shared utilities & init / 工具函数和初始化
│   ├── config.js            ← Frontend config / 前端配置
│   ├── viewer3d.js          ← Three.js 3D model viewer / 3D 模型查看器
│   ├── js/                  ← Frontend logic modules / 前端逻辑模块
│   │   ├── story.js         ← Story flow state machine (most complex) / 故事流程状态机
│   │   ├── story-api.js     ← Backend API wrappers / 后端 API 封装
│   │   ├── dual-viewer.js   ← Dual 3D model side-by-side preview / 双模型并排预览
│   │   ├── ar-launcher.js   ← AR experience launcher & URL builder / AR 启动器
│   │   ├── gpu-manager.js   ← GPU status panel / GPU 状态面板
│   │   └── ambient-sound.js ← Background sound engine / 背景音效引擎
│   └── ar/                  ← AR experience pages (pre-built) / AR 体验页面
│       ├── tap/             ← Tap interaction / 点击互动
│       ├── rotate/          ← Rotate interaction / 旋转互动
│       ├── track/           ← Track interaction / 追踪互动
│       └── viewer/          ← Single model AR viewer / 单模型 AR 查看器
│
├── data/                    ← Runtime data (NOT in Git) / 运行时数据（不入 Git）
│   ├── users.db             ← SQLite DB / 数据库
│   ├── jobs.json            ← 3D job queue / 任务队列
│   ├── journeys/            ← Journey JSON backups / 旅程备份
│   ├── {username}/          ← Registered user data / 注册用户数据
│   ├── guest_N/             ← Guest user data / 访客数据
│   └── user_N/              ← Legacy user folders / 旧版用户文件夹
│
└── test/                    ← Test scripts / 测试脚本
    └── test.py              ← Placeholder / 占位
```

---

## How to Run / 如何启动

```bash
cd backend

# Method 1: Use start script (recommended) / 方法 1：使用启动脚本（推荐）
bash start.sh

# Method 2: Manual start / 方法 2：手动启动
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
gunicorn -w 4 -b 0.0.0.0:5000 --timeout 120 app:app
```

---

## Environment Variables / 环境变量

Create a `.env` file in `backend/`:

在 `backend/` 下创建 `.env` 文件：

```env
# OpenAI (story generation & photo analysis / 故事生成和照片分析)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-5.2

# Luma AI (fictional image generation / 虚构图片生成)
LUMA_API_KEY=luma-xxxxxxxxxxxxxxxxxxxx

# Vast.ai GPU (auto-discovers URL & instance by label / 根据 label 自动发现 URL 和实例)
VASTAI_API_KEY=xxxxxxxxxxxxxxxxxxxx
VASTAI_INSTANCE_LABEL=Eric,Niko
# Leave both empty for full auto-discovery / 留空即全自动发现:
VASTAI_GPU_URL=
VASTAI_INSTANCE_ID=

# Shared secret between servers / 两台服务器之间的通信密钥
GPU_API_SECRET=my-super-secret-key-123

# Flask session secret / Flask 会话密钥
SECRET_KEY=another-random-secret
```

> ⚠️ **NEVER commit `.env` to Git!** / **绝对不要把 `.env` 提交到 Git！**

---

## Core Data Flow / 核心数据流

```
User takes photo / 用户拍照
    │
    ▼
app.py receives photo / 接收照片
    │
    ├──→ ai_service.py → OpenAI: analyze photo → generate story event
    │                     分析照片 → 生成剧情事件
    │
    ├──→ ai_service.py → Luma AI: generate fictional image (retry + placeholder fallback)
    │                     生成虚构图片（带重试 + 占位图兜底）
    │
    └──→ gpu_client.py → Vast.ai: generate 3D models (photo + fictional, in parallel)
         生成 3D 模型（照片 + 虚构，并行处理）
    │
    ▼
Results saved to user folder (managed by user_manager.py)
结果保存到用户文件夹（由 user_manager.py 管理）
    │
    ▼
Frontend polls job status (tracked by job_manager.py)
前端轮询任务状态（由 job_manager.py 追踪）
```

---

## Reading Order for New Developers / 新开发者阅读顺序

1. **This file** — get the big picture / 读这份文件了解全局
2. **`backend/README.md`** — understand backend flow, API routes, tech stack / 了解后端流程
3. **`backend/templates/README.md`** — understand how AI behavior is configured / 了解 AI 行为配置
4. **`frontend/README.md`** — understand frontend state machine and page flow / 了解前端状态机
5. **`frontend/js/Readme.md`** — understand frontend module responsibilities / 了解前端模块分工
6. **`data/README.md`** — understand data storage layout / 了解数据存储结构

---

## Troubleshooting / 故障排除

**Q: Story not generating? / 故事没生成？**
A: Check `OPENAI_API_KEY` in `.env`, confirm OpenAI account has credits.
检查 `.env` 中的 `OPENAI_API_KEY`，确认 OpenAI 账户有余额。

**Q: Fictional image missing? / 虚构图片缺失？**
A: Check `LUMA_API_KEY`. If Luma fails, the system now generates a placeholder image automatically (see `fictional_image_source` field in journey.json).
检查 `LUMA_API_KEY`。如果 Luma 失败，系统现在会自动生成占位图（查看 journey.json 中的 `fictional_image_source` 字段）。

**Q: 3D model stuck loading? / 3D 模型一直加载？**
A: Vast.ai GPU may be off. The system auto-discovers GPU instances by label — make sure your Vast.ai instance label matches `VASTAI_INSTANCE_LABEL` in `.env` (default: `Eric,Niko`). Check `/api/gpu/status` to verify connectivity.
Vast.ai GPU 可能没开。系统会根据 label 自动发现 GPU 实例——确保 Vast.ai 实例的 label 与 `.env` 中的 `VASTAI_INSTANCE_LABEL` 一致（默认：`Eric,Niko`）。检查 `/api/gpu/status` 验证连接。

**Q: Want to change AI personality? / 想改 AI 风格？**
A: Edit `backend/templates/prompt.md` — no server restart needed.
编辑 `backend/templates/prompt.md`——不需要重启服务器。

**Q: Test without affecting real users? / 测试时不影响真实用户？**
A: Visit `/test` or add `?test=1` — all data goes to `data_test/` instead.
访问 `/test` 或加 `?test=1`——所有数据会写到 `data_test/`。

---

_Last updated / 最后更新: 2026-04-11_
