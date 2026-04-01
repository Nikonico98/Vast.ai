# Setup — Installation & Service Scripts
# 安装 — 安装与服务脚本

> **EN:** This folder contains scripts for **first-time setup** and **service management** (start/stop). You only need to run `setup.py` once when creating a new Vast.ai instance.
>
> **中文：** 这个文件夹包含**首次安装**和**服务管理**（启动/停止）的脚本。创建新的 Vast.ai 实例时，只需执行一次 `setup.py`。

---

## File Guide / 文件说明

| File / 文件 | When to use / 什么时候用 | Description / 说明 |
|:------------|:------------------------|:-------------------|
| `setup.py` | 🏗️ **First time only** / 仅首次 | The "renovation crew" — automatically installs everything: creates `sam3` and `sam3d-objects` conda environments, installs all Python packages, downloads SAM3 and SAM3D AI model weights from HuggingFace (~5-10 GB), installs trimesh for 3D processing. Takes 15-30 minutes on first run. / "装修队"：自动安装一切。创建 conda 环境、安装所有 Python 套件、从 HuggingFace 下载模型权重（约 5-10 GB）、安装 trimesh。首次运行需 15-30 分钟。 |
| `start.sh` | ▶️ **Every time** / 每次启动 | Starts the GPU worker services. Run this after the machine boots up or after a restart. / 启动 GPU 工作站服务。每次机器开机或重启后执行。 |
| `stop.sh` | ⏹️ **When stopping** / 停止时 | Gracefully stops all running services. Use this before shutting down the machine. / 优雅地停止所有运行中的服务。关机前使用。 |
| `install_trimesh.sh` | 🔧 **If trimesh is broken** / trimesh 出问题时 | Standalone script to install/reinstall the `trimesh` library (used for 3D model processing) in the SAM3D conda environment. Only needed if trimesh has issues. / 独立脚本，在 SAM3D conda 环境中安装/重装 `trimesh` 库。只在 trimesh 有问题时需要。 |

---

## Usage Order / 使用顺序

### First-time setup (new Vast.ai instance) / 首次设置（新 Vast.ai 实例）

```bash
# 1. Run the full setup (only once)
#    执行完整安装（只需一次）
cd /workspace/IW/setup
python setup.py

# 2. Configure environment variables
#    配置环境变量
cd /workspace/IW/backend
cp .env.example .env
nano .env    # Fill in GPU_API_SECRET and HF_TOKEN / 填入密钥

# 3. Start services
#    启动服务
bash start.sh                    # Main API / 主 API
bash start_model_servers.sh      # 4 model servers / 4 个模型服务器
```

### Daily use (machine already set up) / 日常使用（机器已设置好）

```bash
# Start everything / 启动一切
cd /workspace/IW/backend
bash start.sh
bash start_model_servers.sh

# Stop everything / 停止一切
bash start_model_servers.sh stop
cd /workspace/IW/setup
bash stop.sh
```

---

## What setup.py does (in detail) / setup.py 做了什么（详细版）

Think of it as automated interior decoration for a new empty room:

把它想象成新空房间的自动装修：

1. **Creates conda environment `sam3`** — Installs Python 3.12 + SAM3 model dependencies
   创建 conda 环境 `sam3` — 安装 Python 3.12 + SAM3 模型依赖

2. **Creates conda environment `sam3d-objects`** — Installs Python 3.12 + SAM3D model dependencies
   创建 conda 环境 `sam3d-objects` — 安装 Python 3.12 + SAM3D 模型依赖

3. **Downloads AI model weights** — From HuggingFace (needs `HF_TOKEN`), several GB each
   下载 AI 模型权重 — 从 HuggingFace 下载（需要 `HF_TOKEN`），每个几 GB

4. **Installs trimesh** — 3D model processing library for GLB post-processing
   安装 trimesh — GLB 后处理用的 3D 模型处理库

5. **Verifies GPU access** — Checks NVIDIA drivers and CUDA are working
   验证 GPU 访问 — 检查 NVIDIA 驱动和 CUDA 是否正常

---

## Troubleshooting / 故障排除

**Q: setup.py fails downloading models / setup.py 下载模型失败**
A: Check your `HF_TOKEN` is valid. You may need to accept the model license on the HuggingFace website first.
检查 `HF_TOKEN` 是否有效。可能需要先在 HuggingFace 网站上接受模型许可协议。

**Q: "conda not found" error / 报错 "conda not found"**
A: Make sure conda/miniconda is installed. On Vast.ai, it's usually pre-installed at `/opt/conda`.
确保已安装 conda/miniconda。Vast.ai 上通常预装在 `/opt/conda`。

**Q: trimesh import error / trimesh 导入错误**
A: Run `bash install_trimesh.sh` to reinstall it in the correct conda environment.
运行 `bash install_trimesh.sh` 在正确的 conda 环境中重新安装。

**Q: GPU not detected / 检测不到 GPU**
A: Run `nvidia-smi` to check if NVIDIA drivers are working. On Vast.ai, make sure you selected a GPU instance (not CPU-only).
运行 `nvidia-smi` 检查 NVIDIA 驱动是否正常。在 Vast.ai 上确保选择了 GPU 实例（非纯 CPU）。
