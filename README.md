# ImaginaryWorld Vast.ai — GPU 3D 模型生成服务

> 这是「想象世界」的 **GPU 后端**。它的工作很单纯：**收到一张照片 → 抠出物体 → 捏成 3D 模型 → 交回去**。

---

## 一句话理解这个项目

Hostinger 那边的网站是"门面 + 大脑"，**这里是"3D 雕塑工坊"**。

用户在网站上拍照 → 网站把照片通过网络发到这个 GPU 服务器 → GPU 服务器用 AI 把照片做成 3D 模型（`.glb` 文件）→ 网站下载模型 → 展示给用户看。

就像外包：网站接到客户需求，**但雕塑的活儿外包给了这个 GPU 工坊**。

---

## 这个工坊是怎么工作的？（完整流程）

```
Hostinger 网站发来一张照片 + 一个描述词（比如 "cup"）
              │
              ▼
   ┌─────────────────────┐
   │  1. 前台接待         │  gpu_worker.py / gpu_app.py
   │  收到照片，登记任务   │  接收 HTTP 请求，分配一个「任务编号」（job_id）
   │  立刻回复："收到了，  │  立刻回复网站，不让网站干等
   │  你的单号是 xxxx"     │
   └────────┬────────────┘
            │（后台开始干活）
            ▼
   ┌─────────────────────┐
   │  2. 调度室           │  gpu_pool.py
   │  看看哪台 GPU 有空   │  自动检测有几张显卡，排队分配
   │  有空的就派活过去     │  就像餐厅分配厨位
   └────────┬────────────┘
            ▼
   ┌─────────────────────┐
   │  3. 剪影师（SAM3）   │  pipeline_3d.py → 调用 SAM3 模型
   │  把照片里的物体从     │  AI 识别照片中的物品，生成一张
   │  背景中"抠"出来       │  去掉背景的透明底图（cutout.png）
   └────────┬────────────┘
            ▼
   ┌─────────────────────┐
   │  4. 雕塑家（SAM3D）  │  pipeline_3d.py → 调用 SAM3D 模型
   │  把 2D 抠图"捏"成    │  AI 根据这张 2D 图片，推测物体的
   │  一个 3D 模型         │  立体形状，输出 .glb 3D 文件
   └────────┬────────────┘
            ▼
   ┌─────────────────────┐
   │  5. 精修师           │  glb_processor.py
   │  修正模型的小问题     │  ① 把模型的"脚"放到地面上（重心校正）
   │                      │  ② 加上材质，让模型在灯光下好看
   └────────┬────────────┘
            ▼
   ┌─────────────────────┐
   │  6. 交货             │  gpu_worker.py
   │  网站来取货：         │  网站反复问"做好了吗？"，做好了
   │  下载 .glb 文件       │  就把 3D 模型文件传回去
   └─────────────────────┘
```

**整个过程中，网站可以随时查进度**（就像查快递），任务有这些状态：
`排队中 queued` → `处理中 processing` → `完成 completed` 或 `失败 failed`

---

## 文件夹里都有什么？每个文件是干嘛的？

```
ImaginaryWorld_Vastai/
│
├── backend/                  ← 所有程序代码都在这里
│   ├── gpu_app.py            ← 🚪 "前台接待"：接收外部请求的入口程序（Flask 网页服务）
│   ├── gpu_worker.py         ← 🚪 另一版"前台接待"（功能类似 gpu_app.py）
│   ├── gpu_pool.py           ← 🎛️ "调度室"：检测有几张显卡、排队派活
│   ├── job_manager.py        ← 📋 "登记簿"：记录每个任务的状态和进度
│   ├── pipeline_3d.py        ← ⚙️ "流水线"：依序跑 SAM3 → SAM3D → 精修，核心逻辑
│   ├── glb_processor.py      ← 🔧 "精修师"：修正 3D 模型的重心和材质
│   ├── config.py             ← ⚙️ "设置面板"：所有路径、API 密钥、GPU 设定
│   ├── start.sh              ← ▶️ "开机按钮"：一键启动服务的脚本
│   ├── requirements.txt      ← 📦 程序需要的 Python 套件清单
│   ├── .env.example          ← 📝 环境变量范本（API 密钥要填在 .env 里）
│   └── README.md             ← 📖 后端的补充说明
│
├── setup/                    ← 第一次安装时用的脚本
│   ├── setup.py              ← 🏗️ "装修队"：自动安装所有依赖（SAM3、SAM3D、trimesh等）
│   ├── start.sh              ← ▶️ 启动服务
│   ├── stop.sh               ← ⏹️ 停止服务
│   └── install_trimesh.sh    ← 🔧 单独安装 trimesh（3D 模型处理工具）
│
├── README.md                 ← 📖 你正在看的这个文件
├── requirements.txt          ← 📦 顶层的依赖清单
├── VASTAI_DEPLOYMENT.md      ← 📖 部署架构的详细说明
└── VASTAI_SETUP.md           ← 📖 安装步骤的详细说明
```

