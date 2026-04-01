# Backend — GPU Worker Code
# 后端 — GPU 工作站程序代码

> **EN:** This folder contains all the code that runs on the Vast.ai GPU server. It receives images from the Hostinger website and returns 3D models.
>
> **中文：** 这个文件夹包含运行在 Vast.ai GPU 服务器上的所有代码。它接收 Hostinger 网站发来的图片，返回 3D 模型。

---

## File Guide / 文件说明

### Main API / 主 API

| File / 文件 | Role / 角色 | Description / 说明 |
|:------------|:------------|:-------------------|
| `gpu_app.py` | 🚪 **Main entry point** / 主入口 | Flask web server on port 5555. Receives all API requests from Hostinger (submit jobs, check status, download results, health check). Like the "front desk" of the workshop. / Flask 网页服务器（端口 5555）。接收所有来自 Hostinger 的 API 请求。像工坊的"前台接待"。 |
| `gpu_worker.py` | 🚪 Legacy API / 旧版 API | An older, simpler version of the API. Kept as backup. / 较旧的简易版 API，保留作备用。 |
| `config.py` | ⚙️ Configuration / 设置 | All configurable values: paths to SAM3/SAM3D checkpoints, data directories, conda environment names, port numbers. Like the "settings panel". / 所有可配置项：SAM3/SAM3D 模型路径、数据目录、conda 环境名称、端口号。像"设置面板"。 |

### Core Pipeline / 核心流水线

| File / 文件 | Role / 角色 | Description / 说明 |
|:------------|:------------|:-------------------|
| `pipeline_3d.py` | ⚙️ **Core logic** / 核心逻辑 | Orchestrates the entire 3D generation: SAM3 segmentation → SAM3D reconstruction → GLB post-processing. Routes jobs to the correct GPU (photo→GPU0, fictional→GPU1). Like the "factory floor manager". / 编排整个 3D 生成流程：SAM3 分割 → SAM3D 重建 → GLB 后处理。把任务分配到正确的 GPU（photo→GPU0，fictional→GPU1）。像"车间主管"。 |
| `glb_processor.py` | 🔧 Post-processing / 后处理 | Fixes the 3D model after SAM3D creates it: recenters it (so it stands on the ground), adds PBR materials (so it looks good under lighting). / SAM3D 生成模型后的修正：重新定位（让模型站在地面上）、添加 PBR 材质（让模型在灯光下好看）。 |

### Persistent Model Servers / 持久化模型服务器

These are the **most important performance optimization**. Instead of loading 30-40 second AI models for every job, these servers keep the models loaded in GPU memory 24/7.

这些是**最重要的性能优化**。不用每次任务都花 30-40 秒加载 AI 模型，这些服务器让模型一直留在 GPU 内存中。

| File / 文件 | Role / 角色 | Description / 说明 |
|:------------|:------------|:-------------------|
| `sam3_server.py` | 🤖 SAM3 server | Persistent HTTP server that keeps the SAM3 (segmentation) model loaded. Listens on a port and responds to inference requests. One instance per GPU. / 持久化 HTTP 服务器，保持 SAM3（分割）模型加载。监听端口并响应推理请求。每张 GPU 一个实例。 |
| `sam3d_server.py` | 🤖 SAM3D server | Persistent HTTP server that keeps the SAM3D (3D reconstruction) model loaded. One instance per GPU. / 持久化 HTTP 服务器，保持 SAM3D（3D 重建）模型加载。每张 GPU 一个实例。 |

**In the dual-GPU setup, there are 4 server instances running: / 双 GPU 设置中，共运行 4 个服务器实例：**

| Instance / 实例 | GPU | Port / 端口 | Model / 模型 | VRAM / 显存 |
|:----------------|:----|:------------|:-------------|:------------|
| SAM3 (GPU 0) | 0 | 5561 | Segmentation / 分割 | ~4 GB |
| SAM3D (GPU 0) | 0 | 5562 | 3D Reconstruction / 3D 重建 | ~13 GB |
| SAM3 (GPU 1) | 1 | 5571 | Segmentation / 分割 | ~4 GB |
| SAM3D (GPU 1) | 1 | 5572 | 3D Reconstruction / 3D 重建 | ~13 GB |

### Job & GPU Management / 任务与 GPU 管理

