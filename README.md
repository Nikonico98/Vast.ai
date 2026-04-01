# ImaginaryWorld Vast.ai — GPU 3D Model Generation Service
# 想象世界 Vast.ai — GPU 3D 模型生成服务

> **EN:** This is the **GPU backend** of ImaginaryWorld. Its only job: **receive a photo → cut out the object → sculpt it into a 3D model → send it back**.
>
> **中文：** 这是「想象世界」的 **GPU 后端**。它的工作很单纯：**收到一张照片 → 抠出物体 → 捏成 3D 模型 → 交回去**。

---

## One-sentence summary / 一句话理解这个项目

**EN:** The Hostinger website is the "storefront + brain"; **this is the "3D sculpture workshop"**.

**中文：** Hostinger 那边的网站是"门面 + 大脑"，**这里是"3D 雕塑工坊"**。

User takes a photo on the website → website sends the photo over the internet to this GPU server → GPU server uses AI to turn the photo into a 3D model (`.glb` file) → website downloads the model → shows it to the user.

用户在网站上拍照 → 网站把照片通过网络发到这个 GPU 服务器 → GPU 服务器用 AI 把照片做成 3D 模型（`.glb` 文件）→ 网站下载模型 → 展示给用户看。

Like outsourcing: the website takes the order, **but the sculpting work is outsourced to this GPU workshop**.

就像外包：网站接到客户需求，**但雕塑的活儿外包给了这个 GPU 工坊**。

---

## How the workshop works (full pipeline) / 工坊工作流程（完整版）

```
Hostinger website sends a photo + a prompt (e.g. "cup")
Hostinger 网站发来一张照片 + 一个描述词（比如 "cup"）
              │
              ▼
   ┌──────────────────────────┐
   │  1. Reception Desk       │  gpu_app.py
   │     前台接待              │  Receives HTTP request, assigns a job_id
   │  Receives photo,         │  接收 HTTP 请求，分配一个「任务编号」（job_id）
   │  registers the job,      │  立刻回复网站，不让网站干等
   │  replies immediately     │
   └────────┬─────────────────┘
            │ (background work begins / 后台开始干活)
            ▼
   ┌──────────────────────────┐
   │  2. Dispatch Room        │  gpu_pool.py + pipeline_3d.py
   │     调度室                │  Routes job to the right GPU:
   │  Which GPU is free?      │  把任务分配到对应 GPU：
   │  Photo jobs → GPU 0      │  Photo 任务 → GPU 0
   │  Fictional jobs → GPU 1  │  Fictional 任务 → GPU 1
   └────────┬─────────────────┘
            ▼
   ┌──────────────────────────┐
   │  3. Silhouette Cutter    │  sam3_server.py (persistent HTTP server)
   │     剪影师（SAM3）        │  Cuts out the object from the background
   │  Removes the background  │  AI 识别照片中的物品，生成一张
   │                          │  去掉背景的透明底图（cutout.png）
   └────────┬─────────────────┘
            ▼
   ┌──────────────────────────┐
   │  4. Sculptor (SAM3D)     │  sam3d_server.py (persistent HTTP server)
   │     雕塑家（SAM3D）       │  Turns 2D cutout into 3D model
   │  Creates a 3D model      │  AI 根据 2D 图片推测立体形状
   │  from the 2D cutout      │  输出 .glb 3D 文件
   └────────┬─────────────────┘
            ▼
   ┌──────────────────────────┐
   │  5. Refinisher           │  glb_processor.py
   │     精修师                │  ① Recenters model (feet on ground)
   │  Fixes small issues      │  ② Adds PBR materials for good lighting
   │  修正模型的小问题         │
   └────────┬─────────────────┘
            ▼
   ┌──────────────────────────┐
   │  6. Delivery             │  gpu_app.py
   │     交货                  │  Website polls "ready yet?" and downloads
   │  Website downloads .glb  │  网站反复问"做好了吗？"，做好了就传回去
   └──────────────────────────┘
```

