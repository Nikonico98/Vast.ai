# Backend — Server-Side Application
# 后端 — 服务端应用

> **EN:** This folder is the "kitchen" of the whole app — it handles all business logic, AI calls, 3D job dispatching, and data management. Runs on **Hostinger VPS** with Python + Flask + Gunicorn. No GPU needed on this machine.
>
> **中文：** 这个文件夹是整个应用的「厨房」——处理所有业务逻辑、AI 调用、3D 任务分发和数据管理。运行在 **Hostinger VPS** 上，使用 Python + Flask + Gunicorn。这台机器不需要 GPU。

---

## What This Folder Does / 这个文件夹做了什么

| # | Responsibility / 职责 | How / 怎么做 |
|---|---|---|
| 1 | **Receive frontend requests** / 接收前端请求 | Flask API routes handle login, start story, upload photo, etc. / Flask API 路由处理登录、开始故事、上传照片等 |
| 2 | **Talk to AI** / 跟 AI 说话 | Calls OpenAI (story generation & photo analysis) and Luma AI (fictional image generation with retry + placeholder fallback) / 调用 OpenAI（故事生成和照片分析）和 Luma AI（虚构图片生成，带重试 + 占位图兜底） |
| 3 | **Dispatch 3D jobs to GPU** / 派 3D 工作给 GPU | Sends images to Vast.ai GPU worker via HTTP for 3D model generation / 通过 HTTP 将图片发送到 Vast.ai GPU 工作站生成 3D 模型 |
| 4 | **Manage user data** / 管理用户数据 | SQLite for accounts, filesystem for photos/models/journeys / SQLite 存账号，文件系统存照片/模型/旅程 |

---

## Tech Stack / 技术栈

| Technology / 技术 | Purpose / 用途 |
|---|---|
| Python 3 + Flask | Web framework / Web 框架 |
| Gunicorn | Production WSGI server / 生产环境 WSGI 服务器 |
| SQLite | User accounts & story database / 用户账号和故事数据库 |
| OpenAI API (GPT-5.2) | Story generation & photo analysis (vision) / 故事生成和照片分析（视觉） |
| Luma AI API (Photon-1) | Fictional image generation / 虚构图片生成 |
| Vast.ai GPU (HTTP) | Remote 3D model generation / 远程 3D 模型生成 |
| Pillow | Image compression + placeholder image generation / 图片压缩 + 占位图生成 |

---

## File Guide / 文件说明