| File / 文件 | Role / 角色 | Description / 说明 |
|:------------|:------------|:-------------------|
| `job_manager.py` | 📋 Job tracker / 任务追踪 | Creates, updates, and tracks every job. Stores status (queued/processing/completed/failed), progress percentage, timestamps, error messages. Like a "logbook". / 创建、更新、追踪每个任务。记录状态、进度百分比、时间戳、错误信息。像"登记簿"。 |
| `gpu_pool.py` | 🎛️ GPU scheduler / GPU 调度 | Manages GPU allocation. For paired jobs (photo+fictional), GPUs are assigned directly (0 and 1). For unpaired jobs, uses a queue system. / 管理 GPU 分配。配对任务（photo+fictional）直接分配到 GPU 0 和 1。非配对任务使用队列系统。 |

### Startup Scripts / 启动脚本

| File / 文件 | Role / 角色 | Description / 说明 |
|:------------|:------------|:-------------------|
| `start.sh` | ▶️ Start API / 启动 API | Installs Python dependencies, creates data directories, checks GPU/Conda, then launches `gpu_app.py` with Gunicorn on port 5555. / 安装 Python 依赖、创建数据目录、检查 GPU/Conda，然后用 Gunicorn 启动 `gpu_app.py`（端口 5555）。 |
| `start_model_servers.sh` | ▶️ Start model servers / 启动模型服务器 | Launches all 4 persistent model servers (2 per GPU). Supports commands: `all` (default), `gpu0`, `gpu1`, `stop`. / 启动全部 4 个持久化模型服务器（每张 GPU 2 个）。支持命令：`all`（默认）、`gpu0`、`gpu1`、`stop`。 |

### Configuration Files / 配置文件

| File / 文件 | Description / 说明 |
|:------------|:-------------------|
| `.env` | **Secret config** (not in git). Contains API keys and tokens. / **机密配置**（不在 git 中）。包含 API 密钥和 Token。 |
| `.env.example` | Template showing what `.env` needs. Copy this and fill in values. / 范本，显示 `.env` 需要的内容。复制并填入值。 |
| `requirements.txt` | Python packages needed by the backend. / 后端需要的 Python 套件清单。 |

---

## How to Start / 如何启动

```bash
cd /workspace/IW/backend

# 1. Start the main API server
#    启动主 API 服务器
bash start.sh

# 2. Start all 4 model servers (takes ~2 min to load models)
#    启动全部 4 个模型服务器（加载模型需约 2 分钟）
bash start_model_servers.sh

# --- Other commands / 其他命令 ---

# Start only GPU 0 servers / 只启动 GPU 0 的服务器
bash start_model_servers.sh gpu0

# Start only GPU 1 servers / 只启动 GPU 1 的服务器
bash start_model_servers.sh gpu1

# Stop all model servers / 停止所有模型服务器
bash start_model_servers.sh stop
```

---

## How Requests Flow / 请求流动路径

```
Hostinger sends POST /api/gpu/process with image + prompt
                    │
                    ▼
             gpu_app.py (:5555)
             Validates request, creates job_id, replies immediately
             验证请求，创建 job_id，立即回复
                    │
                    ▼
             pipeline_3d.py
             Checks job_id to decide GPU:
             检查 job_id 决定使用哪张 GPU：
               "_photo_" in job_id → GPU 0 (ports 5561/5562)
               "_fictional_" in job_id → GPU 1 (ports 5571/5572)
                    │
              ┌─────┴─────┐
              ▼            ▼
         sam3_server   sam3d_server
         (HTTP call)   (HTTP call)
              │            │
              ▼            ▼
         cutout.png    model.glb
                           │
                           ▼
                    glb_processor.py
                    Recenter + materials
                    重心校正 + 材质
                           │
                           ▼
                    Final .glb saved to data/results/
                    最终 .glb 保存到 data/results/
```

---

## Logs / 日志

Log files are stored in `../logs/` (not committed to git):
日志文件存储在 `../logs/`（不会提交到 git）：

- `gpu_app.log` — Main API server logs / 主 API 服务器日志
- `sam3_gpu0.log`, `sam3_gpu1.log` — SAM3 server logs per GPU / 每张 GPU 的 SAM3 日志
- `sam3d_gpu0.log`, `sam3d_gpu1.log` — SAM3D server logs per GPU / 每张 GPU 的 SAM3D 日志

To check if model servers are running / 检查模型服务器是否在运行：
```bash
curl http://localhost:5561/health   # SAM3 GPU0
curl http://localhost:5562/health   # SAM3D GPU0
curl http://localhost:5571/health   # SAM3 GPU1
curl http://localhost:5572/health   # SAM3D GPU1
```