**The website can check progress at any time** (like tracking a package):
`queued` → `processing` → `completed` or `failed`

**整个过程中，网站可以随时查进度**（就像查快递）：
`排队中 queued` → `处理中 processing` → `完成 completed` 或 `失败 failed`

---

## Dual-GPU Architecture (V2) / 双 GPU 架构（V2 版）

**EN:** This system uses **2 GPUs working in parallel**. Each photo event generates TWO 3D models (one real + one fictional). With 2 GPUs, both are processed simultaneously (~52 seconds total instead of ~104 seconds).

**中文：** 本系统使用 **2 张 GPU 并行工作**。每次拍照事件会生成两个 3D 模型（一个真实 + 一个虚构）。用两张 GPU 可以同时处理（总共约 52 秒，而不是约 104 秒）。

| GPU | Role / 角色 | SAM3 Port | SAM3D Port | Processes / 处理内容 |
|:----|:------------|:----------|:-----------|:--------------------|
| GPU 0 | Real items / 真实物品 | 5561 | 5562 | User's real photos / 用户拍的真实照片 |
| GPU 1 | Fictional items / 虚构物品 | 5571 | 5572 | AI-generated fictional images / AI 生成的虚构图片 |

**Why persistent model servers? / 为什么用持久化模型服务器？**

Loading the AI models takes ~30-40 seconds each time. The persistent servers (`sam3_server.py`, `sam3d_server.py`) keep models loaded in memory 24/7, so every job starts processing instantly.

加载 AI 模型每次需要约 30-40 秒。持久化服务器（`sam3_server.py`、`sam3d_server.py`）让模型一直留在内存中，所以每个任务都可以立即开始处理。

```
                  Caddy (:1111) ← External access / 外部访问
                       │
                  gpu_app.py (:5555) ← Main API / 主 API
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
         GPU 0                  GPU 1
      (real/photo)          (fictional)
    ┌────┴────┐           ┌────┴────┐
    ▼         ▼           ▼         ▼
SAM3 :5561  SAM3D :5562  SAM3 :5571  SAM3D :5572
```

---

## Project Structure / 项目结构

```
IW/
├── backend/                       ← All code lives here / 所有程序代码在这里
│   ├── gpu_app.py                 ← 🚪 Main API server (Flask, port 5555)
│   │                                  主 API 服务器（Flask，端口 5555）
│   ├── gpu_worker.py              ← 🚪 Lightweight API (legacy/alt version)
│   │                                  轻量版 API（旧版/备用）
│   ├── pipeline_3d.py             ← ⚙️ Core pipeline: SAM3 → SAM3D → refine
│   │                                  核心流水线：SAM3 → SAM3D → 精修
│   ├── sam3_server.py             ← 🤖 Persistent SAM3 model server (HTTP)
│   │                                  持久化 SAM3 模型服务器
│   ├── sam3d_server.py            ← 🤖 Persistent SAM3D model server (HTTP)
│   │                                  持久化 SAM3D 模型服务器
│   ├── gpu_pool.py                ← 🎛️ Multi-GPU resource manager
│   │                                  多 GPU 资源管理器
│   ├── job_manager.py             ← 📋 Job tracking and status
│   │                                  任务追踪和状态管理
│   ├── glb_processor.py           ← 🔧 3D model post-processing
│   │                                  3D 模型后处理（重心、材质）
│   ├── config.py                  ← ⚙️ Configuration (paths, ports, keys)
│   │                                  设置（路径、端口、密钥）
│   ├── start.sh                   ← ▶️ Start main API server
│   │                                  启动主 API 服务器
│   ├── start_model_servers.sh     ← ▶️ Start all 4 model servers (dual-GPU)
│   │                                  启动全部 4 个模型服务器（双 GPU）
│   ├── .env.example               ← 📝 Environment variable template
│   │                                  环境变量范本
│   └── README.md                  ← 📖 Backend details / 后端详细说明
│
├── setup/                         ← First-time installation / 首次安装脚本
│   ├── setup.py                   ← 🏗️ Installs everything (SAM3, SAM3D, trimesh)
│   │                                  自动安装所有依赖
│   ├── start.sh                   ← ▶️ Start services / 启动服务
│   ├── stop.sh                    ← ⏹️ Stop services / 停止服务
│   ├── install_trimesh.sh         ← 🔧 Install trimesh library
│   │                                  安装 trimesh（3D 处理工具）
│   └── README.md                  ← 📖 Setup details / 安装详细说明
│
├── README.md                      ← 📖 You are here / 你在这里
├── requirements.txt               ← 📦 Python dependencies / Python 依赖
├── VASTAI_DEPLOYMENT.md           ← 📖 Deployment architecture / 部署架构
└── VASTAI_SETUP.md                ← 📖 Setup guide / 设置指南
```