| File / 文件 | When to use / 什么时候用 | Description / 说明 |
|:------------|:------------------------|:-------------------|
| `app.py` | 🏪 **Main entry point** / 主入口 | The "reception desk" — all 42 API routes live here. Handles auth, story flow, photo events, 3D job creation, file serving, AR routing, and test mode. / 「前台接待」——所有 42 个 API 路由都在这里。处理认证、故事流程、照片事件、3D 任务创建、文件服务、AR 路由和测试模式。 |
| `config.py` | ⚙️ **Settings** / 配置 | All configuration in one place — API keys, model names, directory paths, temperature, fallback values. Reads from `.env` file. Includes **Vast.ai auto-discovery**: automatically finds running GPU instances by label and resolves their public IP + port via Vast.ai API (with health-check validation and 5-minute cache). / 所有配置集中管理——API 密钥、模型名称、目录路径、温度、兜底值。从 `.env` 文件读取。包含 **Vast.ai 自动发现**：根据 label 自动查找运行中的 GPU 实例，通过 Vast.ai API 解析公网 IP + 端口（带健康检查验证和 5 分钟缓存）。 |
| `ai_service.py` | 🤖 **AI integration** / AI 集成 | Communicates with OpenAI (chat, vision, story, event generation) and Luma AI (fictional image generation). Includes **retry with backoff** (3 attempts, 3s/6s delays) and **placeholder image fallback** using Pillow. Tracks image source as `"luma"` or `"placeholder"`. / 与 OpenAI（聊天、视觉、故事、事件生成）和 Luma AI（虚构图片生成）通信。包含**带退避的重试**（3 次尝试，3s/6s 延迟）和 Pillow **占位图兜底**。追踪图片来源为 `"luma"` 或 `"placeholder"`。 |
| `gpu_client.py` | 📡 **GPU worker client** / GPU 客户端 | HTTP client for Vast.ai GPU worker — submits images for 3D generation, polls status, downloads .glb results. Full pipeline: submit → poll → download. / Vast.ai GPU 工作站的 HTTP 客户端——提交图片生成 3D、轮询状态、下载 .glb 结果。完整流水线：提交 → 轮询 → 下载。 |
| `database.py` | 🗄️ **Database** / 数据库 | SQLite user accounts (`users` table) and story records (`stories` table). Handles registration, login verification, story CRUD. / SQLite 用户账号（`users` 表）和故事记录（`stories` 表）。处理注册、登录验证、故事增删改查。 |
| `job_manager.py` | 📋 **Job tracking** / 任务追踪 | Thread-safe 3D job queue using `jobs.json`. Creates jobs, updates status (queued → processing → completed/failed), provides status for frontend polling. Also provides the `log()` utility used everywhere. / 使用 `jobs.json` 的线程安全 3D 任务队列。创建任务、更新状态、提供前端轮询的状态接口。也提供全系统使用的 `log()` 工具函数。 |
| `user_manager.py` | 📁 **User folders** / 用户文件夹 | Manages user folder structure — creates directories for photos, cutouts, fictional images, 3D models. Handles both new format (`{username}/{WorldType}/{timestamp}/`) and legacy format (`user_N/`). / 管理用户文件夹结构——创建照片、裁切图、虚构图片、3D 模型的目录。同时处理新格式和旧格式。 |
| `glb_processor.py` | 🔧 **3D post-processing** / 3D 后处理 | GLB model post-processing and placeholder GLB generation (creates a minimal cube when GPU fails). / GLB 模型后处理和占位 GLB 生成（GPU 失败时创建一个最小立方体）。 |
| `passenger_wsgi.py` | 🚪 **Alternate entry** / 备用入口 | WSGI entry point for Hostinger shared hosting (Phusion Passenger). Not used with Gunicorn. / Hostinger 共享主机的 WSGI 入口（Phusion Passenger）。使用 Gunicorn 时不需要。 |
| `start.sh` | ▶️ **Every time** / 每次启动 | One-click start script — creates venv if needed, installs dependencies, starts Gunicorn with 4 workers on port 5000. / 一键启动脚本——按需创建 venv，安装依赖，启动 4 个 worker 的 Gunicorn 监听 5000 端口。 |
| `requirements.txt` | 📦 **Dependencies** / 依赖 | Python package list — Flask, gunicorn, openai, requests, Pillow, python-dotenv, etc. / Python 包清单。 |

---

## API Routes / API 路由

### Core Story Flow / 核心故事流程

| Function / 功能 | Method | Route / 路由 | Description / 说明 |
|---|---|---|---|
| Start journey / 开始旅程 | POST | `/api/start` | Accepts world type, generates opening story via OpenAI. Creates journey record. / 接收世界类型，通过 OpenAI 生成开场故事。创建旅程记录。 |
| Photo event / 照片事件 | POST | `/api/photo_event` | Accepts photo upload + journey_id. AI analyzes photo → generates event → generates fictional image (Luma, with retry) → dispatches two 3D jobs to GPU (parallel). / 接收照片上传 + journey_id。AI 分析照片 → 生成事件 → 生成虚构图片（Luma，带重试）→ 分派两个 3D 任务到 GPU（并行）。 |
| Story feedback / 故事反馈 | POST | `/api/feedback` | Accepts user feedback on events for AI context. / 接收用户对事件的反馈供 AI 参考。 |
| 3D job status / 3D 任务状态 | POST | `/api/process` | Check status of 3D generation jobs. Frontend polls this. / 查询 3D 生成任务状态。前端轮询此接口。 |

### Auth / 认证

| Function / 功能 | Method | Route / 路由 |
|---|---|---|
| Register / 注册 | POST | `/api/auth/register` |
| Login / 登录 | POST | `/api/auth/login` |
| Logout / 登出 | POST | `/api/auth/logout` |
| Current user / 当前用户 | GET | `/api/auth/me` |
| Guest login / 访客登录 | POST | `/api/auth/guest` |

### Story Management / 故事管理

| Function / 功能 | Method | Route / 路由 |
|---|---|---|
| List stories / 列出故事 | GET | `/api/stories` |
| Get story detail / 故事详情 | GET | `/api/stories/<journey_id>` |
| Translate text / 翻译文本 | POST | `/api/translate` |
| DB stats / 数据库统计 | GET | `/api/db-stats` |

### GPU Management / GPU 管理

