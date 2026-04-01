# Imaginary World - Vast.ai 部署指南

## 📋 前置条件

确保你的 Vast.ai 实例已经配置好：

- ✅ SAM3 环境 (`sam3`)
- ✅ SAM3D 环境 (`sam3d-objects`)
- ✅ Python 3.8+
- ✅ CUDA (用于 GPU 推理)

---

## 🚀 快速启动

### 步骤 1: 上传 IW 文件夹

将整个 `IW` 文件夹上传到 Vast.ai 实例的 `/workspace/` 目录：

```bash
# 在 Vast.ai 终端中
cd /workspace
# 使用 scp、rsync 或 Vast.ai 的文件上传功能
```

### 步骤 2: 设置环境变量

```bash
# 设置 OpenAI API Key (必须)
export OPENAI_API_KEY="sk-your-openai-api-key"

# 设置 HuggingFace Token (可选，用于下载 SAM3 模型)
export HF_TOKEN="hf_your-token"

# 设置 ngrok Token (用于外网访问)
export NGROK_AUTHTOKEN="your-ngrok-authtoken"

# 或者创建 .env 文件
cd /workspace/IW
cp .env.example .env
nano .env  # 编辑填入你的 API keys
```

### 步骤 3: 安装依赖

```bash
cd /workspace/IW
pip install -r requirements.txt
```

### 步骤 4: 启动服务

**方式 A: 仅启动后端 (本地测试)**

```bash
chmod +x start_server.sh
./start_server.sh
```

**方式 B: 启动后端 + ngrok (外网访问)**

```bash
chmod +x start_with_ngrok.sh
./start_with_ngrok.sh
```

---

## 🌐 使用 ngrok 进行测试

### 获取 ngrok Auth Token

1. 注册 ngrok 账号: https://ngrok.com/signup
2. 获取 Auth Token: https://dashboard.ngrok.com/get-started/your-authtoken
3. 设置环境变量: `export NGROK_AUTHTOKEN="your-token"`

### 启动后的访问

ngrok 启动后会显示类似这样的 URL：

```
Forwarding  https://xxxx-xx-xx-xx-xx.ngrok-free.app -> http://localhost:5000
```

在手机或电脑浏览器中打开这个 URL 即可访问！

---

## 📁 目录结构

```
/workspace/
├── IW/                          # 本项目
│   ├── backend/
│   │   └── app.py               # Flask 后端
│   ├── frontend/
│   │   ├── index.html
│   │   ├── style.css
│   │   ├── config.js
│   │   ├── app.js
│   │   └── js/
│   │       ├── story-api.js
│   │       ├── story.js
│   │       └── dual-viewer.js
│   ├── data/                    # 运行时生成
│   │   ├── uploads/
│   │   ├── results/
│   │   └── journeys/
│   ├── start_server.sh
│   ├── start_with_ngrok.sh
│   ├── requirements.txt
│   └── .env
├── sam3/                        # SAM3 仓库
└── sam-3d-objects/              # SAM3D 仓库
```

---

## 🔧 环境变量说明

| 变量              | 必须 | 说明                               |
| ----------------- | ---- | ---------------------------------- |
| `OPENAI_API_KEY`  | ✅   | OpenAI API 密钥                    |
| `NGROK_AUTHTOKEN` | ✅   | ngrok 认证令牌 (外网访问需要)      |
| `HF_TOKEN`        | ❌   | HuggingFace Token (下载 SAM3 模型) |
| `PORT`            | ❌   | 服务端口 (默认 5000)               |
| `WORKSPACE`       | ❌   | 工作目录 (默认 /workspace)         |
| `SAM3_REPO`       | ❌   | SAM3 仓库路径                      |
| `SAM3D_REPO`      | ❌   | SAM3D 仓库路径                     |

---

## 🐛 常见问题

### Q: ngrok 显示 "ERR_NGROK_108"

A: 免费版 ngrok 有连接限制，等待几秒后重试，或升级到付费版

### Q: 无法访问 OpenAI API

A: 检查 `OPENAI_API_KEY` 是否正确设置，可以用以下命令测试：

```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Q: SAM3/SAM3D 报错

A: 确保在正确的 conda 环境中运行，检查 GPU 是否可用：

```bash
conda activate sam3
python -c "import torch; print(torch.cuda.is_available())"
```

### Q: 页面加载但功能不工作

A: 打开浏览器开发者工具 (F12) 查看 Console 错误信息

---

## 📱 手机测试

1. 确保 ngrok 正在运行
2. 复制 ngrok 显示的 https URL
3. 在手机浏览器中打开该 URL
4. 首次访问可能需要点击 "Visit Site" 确认

---

## 🔄 完整流程测试

1. **选择世界** - 点击任意世界卡片
2. **阅读故事背景** - 等待 AI 生成后阅读
3. **拍照上传** - 点击 "Take Photo" 拍摄物体
4. **等待处理** - AI 分析 + 3D 生成
5. **查看结果** - 对比真实照片和虚拟版本
6. **继续或完成** - 上传更多照片或结束故事

Enjoy! 🎉