---

## Key Concepts (for non-engineers) / 核心概念解释（给非工程师）

### SAM3
**Segment Anything Model 3** (by Meta/Facebook). Give it a photo and a description ("cup"), and it precisely cuts the object from the background — like Photoshop's smart cutout, but fully automatic.

**Segment Anything Model 3**（Meta/Facebook 出品）。你给它一张照片和一个描述（"cup"），它就能精准地把那个物品从背景中"剪"出来，就像 Photoshop 的智能抠图，但全自动。

### SAM3D
**SAM 3D Objects** (also by Meta). Give it a 2D cutout image, and it "imagines" the object's 3D shape — like seeing a front photo and sculpting a complete clay figure from it.

**SAM 3D Objects**（也是 Meta 出品）。你给它一张 2D 物品图，它能"想象"出立体形状。就像看一张正面照就能捏出一个完整的泥塑。

### GLB File / GLB 文件
A **3D model file format**. Just as `.jpg` is for images and `.mp4` is for video, `.glb` is for 3D models. Web browsers and AR apps can read it directly.

一种 **3D 模型的文件格式**。就像 `.jpg` 是图片、`.mp4` 是影片，`.glb` 就是 3D 模型。网页和 AR 应用都能直接读取。

### GPU / 显卡
**Graphics Processing Unit**. Originally for gaming, but AI models run on it because it's great at parallel computation. SAM3 + SAM3D together need ~17GB VRAM per GPU.

**图形处理器**，原本用来玩游戏渲染画面。AI 模型靠它来跑，因为它擅长大量平行运算。SAM3 + SAM3D 每张 GPU 需要约 17GB 显存。

### Vast.ai
A **GPU rental platform**. You don't buy GPUs — you rent others' machines by the hour. Like taking Uber instead of buying a car.

一个**租用 GPU 服务器的平台**。不用买显卡，按小时租用别人的机器。就像不买车，用 Uber 叫车。

### Flask
A Python **web framework**. It lets this GPU server "understand" HTTP requests from the website — like giving the machine ears and a mouth.

一个 Python 的**网页服务框架**。让 GPU 服务器能"听懂"来自网站的 HTTP 请求。就像给机器装了耳朵和嘴巴。

### Conda Environment / Conda 环境
Python **virtual isolation spaces**. SAM3 and SAM3D need different tool versions that conflict. So they live in separate Conda environments (`sam3` and `sam3d-objects`), like separate apartments.

Python 的**虚拟隔离空间**。SAM3 和 SAM3D 各需要不同版本的工具，装在一起会打架。所以分别住在 `sam3` 和 `sam3d-objects` 两个 Conda 环境里。

### Caddy
A **reverse proxy server**. External traffic arrives at port 1111 (Caddy), which forwards it to the actual API at port 5555. Like a receptionist routing visitors to the right office.

一个**反向代理服务器**。外部流量到达端口 1111（Caddy），转发到实际 API 端口 5555。就像前台接待把访客带到正确的办公室。

---