| Function / 功能 | Method | Route / 路由 |
|---|---|---|
| GPU worker health / GPU 健康状态 | GET | `/api/gpu/status` |
| Set GPU mode / 设置 GPU 模式 | POST | `/api/gpu/mode` |
| Vast.ai instance status / 实例状态 | GET | `/api/gpu/instance/status` |
| Start instance / 启动实例 | POST | `/api/gpu/instance/start` |
| Stop instance / 停止实例 | POST | `/api/gpu/instance/stop` |
| Service status / 服务状态 | GET | `/api/gpu/services/status` |
| Restart services / 重启服务 | POST | `/api/gpu/services/restart` |

### Debug & Admin / 调试和管理

| Function / 功能 | Method | Route / 路由 |
|---|---|---|
| Health check / 健康检查 | GET | `/health` |
| Env status / 环境状态 | GET | `/api/env-status` |
| Reload AI template / 重载 AI 模板 | POST | `/api/reload-template` |
| Template status / 模板状态 | GET | `/api/template-status` |
| Test AI / 测试 AI | GET | `/api/test-ai` |
| Test DB / 测试数据库 | GET | `/api/debug/test-db` |
| List all routes / 列出所有路由 | GET | `/debug/routes` |

### File Serving & AR / 文件服务和 AR

| Function / 功能 | Route / 路由 |
|---|---|
| Frontend SPA / 前端单页应用 | `/` |
| Test mode / 测试模式 | `/test`, `/test/` |
| Result files / 结果文件 | `/results/<filename>` |
| User files / 用户文件 | `/user/<path>` |
| AR Tap / AR 点击 | `/ar/tap/`, `/ar/tap/<filename>` |
| AR Rotate / AR 旋转 | `/ar/rotate/`, `/ar/rotate/<filename>` |
| AR Track / AR 追踪 | `/ar/track/`, `/ar/track/<filename>` |
| AR Viewer / AR 查看器 | `/ar/viewer/`, `/ar/viewer/<filename>` |

---

## Environment Variables / 环境变量

Create a `.env` file in this folder:

在这个文件夹下创建 `.env` 文件：

```env
# OpenAI (story generation & photo analysis / 故事生成和照片分析)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-5.2
OPENAI_TEMPERATURE=0.5

# Luma AI (fictional image generation / 虚构图片生成)
LUMA_API_KEY=luma-xxxxxxxxxxxxxxxxxxxx
LUMA_MODEL=photon-1

# Vast.ai GPU (auto-discovery) / GPU 工作站（自动发现）
VASTAI_API_KEY=xxxxxxxxxxxxxxxxxxxx
VASTAI_INSTANCE_LABEL=Eric,Niko          # Match running instances by label / 根据 label 匹配运行中的实例
VASTAI_GPU_CONTAINER_PORT=1111            # Container port: socat → GPU service / 容器端口：socat → GPU 服务
# Leave empty for auto-discovery, or set manually to override / 留空自动发现，或手动设置覆盖:
VASTAI_GPU_URL=
VASTAI_INSTANCE_ID=
GPU_API_SECRET=my-super-secret-key-123

# Flask session secret / Flask 会话密钥
SECRET_KEY=another-random-secret
```

> ⚠️ **NEVER commit `.env` to Git!** / **绝对不要把 `.env` 提交到 Git！**

---

## How to Start / 如何启动

```bash
cd backend

# Method 1: Use start script (recommended) / 方法 1：启动脚本（推荐）
bash start.sh

# Method 2: Manual start / 方法 2：手动启动
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
gunicorn -w 4 -b 0.0.0.0:5000 --timeout 120 app:app
```

---

## Core Flow Diagram / 核心流程图

```
User takes photo / 用户拍照
    │
    ▼
app.py /api/photo_event receives photo
    │
    ├──→ ai_service.py → OpenAI (vision): analyze photo → identify place & item
    │                     分析照片 → 识别场景和物品
    │
    ├──→ ai_service.py → OpenAI (chat): generate story event from photo analysis
    │                     根据照片分析生成剧情事件
    │
    ├──→ ai_service.py → Luma AI: generate fictional image
    │    │                 生成虚构图片
    │    ├─ Attempt 1: modify_image_ref mode (uses photo as reference)
    │    │              尝试 1：修改图片参考模式（用照片作参考）
    │    ├─ Attempt 2: retry with backoff (3s delay)
    │    │              尝试 2：退避重试（延迟 3s）
    │    ├─ Attempt 3: downgrade to text-to-image mode (6s delay)
    │    │              尝试 3：降级为纯文本生成模式（延迟 6s）
    │    └─ Fallback: generate placeholder image with Pillow
    │                  兜底：用 Pillow 生成占位图
    │
    └──→ gpu_client.py → Vast.ai GPU (2 parallel threads):
         │                两个并行线程：
         ├─ Thread 1: photo → 3D model (real_3d/)
         │             照片 → 3D 模型
         └─ Thread 2: fictional image → 3D model (fictional_3d/)
                       虚构图片 → 3D 模型
    │
    ▼
Results saved to user folder (user_manager.py)
结果保存到用户文件夹
    │
    ▼
Frontend polls /api/process for job status (job_manager.py)
前端轮询任务状态
```