---

## 核心概念解释（给非工程师）

### 什么是 SAM3？
**Segment Anything Model 3**（Meta/Facebook 出品）。你给它一张照片和一个描述（"cup"），它就能精准地把那个物品从背景中"剪"出来，就像 Photoshop 的智能抠图，但全自动。

### 什么是 SAM3D？
**SAM 3D Objects**（也是 Meta 出品）。你给它一张已经抠好的 2D 物品图，它能"想象"这个物品的立体形状，输出一个可以旋转查看的 3D 模型。就像看一张正面照就能捏出一个完整的泥塑。

### 什么是 GLB 文件？
一种 **3D 模型的文件格式**（全称 GL Transmission Format Binary）。就像 `.jpg` 是图片、`.mp4` 是影片，`.glb` 就是 3D 模型。网页和 AR 应用都能直接读取它。

### 什么是 GPU / 显卡？
**图形处理器**，原本是用来玩游戏渲染画面的硬件。但因为它擅长大量平行运算，所以 AI 模型也靠它来跑。SAM3 和 SAM3D 每次处理一张图大约需要 **12GB 显存**，所以需要 RTX 3090 或 RTX 4090 这种高端显卡。

### 什么是 Vast.ai？
一个**租用 GPU 服务器的平台**。你不用买显卡，按小时租用别人的机器。就像不买车，用 Uber 叫车。

### 什么是 Flask？
一个 Python 的**网页服务框架**。它让这台 GPU 服务器能"听懂"来自网站的 HTTP 请求。就像给机器装了一个耳朵和嘴巴，能接收指令、回报结果。

### 什么是 Conda 环境？
Python 的**虚拟隔离空间**。SAM3 和 SAM3D 各需要不同版本的工具，如果装在一起会打架。所以它们分别住在 `sam3` 和 `sam3d-objects` 两个 Conda 环境里，互不干扰。

---

## API 接口一览（网站怎么跟这个 GPU 工坊沟通）

所有请求都需要带一把"钥匙"（`X-API-Secret` 标头），防止陌生人乱用。

| 接口地址 | 方法 | 做什么 | 需要钥匙？ |
|----------|------|--------|:----------:|
| `/health` | GET | 检查服务有没有活着 | 不需要 |
| `/api/gpu/info` | GET | 查看 GPU 数量和使用情况 | 需要 |
| `/api/gpu/process` | POST | **提交任务**：上传照片 + 描述词 | 需要 |
| `/api/gpu/status/<任务编号>` | GET | **查进度**：这个任务做到哪了？ | 需要 |
| `/api/gpu/download/<任务编号>` | GET | **取货**：下载做好的 3D 模型 | 需要 |
| `/api/gpu/download_cutout/<任务编号>` | GET | 下载 SAM3 抠图结果 | 需要 |
| `/api/env-status` | GET | 检查 SAM3/SAM3D 环境是否正常 | 需要 |

**提交任务的例子：**
```
POST /api/gpu/process
标头: X-API-Secret: 你的密钥
内容: image=照片文件, prompt=cup
回应: {"job_id": "job_20260330_143022_a1b2c3", "status": "queued"}
```

---

## GPU 调度机制（怎么分配显卡）