## API Endpoints / API 接口一览

All requests (except health) need an API key header (`X-API-Secret`).
所有请求（健康检查除外）都需要 API 密钥标头（`X-API-Secret`）。

| Endpoint / 接口 | Method | Purpose / 用途 | Auth? |
|:-----------------|:-------|:---------------|:-----:|
| `/api/gpu/health` | GET | Health check + model server status / 健康检查 + 模型服务器状态 | No |
| `/api/gpu/process` | POST | **Submit job**: upload photo + prompt / **提交任务** | Yes |
| `/api/gpu/status/<job_id>` | GET | **Check progress** / **查进度** | Yes |
| `/api/gpu/download/<job_id>` | GET | **Download** .glb result / **下载** 3D 模型 | Yes |
| `/api/gpu/download_cutout/<job_id>` | GET | Download SAM3 cutout / 下载抠图 | Yes |
| `/api/gpu/restart` | POST | Restart model servers / 重启模型服务器 | Yes |
| `/api/gpu/info` | GET | GPU count and memory / GPU 数量和内存 | Yes |

**Submit job example / 提交任务示例：**
```
POST /api/gpu/process
Header: X-API-Secret: your-secret
Body: image=photo_file, prompt=cup
Response: {"job_id": "job_20260330_143022_a1b2c3", "status": "queued"}
```

---

## Network Architecture / 网络架构

```
External (Hostinger) ──────→ http://<vast_ip>:22939/api/gpu/...
                                      │
                               Caddy reverse proxy (:1111)
                                      │
                               gpu_app.py (:5555)
                                      │
                              pipeline_3d.py
                               ┌──────┴──────┐
                            GPU 0           GPU 1
                         (photo/real)    (fictional)
                          SAM3 :5561      SAM3 :5571
                          SAM3D :5562     SAM3D :5572
```

---