---

## Fictional Image Fallback System / 虚构图片兜底系统

The `generate_fictional_image()` function in `ai_service.py` has a multi-layer fallback:

`ai_service.py` 中的 `generate_fictional_image()` 函数有多层兜底：

| Layer / 层级 | What happens / 发生了什么 | Source field / 来源字段 |
|---|---|---|
| **Attempt 1** | Luma AI with `modify_image_ref` (preserves photo camera angle) / 使用 `modify_image_ref` 保持照片视角 | `"luma"` |
| **Attempt 2** | Retry after 3s delay (same mode) / 3s 延迟后重试（相同模式） | `"luma"` |
| **Attempt 3** | Downgrade to text-to-image, retry after 6s / 降级为纯文本模式，6s 延迟后重试 | `"luma"` |
| **Fallback** | Generate 512×512 placeholder image with Pillow (world-colored background + item name text) / 用 Pillow 生成 512×512 占位图（世界主题色背景 + 物品名文字） | `"placeholder"` |

The `fictional_image_source` field in `journey.json` events tracks which layer produced the image.

`journey.json` 事件中的 `fictional_image_source` 字段追踪图片来自哪一层。

**Error classification** / 错误分类：
- **Transient** (retryable / 可重试): HTTP 429/500/502/503/504, timeouts, network errors, polling timeout
- **Permanent** (no retry / 不重试): Content policy violations, missing generation ID, completed but no image URL

---

## Troubleshooting / 故障排除

**Q: Story not generating? / 故事没生成？**
A: Check `OPENAI_API_KEY` in `.env`, confirm OpenAI account has credits.
检查 `.env` 中的 `OPENAI_API_KEY`，确认 OpenAI 账户有余额。

**Q: Fictional image shows placeholder? / 虚构图片显示占位图？**
A: Check `LUMA_API_KEY` and Luma AI account quota. Check server logs for `[LUMA]` entries to see which error occurred (transient vs permanent). The `fictional_image_source` field in journey.json will show `"placeholder"` when fallback was used.
检查 `LUMA_API_KEY` 和 Luma AI 账户配额。查看服务器日志中的 `[LUMA]` 条目了解发生了什么错误。journey.json 中的 `fictional_image_source` 字段会显示 `"placeholder"`。

**Q: 3D model stuck loading? / 3D 模型一直加载？**
A: Vast.ai GPU may be off. The system auto-discovers GPU instances by label — make sure your Vast.ai instance label matches `VASTAI_INSTANCE_LABEL` in `.env` (default: `Eric,Niko`). If multiple instances share the same label, the system verifies each with a health check and picks the first healthy one. Check `/api/gpu/status` to verify connectivity.
Vast.ai GPU 可能没开。系统会根据 label 自动发现 GPU 实例——确保 Vast.ai 实例的 label 与 `.env` 中的 `VASTAI_INSTANCE_LABEL` 一致（默认：`Eric,Niko`）。如果多个实例使用相同 label，系统会逐个进行健康检查，选出第一个健康的。检查 `/api/gpu/status` 验证连接。

**Q: Switched to a new GPU instance? / 换了新的 GPU 实例？**
A: No config changes needed! As long as the new instance's label in Vast.ai matches `VASTAI_INSTANCE_LABEL`, the system auto-discovers the new IP and port within 5 minutes (cache TTL). To force immediate refresh, restart the backend.
不需要改任何配置！只要新实例在 Vast.ai 上的 label 与 `VASTAI_INSTANCE_LABEL` 一致，系统会在 5 分钟内（缓存 TTL）自动发现新的 IP 和端口。要立即刷新，重启后端即可。

**Q: Want to change AI personality? / 想改 AI 风格？**
A: Edit `templates/prompt.md` — no server restart needed. The backend auto-reloads on each API call.
编辑 `templates/prompt.md`——不需要重启。后端每次 API 调用时自动重载。

**Q: How to test without affecting real users? / 怎么测试不影响真实用户？**
A: Visit `/test` or add `?test=1` — all data goes to `data_test/` instead of `data/`.
访问 `/test` 或加 `?test=1`——所有数据写到 `data_test/`。

---

_Last updated / 最后更新: 2026-04-11_