这台服务器可能有 **1 张或多张** GPU 显卡。`gpu_pool.py` 负责管理它们：

- **并行模式**（预设）：有几张显卡就能同时处理几个任务。3 张 GPU = 同时 3 个任务。
- **排队模式**：一次只处理一个任务，其他的排队等。适合测试或显存不够时用。

可以透过 API 切换模式：`POST /api/gpu/mode`

---

## 需要准备什么？（环境变量）

在 `backend/` 目录下创建一个 `.env` 文件（可以复制 `.env.example` 来改），填入以下内容：

| 变量名 | 必填？ | 说明 |
|--------|:------:|------|
| `GPU_API_SECRET` | **必填** | 一串随机密码，用来验证请求身份（自己随便定一个长字串） |
| `HF_TOKEN` | **必填** | HuggingFace 的 Token，用来下载 SAM3/SAM3D 的 AI 模型 |
| `GPU_WORKER_PORT` | 选填 | 服务端口，预设 8080 |
| `WORKSPACE` | 选填 | 工作目录，预设 /workspace |
| `SAM3_ENV` | 选填 | SAM3 的 Conda 环境名称，预设 sam3 |
| `SAM3D_ENV` | 选填 | SAM3D 的 Conda 环境名称，预设 sam3d-objects |

---

## 怎么部署？（快速版）

### 第一步：租一台 GPU 服务器

