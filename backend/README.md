# Imaginary World - GPU Worker (Vast.ai)

## 这是什么？

这是一个运行在 **Vast.ai 云端 GPU 服务器**上的后端服务。

它的唯一工作：**接收一张图片 + 一段文字描述 → 输出一个 3D 模型文件（.glb）**。

举个例子：你上传一张泰迪熊的照片，告诉它 "teddy bear"，它就会帮你生成一个泰迪熊的 3D 模型。

---

## 工作流程（一张图看懂）

```
用户上传图片 + 文字提示
        ↓
   ┌─────────────┐
   │  GPU Worker  │  ← 你现在看的这个项目
   │  (Flask API) │
   └──────┬──────┘
          ↓
  Step 1: SAM3 分割
  （用 AI 把图片里的目标物体"抠"出来）
          ↓
  Step 2: SAM3D 重建
  （把 2D 图片变成 3D 模型）
          ↓
  Step 3: 后处理
  （调整模型原点、添加材质）
          ↓
   输出 .glb 3D 模型文件
```

---

## 文件说明

| 文件               | 一句话说明                                                 |
| ------------------ | ---------------------------------------------------------- |
| `gpu_worker.py`    | **主入口**。Flask Web 服务器，提供所有 API 接口            |
| `pipeline_3d.py`   | **核心流程**。串联 SAM3 → SAM3D → 后处理的完整 3D 生成管线 |
| `job_manager.py`   | **任务管理**。创建、更新、追踪每个任务的状态和进度         |
| `gpu_pool.py`      | **GPU 调度**。管理多张显卡，支持并行处理多个任务           |
| `glb_processor.py` | **模型后处理**。调整 3D 模型的原点位置、添加灯光材质       |
| `config.py`        | **配置文件**。路径、端口、密钥等所有可配置项               |
| `start.sh`         | **启动脚本**。一键安装依赖并启动服务                       |
| `requirements.txt` | Python 依赖包列表                                          |

---

## API 接口

所有接口（除了 health）都需要在请求头中带上 `X-API-Secret` 进行鉴权。

| 方法   | 路径                                | 说明                                    |
| ------ | ----------------------------------- | --------------------------------------- |
| `POST` | `/api/gpu/process`                  | 提交图片 + 文字提示，开始生成 3D 模型   |
| `GET`  | `/api/gpu/status/<job_id>`          | 查询任务状态（排队中/处理中/完成/失败） |
| `GET`  | `/api/gpu/download/<job_id>`        | 下载生成的 .glb 3D 模型                 |
| `GET`  | `/api/gpu/download_cutout/<job_id>` | 下载 SAM3 抠图结果（PNG）               |
| `GET`  | `/api/gpu/info`                     | 查看 GPU 信息（数量、状态、模式）       |
| `GET`  | `/health`                           | 健康检查（无需鉴权）                    |

### 提交任务示例

```bash
curl -X POST http://<服务器IP>:8080/api/gpu/process \
  -H "X-API-Secret: your-secret-key" \
  -F "image=@photo.png" \
  -F "prompt=teddy bear"
```

返回：

```json
{ "job_id": "job_20260330_143022_a1b2c3", "status": "queued" }
```

### 查询状态示例

```bash
curl http://<服务器IP>:8080/api/gpu/status/job_20260330_143022_a1b2c3 \
  -H "X-API-Secret: your-secret-key"
```

返回：

```json
{ "status": "processing", "step": "SAM3D 3D Reconstruction", "progress": 60 }
```

---

## 环境要求

- **Vast.ai GPU 实例**（需要 NVIDIA GPU，每个任务约 12GB 显存）
- **Conda 环境**：
  - `sam3` — SAM3 2D 分割模型的运行环境
  - `sam3d-objects` — SAM3D 3D 重建模型的运行环境
- **Hugging Face Token**（用于下载模型权重）

---

## 配置（环境变量）

在项目根目录创建 `.env` 文件：

```env
# 必须修改：API 鉴权密钥
GPU_API_SECRET=your-random-secret-here

# 必须修改：Hugging Face 令牌
HF_TOKEN=hf_your_token_here

# 可选：服务端口（默认 8080）
GPU_WORKER_PORT=8080

# 可选：工作目录（默认 /workspace）
WORKSPACE=/workspace
```

---

## 启动方式

```bash
# 在 Vast.ai 实例上执行
bash start.sh
```

这个脚本会自动：

1. 安装 Python 依赖
2. 创建数据目录
3. 检查 GPU 和 Conda 环境
4. 用 Gunicorn 启动 Flask 服务（端口 8080）

---

## 多 GPU 并行

如果你的机器有多张显卡，系统会自动检测并启用并行模式：

- **并行模式（默认）**：多个任务分配到不同 GPU 上同时运行
- **顺序模式**：所有任务排队，一个一个执行

通过 `/api/gpu/info` 可以查看当前 GPU 状态和模式。