## Full System Overview / 完整系统架构

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│   Hostinger (website side)   │        │    Vast.ai (this project)    │
│   Hostinger（网站端）         │        │    Vast.ai（本项目）          │
│                              │        │                              │
│  Frontend (user interface)   │        │  gpu_app.py (API gateway)    │
│  前端（用户界面）             │  HTTP  │  gpu_app.py（API 网关）       │
│       ↕                      │◄─────►│       ↕                      │
│  app.py (orchestrator)       │ photo→ │  pipeline_3d.py (pipeline)   │
│  app.py（总管家）             │ ←model │  pipeline_3d.py（流水线）     │
│  - Calls GPT for stories    │        │  - SAM3 cutout / SAM3 抠图   │
│  - Calls Luma for images    │        │  - SAM3D modeling / SAM3D 建模│
│  - Manages user data        │        │  - GLB refinement / GLB 精修  │
│                              │        │                              │
│  Three.js (3D viewer)        │        │  2× GPU (RTX A5000 24GB)     │
│  8thWall (AR experience)     │        │  ~17GB VRAM per GPU           │
└──────────────────────────────┘        └──────────────────────────────┘
```

**Simply put / 简单说：** The website handles stories and display; the GPU server turns photos into 3D models. They cooperate over the network.

网站负责故事和展示，GPU 服务器负责把照片变成 3D 模型。两边通过网络合作。

---

## Environment Variables / 环境变量

Create a `.env` file in `backend/` (copy from `.env.example`):
在 `backend/` 目录下创建 `.env` 文件（可复制 `.env.example`）：

| Variable / 变量 | Required? / 必填？ | Description / 说明 |
|:----------------|:------------------:|:-------------------|
| `GPU_API_SECRET` | **Yes / 必填** | Random password for auth / 随机密码用于身份验证 |
| `HF_TOKEN` | **Yes / 必填** | HuggingFace Token for model downloads / HuggingFace Token 下载模型用 |
| `GPU_WORKER_PORT` | No | API port (default: 5555) / API 端口（预设 5555） |
| `SAM3_SERVER_PORT_GPU0` | No | SAM3 on GPU0 (default: 5561) |
| `SAM3D_SERVER_PORT_GPU0` | No | SAM3D on GPU0 (default: 5562) |
| `SAM3_SERVER_PORT_GPU1` | No | SAM3 on GPU1 (default: 5571) |
| `SAM3D_SERVER_PORT_GPU1` | No | SAM3D on GPU1 (default: 5572) |

---

## Quick Deployment / 快速部署

### Step 1: Rent a GPU server / 第一步：租 GPU 服务器

Go to [Vast.ai](https://vast.ai/) and rent a machine with **2× RTX A5000** (or similar, 24GB+ VRAM each).

去 [Vast.ai](https://vast.ai/) 租一台有 **2× RTX A5000**（或类似，每张 24GB+ 显存）的机器。

### Step 2: SSH in and clone / 第二步：SSH 登入并下载代码

```bash
ssh -p <port> root@<server_ip>
cd /workspace
git clone https://github.com/Nikonico98/Vast.ai.git IW
cd IW
```

### Step 3: Run setup / 第三步：执行安装

```bash
cd setup
python setup.py
```

This installs SAM3, SAM3D, all Python dependencies, and downloads AI model weights. First time takes a while.

这会安装 SAM3、SAM3D、所有 Python 依赖，并下载 AI 模型权重。首次需要等较久。

### Step 4: Configure / 第四步：设定环境变量

```bash
cd ../backend
cp .env.example .env
nano .env    # Fill in GPU_API_SECRET and HF_TOKEN
```

### Step 5: Start / 第五步：启动服务

```bash
bash start.sh                  # Start main API / 启动主 API
bash start_model_servers.sh    # Start 4 model servers / 启动 4 个模型服务器
```

### Stop / 停止

```bash
bash start_model_servers.sh stop    # Stop model servers / 停止模型服务器
cd ../setup && bash stop.sh         # Stop main API / 停止主 API
```

---

## FAQ / 常见问题

**Q: How long per photo? / 处理一张照片要多久？**
A: ~52 seconds with dual-GPU (2× RTX A5000). Both real + fictional are processed in parallel.
约 52 秒（双 GPU RTX A5000 并行处理真实 + 虚构）。

**Q: What if SAM3 fails? / SAM3 失败了怎么办？**
A: Auto fallback — the original photo (without cutout) is sent directly to SAM3D. Quality is lower but the pipeline doesn't break.
自动回退：原照片（不抠图）直接送 SAM3D。效果差一点但不会中断。

**Q: What if SAM3D fails? / SAM3D 失败了怎么办？**
A: A **gray cube placeholder** is generated. The website shows this instead of nothing.
会生成一个**灰色方块**占位符，网站显示方块而非空白。

**Q: How to check if GPUs are working? / 怎么知道 GPU 有没有工作？**
A: Visit `/api/gpu/health` — it shows each GPU's SAM3/SAM3D server status.
访问 `/api/gpu/health` — 会显示每张 GPU 的 SAM3/SAM3D 服务器状态。

---

## Security Notes / 安全提醒

These files contain secrets and **must NOT be in public repos / 不应上传到公开仓库**:
- `backend/.env` — API keys / API 密钥
- `setup/setup.py` — may contain hardcoded tokens / 可能有硬编码 Token

The `.gitignore` excludes `.env` and sensitive files. Always verify before pushing.
`.gitignore` 已排除 `.env` 和敏感文件。推送前请务必确认。

---

## Further Reading / 延伸阅读

- [VASTAI_SETUP.md](./VASTAI_SETUP.md) — Step-by-step setup / 详细安装步骤
- [VASTAI_DEPLOYMENT.md](./VASTAI_DEPLOYMENT.md) — Deployment architecture / 部署架构详解
- [backend/README.md](./backend/README.md) — Backend code details / 后端代码详解
- [setup/README.md](./setup/README.md) — Setup scripts guide / 安装脚本详解