去 [Vast.ai](https://vast.ai/) 租一台有 **RTX 3090 或 RTX 4090**（至少 12GB 显存）的机器。

### 第二步：SSH 连上去，下载代码

```bash
ssh -p 端口号 root@服务器地址
cd /workspace
git clone -b seg https://github.com/Nikonico98/ImaginaryWorld.git
cd ImaginaryWorld/ImaginaryWorld_Vastai
```

### 第三步：跑安装脚本

```bash
cd setup
python setup.py
```
这会自动安装 SAM3、SAM3D、所有 Python 依赖。第一次要等比较久（下载 AI 模型）。

### 第四步：设定环境变量

```bash
cd ../backend
cp .env.example .env
nano .env
# 填入 GPU_API_SECRET 和 HF_TOKEN
```

### 第五步：启动服务

```bash
bash start.sh
```
服务会在 **端口 8080** 启动。之后 Hostinger 那边的网站指向这个地址就行了。

### 停止服务

```bash
cd ../setup
bash stop.sh
```

---

## 详细部署文档

- [VASTAI_SETUP.md](./VASTAI_SETUP.md) — 一步步的安装指南
- [VASTAI_DEPLOYMENT.md](./VASTAI_DEPLOYMENT.md) — 部署架构的详细说明
- [backend/README.md](./backend/README.md) — 后端程序的补充说明

---

## 常见问题

### Q：处理一张照片要多久？
视 GPU 型号而定。RTX 4090 大约 1-3 分钟，RTX 3090 大约 2-5 分钟。

### Q：为什么需要 12GB 显存？
SAM3D 在把 2D 图变 3D 模型时，需要在 GPU 记忆体中跑大量运算。12GB 是最低需求。

### Q：SAM3 失败了怎么办？
代码有自动回退机制：如果 SAM3 抠图失败，会直接用整张照片（不抠图）送去 SAM3D。效果差一点但不会中断。

### Q：SAM3D 失败了怎么办？
会生成一个**灰色方块**作为占位符，不至于让整个流程崩溃。网站那边会显示这个方块而不是空白。

### Q：怎么知道 GPU 有没有在正常工作？
访问 `/health` 看服务是否存活，访问 `/api/gpu/info` 看显卡状态。

---

## 整个「想象世界」系统的全貌

这个 GPU 工坊只是整个系统的一半。完整的架构是这样的：

```
┌─────────────────────────────────┐        ┌─────────────────────────────────┐
│      Hostinger（网站那边）        │        │       Vast.ai（这个项目）        │
│                                 │        │                                 │
│  网页前端（用户看到的界面）       │        │  gpu_app.py（前台接待）          │
│       ↕                         │  HTTP   │       ↕                         │
│  app.py（总管家）                │ ◄─────► │  pipeline_3d.py（流水线）        │
│  - 调用 GPT 编故事              │  照片→  │  - SAM3 抠图                    │
│  - 调用 Luma 画图               │  ←模型  │  - SAM3D 建模                   │
│  - 管理用户数据                 │        │  - GLB 精修                     │
│                                 │        │                                 │
│  Three.js（展示 3D 模型）        │        │  GPU: RTX 3090 / 4090           │
│  8thWall（AR 增强现实）          │        │  每个模型需要 ~12GB 显存         │
└─────────────────────────────────┘        └─────────────────────────────────┘
```

简单说：**网站负责故事和展示，GPU 服务器负责把照片变成 3D 模型。两边通过网络合作。**
| Vast.ai 账号        | 租用GPU服务器            | [vast.ai](https://vast.ai)                                               |
| Hostinger 账号      | 网站托管                 | [hostinger.com](https://hostinger.com)                                   |
| ngrok Token（可选） | HTTPS隧道（开发/测试用） | [ngrok.com](https://ngrok.com)                                           |

---

## 用户旅程流程图

```
用户打开网站
    │
    ▼
登录/注册/游客模式
    │
    ▼
选择想象世界（6种）
  Historical / Overlaid / Alternate / SciFi_Earth / SciFi_Galaxy / Fantasy
    │
    ▼
AI生成故事背景 ──→ 不满意？重新生成
    │              满意？继续
    ▼
╔══════════════════════════════╗
║  循环3次（每次一张照片）：      ║
║                              ║
║  1. 拍照上传                  ║
║  2. GPT分析照片中的物品       ║
║  3. GPT编写故事事件           ║
║  4. Luma AI生成虚构物品图      ║
║  5. SAM3抠图 + SAM3D建模 ×2   ║
║  6. 展示两个3D模型（真实+虚构） ║
║  7. 进入AR体验                ║
╚══════════════════════════════╝
    │
    ▼
故事完成，显示总结页面
```

---

## 六种想象世界

| 世界     | 英文名       | 描述                             |
| -------- | ------------ | -------------------------------- |
| 历史的   | Historical   | 回到过去，你的物品成为历史文物   |
| 叠加的   | Overlaid     | 现实与幻想重叠，物品有了隐藏面目 |
| 替代的   | Alternate    | 平行宇宙，万物皆有不同版本       |
| 科幻地球 | SciFi_Earth  | 未来地球，物品成为高科技装备     |
| 科幻银河 | SciFi_Galaxy | 浩瀚宇宙，你的物品是星际遗物     |
| 奇幻的   | Fantasy      | 魔法世界，物品蕴含神秘力量       |

---

## 常见问题

**Q：3D模型生成很慢怎么办？**
A：每个3D模型需要1-5分钟（取决于GPU性能）。系统支持并行模式——如果你的GPU显存足够（多GPU或单GPU 48GB+），可以同时生成两个模型。

**Q：AR打不开？**
A：AR需要HTTPS和摄像头权限。开发环境用ngrok提供HTTPS。确保你在手机浏览器（Safari/Chrome）中打开。

**Q：如何在没有GPU的情况下测试？**
A：设置 `SKIP_3D_GENERATION=true`（前端 config.js）可以跳过3D生成。后端也支持生成占位符模型（一个简单的立方体）。

**Q：前端有两个版本 frontend 和 frontend_newnew，用哪个？**
A：用 `frontend_newnew`。它是最新版本，包含环境音效、完整的AR部署文件和更好的用户体验。

---

## 安全提醒

以下文件包含敏感信息，**不应上传到公开代码仓库**：

- `ImaginaryWorld_Vastai/id_ed25519-imwodata` — SSH私钥
- `ImaginaryWorld_Vastai/setup/setup.py` — 包含硬编码的 HF_TOKEN 和 NGROK_TOKEN
- `ImaginaryWorld_Hostinger/backend/.env` — API密钥
- `ImaginaryWorld_Vastai/backend/.env` — API密钥

建议：把敏感信息移到环境变量或密钥管理服务中，并在 `.gitignore` 中排除这些文件。
