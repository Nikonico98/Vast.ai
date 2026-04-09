#!/usr/bin/env python3
"""
Imaginary World - Complete Setup Script
IW 完整安装脚本
=========================================

This script will:
这个脚本会：

1. Setup SAM3 environment (2D segmentation)
   安装 SAM3 环境（2D 分割）

2. Setup SAM3D environment (3D reconstruction)  
   安装 SAM3D 环境（3D 重建）

3. Download model checkpoints from Hugging Face
   从 Hugging Face 下载模型权重

4. Configure OpenAI & Luma AI APIs
   配置 OpenAI 和 Luma AI API

5. Install Flask & ngrok for web access
   安装 Flask 和 ngrok 用于 Web 访问

6. Run smoking test with test.png
   使用 test.png 运行冒烟测试

Usage 用法:
    python setup.py              # Full setup 完整安装
    python setup.py --test-only   # Only run smoking test 仅运行测试
    python setup.py --skip-test   # Skip smoking test 跳过测试
    python setup.py --api-only    # Only configure APIs 仅配置 API
    python setup.py --start       # Start server after setup 安装后启动服务器
    python setup.py --from-frozen # Restore envs from exported snapshots 从导出快照恢复环境

Author: Beginner-Friendly Engineer Edition 🎓
作者: 文科生工程师友好版 🎓
"""

import argparse
import os
import subprocess
import sys
import time
import json
import shutil
from datetime import datetime
from pathlib import Path

# ============================================================
# Configuration 配置区
# ============================================================

# Working directories 工作目录
WORKSPACE = "/workspace"
SCRIPT_DIR = Path(__file__).parent.absolute()  # setup 文件夹
IW_FOLDER = SCRIPT_DIR.parent  # IW 文件夹
BACKEND_FOLDER = IW_FOLDER / "backend"
FRONTEND_FOLDER = IW_FOLDER / "frontend"
BACKEND_ENV_FILE = BACKEND_FOLDER / ".env"


def _read_env_value(env_file: Path, key: str) -> str:
    """Read a single value from a dotenv-style file without extra dependencies."""
    if not env_file.exists():
        return ""

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        current_key, value = line.split("=", 1)
        if current_key.strip() != key:
            continue

        return value.strip().strip('"').strip("'")

    return ""


# Hugging Face Token - 优先读取进程环境变量，其次读取 backend/.env
HF_TOKEN = os.environ.get("HF_TOKEN") or _read_env_value(BACKEND_ENV_FILE, "HF_TOKEN")

# SAM3 Configuration SAM3 配置
SAM3_ENV = "sam3"
SAM3_PYTHON = "3.12"
SAM3_REPO = os.path.join(WORKSPACE, "sam3")
SAM3_URL = "https://github.com/facebookresearch/sam3.git"

# SAM3D Configuration SAM3D 配置
SAM3D_ENV = "sam3d-objects"
SAM3D_REPO = os.path.join(WORKSPACE, "sam-3d-objects")
SAM3D_URL = "https://github.com/facebookresearch/sam-3d-objects.git"
SAM3D_TAG = "hf"

# Flask Configuration Flask 配置
FLASK_PORT = 11111
FLASK_HOST = "0.0.0.0"

# ngrok Configuration ngrok 配置
NGROK_URL = "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz"
NGROK_PATH = os.path.join(WORKSPACE, "ngrok")
NGROK_TOKEN = "2tCyOrAbxem30WrLgMtmYWvrGZT_7vxrwAKjoz3YUpe2RZTuo"
NGROK_DOMAIN = "niko.ngrok.app"

# Test files 测试文件
TEST_IMAGE = SCRIPT_DIR / "test.png"
TEST_PROMPT = "main object"

# HF cache
HF_HOME = os.path.join(WORKSPACE, ".hf_home")

# Note: HKBU GenAI Platform is deprecated, now using OpenAI directly
# API configuration is in backend/.env file

# Template files 模板文件 (CRITICAL - server won't start without these)
TEMPLATE_FOLDER = BACKEND_FOLDER / "templates"
PROMPT_TEMPLATE_FILE = TEMPLATE_FOLDER / "prompt.md"  # 必须是小写!

# Patch files 补丁文件
PATCHES_DIR = SCRIPT_DIR / "patches"

# Frozen environment exports 导出的环境快照
ENVS_DIR = SCRIPT_DIR / "envs"

# ============================================================
# Helper Functions 辅助函数
# ============================================================

class Colors:
    """Terminal colors for pretty output 终端颜色"""
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    END = '\033[0m'

def log(message, level="info"):
    """Print formatted log message 打印格式化日志"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    
    if level == "success":
        prefix = f"{Colors.GREEN}✅{Colors.END}"
    elif level == "warning":
        prefix = f"{Colors.YELLOW}⚠️{Colors.END}"
    elif level == "error":
        prefix = f"{Colors.RED}❌{Colors.END}"
    elif level == "step":
        prefix = f"{Colors.BLUE}▶{Colors.END}"
    elif level == "header":
        print(f"\n{Colors.CYAN}{'='*60}{Colors.END}")
        print(f"{Colors.BOLD}{Colors.CYAN}  {message}{Colors.END}")
        print(f"{Colors.CYAN}{'='*60}{Colors.END}")
        return
    else:
        prefix = f"{Colors.BLUE}ℹ️{Colors.END}"
    
    print(f"[{timestamp}] {prefix} {message}")

def run_cmd(cmd, cwd=None, shell=True, check=True, capture=False, timeout=None):
    """Run shell command 运行 shell 命令"""
    log(f"Running: {cmd[:80]}..." if len(cmd) > 80 else f"Running: {cmd}", "step")
    try:
        result = subprocess.run(
            cmd, shell=shell, cwd=cwd, check=check,
            capture_output=capture, text=True, timeout=timeout
        )
        if capture:
            return result.stdout.strip()
        return result.returncode == 0
    except subprocess.CalledProcessError as e:
        log(f"Command failed: {e}", "error")
        if capture:
            return ""
        return False
    except subprocess.TimeoutExpired:
        log(f"Command timed out after {timeout}s", "error")
        return False

def get_conda_base():
    """Get conda installation path 获取 conda 安装路径"""
    try:
        result = subprocess.run(["conda", "info", "--base"],
                               capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass
    # Default paths
    for path in ["/opt/miniforge3", "/opt/conda", "/root/miniconda3"]:
        if os.path.exists(path):
            return path
    return "/opt/conda"

def conda_env_exists(env_name):
    """Check if conda environment exists 检查 conda 环境是否存在"""
    try:
        result = subprocess.run(
            f"conda env list | grep -w {env_name}",
            shell=True, capture_output=True, text=True
        )
        return env_name in result.stdout
    except:
        return False

def check_gpu():
    """Check GPU status 检查 GPU 状态"""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            gpu_info = result.stdout.strip()
            log(f"GPU detected: {gpu_info}", "success")
            return True
    except:
        pass
    log("No GPU detected (will use CPU - much slower)", "warning")
    return False

def check_disk_space():
    """Check available disk space 检查磁盘空间"""
    try:
        import shutil
        total, used, free = shutil.disk_usage(WORKSPACE)
        free_gb = free // (1024**3)
        log(f"Disk space: {free_gb}GB free", "info")
        if free_gb < 20:
            log("Low disk space! Need at least 20GB for models", "warning")
            return False
        return True
    except:
        return True

# ============================================================
# Setup Functions 安装函数
# ============================================================

def setup_environment():
    """Setup basic environment 设置基础环境"""
    log("Setting up basic environment | 设置基础环境", "header")
    
    # Create directories 创建目录
    os.makedirs(HF_HOME, exist_ok=True)
    os.makedirs(os.path.join(WORKSPACE, "outputs"), exist_ok=True)
    
    # Create IW data directories
    for folder in ["data", "data/uploads", "data/results", "data/temp", "data/journeys"]:
        (IW_FOLDER / folder).mkdir(parents=True, exist_ok=True)
    
    # Set HF token 设置 HF token
    os.environ["HF_HOME"] = HF_HOME
    if HF_TOKEN:
        os.environ["HF_TOKEN"] = HF_TOKEN
        os.environ["HUGGINGFACE_HUB_TOKEN"] = HF_TOKEN

        # Write token to file 写入 token 文件
        token_file = os.path.join(HF_HOME, "token")
        with open(token_file, "w") as f:
            f.write(HF_TOKEN)
        os.chmod(token_file, 0o600)

        log("HF_TOKEN configured | HF_TOKEN 已配置", "success")
    else:
        log(f"HF_TOKEN not found in environment or {BACKEND_ENV_FILE}", "warning")
    
    # Check system 检查系统
    check_gpu()
    check_disk_space()


def verify_critical_files():
    """
    Verify critical files exist before starting server
    验证关键文件是否存在
    
    CRITICAL: The server will NOT start without prompt.md template file!
    关键: 没有 prompt.md 模板文件，服务器将无法启动！
    """
    log("Verifying critical files | 验证关键文件", "header")
    
    errors = []
    warnings = []
    
    # 1. Check prompt.md template (REQUIRED - no fallback!)
    # 检查 prompt.md 模板（必需 - 没有备用方案！）
    if not PROMPT_TEMPLATE_FILE.exists():
        errors.append(f"❌ CRITICAL: prompt.md not found at {PROMPT_TEMPLATE_FILE}")
        errors.append("   服务器无法启动 - 请确保 prompt.md 文件存在")
        errors.append(f"   Expected path: {PROMPT_TEMPLATE_FILE}")
    else:
        # Check if file is not empty
        content = PROMPT_TEMPLATE_FILE.read_text(encoding='utf-8')
        if not content.strip():
            errors.append(f"❌ CRITICAL: prompt.md is empty!")
            errors.append("   服务器无法启动 - prompt.md 文件为空")
        elif len(content) < 100:
            warnings.append(f"⚠️ WARNING: prompt.md seems too short ({len(content)} chars)")
        else:
            log(f"✅ prompt.md found ({len(content)} chars)", "success")
            
            # Verify key content exists
            if "IMAGINARY_WORLD" not in content:
                warnings.append("⚠️ WARNING: IMAGINARY_WORLD not found in prompt.md")
            if "AR_INTERACTIONS" not in content:
                warnings.append("⚠️ WARNING: AR_INTERACTIONS not found in prompt.md")
    
    # 2. Check templates folder exists
    if not TEMPLATE_FOLDER.exists():
        errors.append(f"❌ Templates folder not found: {TEMPLATE_FOLDER}")
    else:
        log(f"✅ Templates folder exists", "success")
    
    # 3. Check backend/app.py exists
    app_file = BACKEND_FOLDER / "app.py"
    if not app_file.exists():
        errors.append(f"❌ Backend app.py not found: {app_file}")
    else:
        log(f"✅ Backend app.py found", "success")
    
    # 4. Check .env file
    env_file = BACKEND_FOLDER / ".env"
    if not env_file.exists():
        warnings.append(f"⚠️ .env file not found (will be created)")
    else:
        log(f"✅ .env file found", "success")
    
    # 5. Check database.py exists
    db_file = BACKEND_FOLDER / "database.py"
    if not db_file.exists():
        errors.append(f"❌ database.py not found: {db_file}")
    else:
        log(f"✅ database.py found", "success")
    
    # Print warnings
    for warning in warnings:
        log(warning, "warning")
    
    # Print errors and exit if any
    if errors:
        log("Critical errors found! | 发现关键错误！", "error")
        for error in errors:
            print(f"  {error}")
        print("")
        log("Please fix the above errors before continuing.", "error")
        log("请修复以上错误后再继续。", "error")
        return False
    
    log("All critical files verified! | 所有关键文件验证通过！", "success")
    return True


def update_env_file():
    """Update .env file with all required tokens 更新 .env 文件"""
    log("Updating .env file | 更新 .env 文件", "header")
    
    env_file = BACKEND_FOLDER / ".env"
    env_example = BACKEND_FOLDER / ".env.example"
    
    # If .env doesn't exist, copy from .env.example as starting point
    if not env_file.exists() and env_example.exists():
        shutil.copy2(env_example, env_file)
        log("Created .env from .env.example — please fill in your API keys!", "warning")
        log("已从 .env.example 创建 .env — 请填入你的 API 密钥！", "warning")
    
    # Read existing content
    existing_content = ""
    if env_file.exists():
        with open(env_file, "r") as f:
            existing_content = f.read()
    
    # Check if HF_TOKEN is already in .env
    if "HF_TOKEN" not in existing_content:
        # Add HF_TOKEN section
        hf_section = f"""
# ==========================================
# Hugging Face Token (for SAM3 model download)
# ==========================================
HF_TOKEN = "{HF_TOKEN}"

# ==========================================
# ngrok Configuration
# ==========================================
NGROK_DOMAIN = "{NGROK_DOMAIN}"
NGROK_TOKEN = "{NGROK_TOKEN}"

# ==========================================
# Server Configuration
# ==========================================
PORT = {FLASK_PORT}
WORKSPACE = "{WORKSPACE}"
"""
        with open(env_file, "a") as f:
            f.write(hf_section)
        log(f"Added HF_TOKEN and ngrok config to .env", "success")
    else:
        log("HF_TOKEN already in .env, skipping", "info")
    
    # Verify OpenAI API config
    if "OPENAI_API_KEY" in existing_content:
        log("OpenAI API already configured in .env", "success")
    else:
        log("OpenAI API not found in .env - please add manually", "warning")

def setup_sam3():
    """Setup SAM3 environment 安装 SAM3 环境"""
    log("Setting up SAM3 (2D Segmentation) | 安装 SAM3（2D 分割）", "header")
    
    conda_base = get_conda_base()
    
    # Check if env exists 检查环境是否存在
    if conda_env_exists(SAM3_ENV):
        log(f"SAM3 environment '{SAM3_ENV}' already exists, skipping creation", "info")
    else:
        log(f"Creating conda environment '{SAM3_ENV}'...", "step")
        run_cmd(f"conda create -n {SAM3_ENV} python={SAM3_PYTHON} -y")
    
    # Clone/update repo 克隆/更新仓库
    if os.path.exists(os.path.join(SAM3_REPO, ".git")):
        log("SAM3 repo exists, pulling latest...", "step")
        run_cmd("git pull", cwd=SAM3_REPO)
    else:
        log("Cloning SAM3 repo...", "step")
        run_cmd(f"git clone {SAM3_URL} {SAM3_REPO}")
    
    # Install dependencies 安装依赖
    log("Installing SAM3 dependencies (this may take a while)...", "step")
    log("安装 SAM3 依赖（可能需要几分钟）...", "step")
    
    install_script = f"""
source {conda_base}/etc/profile.d/conda.sh
conda activate {SAM3_ENV}
pip install -U pip wheel 'setuptools<71'
pip install torch==2.7.0 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
cd {SAM3_REPO}
pip install -e .
pip install -e ".[notebooks]" || true
pip install "huggingface-hub[cli]<1.0"
pip install flask flask-cors python-dotenv
"""
    run_cmd(f"bash -c '{install_script}'")
    
    log("SAM3 setup complete | SAM3 安装完成", "success")
    export_frozen_env(SAM3_ENV)

def setup_sam3d():
    """Setup SAM3D environment 安装 SAM3D 环境
    
    SIMPLIFIED VERSION: Based on IOS setup.py that works correctly.
    简化版本: 基于能正常工作的 IOS setup.py
    """
    log("Setting up SAM3D (3D Reconstruction) | 安装 SAM3D（3D 重建）", "header")
    
    conda_base = get_conda_base()
    
    # Clone/update repo 克隆/更新仓库
    if os.path.exists(os.path.join(SAM3D_REPO, ".git")):
        log("SAM3D repo exists, pulling latest...", "step")
        run_cmd("git pull", cwd=SAM3D_REPO, check=False)
    else:
        log("Cloning SAM3D repository...", "step")
        run_cmd(f"git clone {SAM3D_URL} {SAM3D_REPO}")
    
    # Check if env exists 检查环境是否存在
    if conda_env_exists(SAM3D_ENV):
        log(f"Conda env '{SAM3D_ENV}' already exists (skipping create)", "success")
    else:
        log(f"Creating conda env '{SAM3D_ENV}' from environments/default.yml...", "step")
        # Use official environment file
        env_yaml = os.path.join(SAM3D_REPO, "environments", "default.yml")
        if not os.path.exists(env_yaml):
            env_yaml = os.path.join(SAM3D_REPO, "environment.yaml")
        run_cmd(f"conda env create -f {env_yaml}", check=False)
    
    # Install dependencies - Write script to temp file to avoid quote issues
    # 安装依赖 - 写脚本到临时文件避免引号问题
    log("Installing SAM3D dependencies (this may take 10-15 minutes)...", "step")
    log("安装 SAM3D 依赖（可能需要 10-15 分钟）...", "step")
    
    install_script_content = f"""#!/bin/bash
source {conda_base}/etc/profile.d/conda.sh
conda activate {SAM3D_ENV}
cd {SAM3D_REPO}

# Set CUDA environment
export CUDA_HOME=$(python -c "import torch; print(torch.utils.cmake_prefix_path.replace('/share/cmake', ''))" 2>/dev/null || echo "/usr/local/cuda")
export TORCH_CUDA_ARCH_LIST="7.5;8.0;8.6;8.9;9.0"
export FORCE_CUDA=1
export SKIP_GSPLAT_BUILD=1

export PIP_EXTRA_INDEX_URL="https://pypi.ngc.nvidia.com https://download.pytorch.org/whl/cu121"
pip install -e ".[dev]" || true
pip install -e ".[p3d]" || true

export PIP_FIND_LINKS="https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.5.1_cu121.html"
pip install -e ".[inference]" || true

# Install gsplat
pip install gsplat --no-build-isolation || echo "gsplat skipped"

# Install additional dependencies
pip install seaborn || true
pip install kaolin -f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.5.1_cu121.html || true

# Install trimesh for GLB post-processing (origin adjustment for AR)
pip install trimesh || true

# Apply hydra patch
if [ -f "./patching/hydra" ]; then
    python ./patching/hydra || true
fi

pip install "huggingface-hub[cli]<1.0"

# Final verification
echo "========================================"
echo "Verifying SAM3D dependencies..."
echo "========================================"
python -c "import torch; print('torch:', torch.__version__, 'CUDA:', torch.cuda.is_available())"
python -c "import omegaconf; print('omegaconf: OK')" || echo "omegaconf: FAILED"
python -c "import utils3d; print('utils3d: OK')" || echo "utils3d: FAILED"
python -c "import seaborn; print('seaborn: OK')" || echo "seaborn: FAILED"
python -c "import pytorch3d; print('pytorch3d: OK')" || echo "pytorch3d: FAILED"
python -c "import kaolin; print('kaolin: OK')" || echo "kaolin: FAILED"
python -c "import gsplat; print('gsplat: OK')" || echo "gsplat: FAILED"
echo "========================================"
"""
    
    # Write script to temp file (avoids quote escaping issues)
    # 写脚本到临时文件（避免引号转义问题）
    script_file = os.path.join(WORKSPACE, "install_sam3d.sh")
    with open(script_file, 'w', encoding='utf-8') as f:
        f.write(install_script_content)
    os.chmod(script_file, 0o755)
    
    run_cmd(f"bash {script_file}")
    
    log("SAM3D dependencies installed | SAM3D 依赖安装完成", "success")
    export_frozen_env(SAM3D_ENV)


def export_frozen_env(env_name):
    """Export a conda environment to a frozen yml file for migration.
    导出 conda 环境到 frozen yml 文件用于迁移。
    """
    conda_base = get_conda_base()
    ENVS_DIR.mkdir(parents=True, exist_ok=True)

    yml_path = ENVS_DIR / f"{env_name}_frozen.yml"
    pip_path = ENVS_DIR / f"{env_name}_pip_freeze.txt"

    log(f"Exporting {env_name} environment snapshot...", "step")
    try:
        run_cmd(
            f"bash -c 'source {conda_base}/etc/profile.d/conda.sh && "
            f"conda env export -n {env_name} > {yml_path}'",
            check=False
        )
        run_cmd(
            f"bash -c 'source {conda_base}/etc/profile.d/conda.sh && "
            f"conda run -n {env_name} pip freeze > {pip_path}'",
            check=False
        )
        if yml_path.exists() and yml_path.stat().st_size > 0:
            log(f"Exported → {yml_path}", "success")
        else:
            log(f"Export may have failed for {env_name}", "warning")
    except Exception as e:
        log(f"Could not export {env_name}: {e}", "warning")


def restore_from_frozen():
    """Restore conda environments from frozen yml exports.
    从导出的 frozen yml 文件恢复 conda 环境。

    This is faster and more reproducible than installing from scratch.
    比从头安装更快更可靠。
    """
    log("Restoring environments from frozen exports | 从导出快照恢复环境", "header")

    conda_base = get_conda_base()
    restored = 0

    for env_name, yml_name, pip_name, repo_url, repo_path in [
        (SAM3_ENV, f"{SAM3_ENV}_frozen.yml", f"{SAM3_ENV}_pip_freeze.txt", SAM3_URL, SAM3_REPO),
        (SAM3D_ENV, f"{SAM3D_ENV}_frozen.yml", f"{SAM3D_ENV}_pip_freeze.txt", SAM3D_URL, SAM3D_REPO),
    ]:
        yml_path = ENVS_DIR / yml_name
        pip_path = ENVS_DIR / pip_name

        # Clone repo first (needed for editable installs)
        if not os.path.exists(os.path.join(repo_path, ".git")):
            log(f"Cloning {repo_url}...", "step")
            run_cmd(f"git clone {repo_url} {repo_path}", check=False)

        if yml_path.exists():
            log(f"Restoring {env_name} from {yml_name}...", "step")
            if conda_env_exists(env_name):
                log(f"{env_name} already exists, skipping restore", "info")
                restored += 1
                continue
            # Create env from frozen yml
            result = run_cmd(
                f"bash -c 'source {conda_base}/etc/profile.d/conda.sh && "
                f"conda env create -f {yml_path}'",
                check=False
            )
            if result:
                log(f"Restored {env_name} from frozen yml", "success")
                restored += 1
            else:
                log(f"Frozen yml restore failed for {env_name}, falling back to pip freeze", "warning")
                # Fallback: create base env + pip install from freeze
                if pip_path.exists():
                    _restore_from_pip_freeze(env_name, pip_path, conda_base)
                    restored += 1
                else:
                    log(f"No pip freeze found either, will need full install", "error")
        elif pip_path.exists():
            log(f"No frozen yml for {env_name}, using pip freeze...", "warning")
            _restore_from_pip_freeze(env_name, pip_path, conda_base)
            restored += 1
        else:
            log(f"No frozen exports found for {env_name} in {ENVS_DIR}/", "error")
            log(f"Run export_envs.sh on the old instance first!", "error")

    if restored > 0:
        log(f"Restored {restored} environment(s)", "success")
        # Fix pkg_resources: setuptools>=71 removed it, SAM3 needs it
        # 修复 pkg_resources: setuptools>=71 移除了它，SAM3 需要它
        _fix_sam3_setuptools(conda_base)
    else:
        log("No environments were restored. Run full setup instead.", "error")
        log("尝试使用 python setup.py (不加 --from-frozen) 进行完整安装", "error")


def _fix_sam3_setuptools(conda_base):
    """Ensure sam3 env has setuptools<71 so pkg_resources is available.
    确保 sam3 环境的 setuptools<71，以便 pkg_resources 可用。

    SAM3's model_builder.py imports pkg_resources which was removed in
    setuptools>=71. Downgrade if needed.
    SAM3 的 model_builder.py 导入 pkg_resources，该模块在 setuptools>=71 中被移除。
    """
    if not conda_env_exists(SAM3_ENV):
        return
    log(f"Checking setuptools version in {SAM3_ENV} (pkg_resources fix)...", "step")
    run_cmd(
        f"bash -c 'source {conda_base}/etc/profile.d/conda.sh && "
        f"conda activate {SAM3_ENV} && pip install \"setuptools<71\"'",
        check=False
    )
    log("setuptools pinned <71 for pkg_resources compatibility", "success")


def _restore_from_pip_freeze(env_name, pip_path, conda_base):
    """Fallback: create a base conda env and pip install from freeze file."""
    python_ver = SAM3_PYTHON if env_name == SAM3_ENV else "3.11"
    if not conda_env_exists(env_name):
        run_cmd(f"conda create -n {env_name} python={python_ver} -y", check=False)
    run_cmd(
        f"bash -c 'source {conda_base}/etc/profile.d/conda.sh && "
        f"conda activate {env_name} && pip install -r {pip_path}'",
        check=False
    )
    log(f"Restored {env_name} from pip freeze", "success")


def download_checkpoints():
    """Download model checkpoints 下载模型权重"""
    log("Downloading model checkpoints | 下载模型权重", "header")
    log("This may take 15-20 minutes depending on network speed...", "warning")
    log("这可能需要 15-20 分钟，取决于网络速度...", "warning")

    if not HF_TOKEN:
        raise RuntimeError(
            f"HF_TOKEN is missing. Set it in the environment or in {BACKEND_ENV_FILE} before downloading checkpoints."
        )
    
    conda_base = get_conda_base()
    
    download_script = f"""
source {conda_base}/etc/profile.d/conda.sh
conda activate {SAM3D_ENV}
cd {SAM3D_REPO}

# Login to Hugging Face 登录 Hugging Face
huggingface-cli login --token {HF_TOKEN} --add-to-git-credential || true

# Download checkpoints 下载权重
rm -rf "checkpoints/{SAM3D_TAG}-download" "checkpoints/{SAM3D_TAG}"
mkdir -p checkpoints

hf download \\
    --repo-type model \\
    --local-dir "checkpoints/{SAM3D_TAG}-download" \\
    --max-workers 1 \\
    facebook/sam-3d-objects

# Move to final location 移动到最终位置
mkdir -p "checkpoints/{SAM3D_TAG}"
if [ -d "checkpoints/{SAM3D_TAG}-download/checkpoints" ]; then
    cp -a "checkpoints/{SAM3D_TAG}-download/checkpoints/." "checkpoints/{SAM3D_TAG}/"
fi
rm -rf "checkpoints/{SAM3D_TAG}-download"
"""
    run_cmd(f"bash -c '{download_script}'")
    
    # Verify 验证
    pipeline_yaml = os.path.join(SAM3D_REPO, f"checkpoints/{SAM3D_TAG}/pipeline.yaml")
    if os.path.exists(pipeline_yaml):
        log("Model checkpoints downloaded successfully!", "success")
    else:
        log("Warning: pipeline.yaml not found - download may have failed", "warning")

def apply_frontend_patches():
    """Apply LocalStorage persistence patches to frontend & backend
    应用 LocalStorage 持久化补丁到前后端
    
    This ensures session persistence across server restarts.
    确保会话在服务器重启后仍然有效。
    """
    log("Applying LocalStorage persistence patches | 应用 LocalStorage 持久化补丁", "header")
    
    patch_script = PATCHES_DIR / "localstorage_persistence.py"
    if not patch_script.exists():
        log(f"Patch script not found: {patch_script}", "warning")
        return False
    
    try:
        result = subprocess.run(
            [sys.executable, str(patch_script)],
            capture_output=True, text=True, timeout=30
        )
        print(result.stdout)
        if result.stderr:
            print(result.stderr)
        
        if result.returncode == 0:
            log("LocalStorage persistence patches applied! | 持久化补丁已应用！", "success")
            return True
        else:
            log("Some patches failed - check output above | 部分补丁失败", "warning")
            return False
    except Exception as e:
        log(f"Failed to apply patches: {e}", "error")
        return False


def install_flask_deps():
    """Install Flask dependencies 安装 Flask 依赖"""
    log("Installing Flask dependencies | 安装 Flask 依赖", "header")
    
    conda_base = get_conda_base()
    
    # Install in SAM3 env (which runs Flask)
    install_cmd = f"""
source {conda_base}/etc/profile.d/conda.sh
conda activate {SAM3_ENV}
pip install flask flask-cors gunicorn python-dotenv openai requests
"""
    run_cmd(f"bash -c '{install_cmd}'")
    
    # Also install requirements from backend folder if exists
    requirements_file = BACKEND_FOLDER / "requirements.txt"
    if requirements_file.exists():
        log("Installing requirements from backend/requirements.txt...", "step")
        install_req = f"""
source {conda_base}/etc/profile.d/conda.sh
conda activate {SAM3_ENV}
pip install -r {requirements_file}
"""
        run_cmd(f"bash -c '{install_req}'")
    
    log("Flask dependencies installed | Flask 依赖安装完成", "success")

def install_ngrok():
    """Install and configure ngrok 安装并配置 ngrok"""
    log("Installing ngrok | 安装 ngrok", "header")
    
    # Download ngrok if not exists 如果不存在则下载 ngrok
    if not os.path.exists(NGROK_PATH):
        log("Downloading ngrok...", "step")
        run_cmd(f"cd {WORKSPACE} && curl -sLO {NGROK_URL} && tar xzf ngrok-v3-stable-linux-amd64.tgz && rm ngrok-v3-stable-linux-amd64.tgz")
        log("ngrok downloaded", "success")
    else:
        log("ngrok already exists, skipping download", "info")
    
    if not os.path.exists(NGROK_PATH):
        log("ngrok installation failed!", "error")
        return False
    
    # Configure ngrok token 配置 ngrok token
    log("Configuring ngrok authtoken | 配置 ngrok 认证令牌...", "step")
    try:
        run_cmd(f"{NGROK_PATH} config add-authtoken {NGROK_TOKEN}")
        log("ngrok configured successfully", "success")
        return True
    except Exception as e:
        log(f"ngrok configuration failed: {e}", "error")
        return False

def test_openai_api():
    """Test OpenAI API 测试 OpenAI API"""
    log("Testing OpenAI API | 测试 OpenAI API", "header")
    
    try:
        from dotenv import load_dotenv
        
        # Load .env from backend folder
        env_file = BACKEND_FOLDER / ".env"
        if env_file.exists():
            load_dotenv(env_file)
        
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            log("OPENAI_API_KEY not found in .env", "warning")
            return False
        
        import requests
        
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
        payload = {
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": "Say hello in one word."}],
            "max_tokens": 10
        }
        
        log("Sending test request to OpenAI...", "step")
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            log(f"OpenAI API test passed! Response: {reply}", "success")
            return True
        else:
            log(f"OpenAI API test failed. Status: {response.status_code}", "error")
            log(f"Response: {response.text[:200]}", "error")
            return False
    except ImportError as e:
        log(f"Missing module: {e}, skipping API test", "warning")
        return True
    except Exception as e:
        log(f"OpenAI API test error: {e}", "error")
        return False

def run_smoking_test():
    """Run smoking test with test.png 使用 test.png 运行冒烟测试"""
    log("Running Smoking Test | 运行冒烟测试", "header")
    
    if not TEST_IMAGE.exists():
        log(f"Test image not found: {TEST_IMAGE}", "error")
        log("Please add a test.png file to the setup folder", "warning")
        return False
    
    conda_base = get_conda_base()
    
    # Test 1: OpenAI API
    log("Test 1/3: OpenAI API...", "step")
    if not test_openai_api():
        log("OpenAI API test failed, but continuing...", "warning")
    
    # Test 2: SAM3 segmentation
    log("Test 2/3: SAM3 (2D segmentation)...", "step")
    log("测试 SAM3（2D 分割）...", "step")
    
    cutout_output = os.path.join(WORKSPACE, "cutout.png")
    
    sam3_test_code = f'''
import os, sys
import numpy as np
from PIL import Image
import torch

os.environ["HF_HOME"] = "{HF_HOME}"
sys.path.insert(0, "{SAM3_REPO}")

from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor

device = "cuda" if torch.cuda.is_available() else "cpu"
print("Device:", device)

model = build_sam3_image_model().to(device).eval()
processor = Sam3Processor(model)

image = Image.open("{TEST_IMAGE}").convert("RGB")
state = processor.set_image(image)
output = processor.set_text_prompt(state=state, prompt="{TEST_PROMPT}")
masks, scores = output["masks"], output["scores"]

best = int(torch.argmax(scores).item())
mask = masks[best].detach().to("cpu").numpy()

if mask.ndim == 3:
    mask2d = mask[0]
else:
    mask2d = mask
mask2d = mask2d.astype(bool)

# Save RGBA cutout
img_np = np.array(image)
alpha = (mask2d * 255).astype(np.uint8)[..., None]
rgba = np.concatenate([img_np, alpha], axis=2)
Image.fromarray(rgba, "RGBA").save("{cutout_output}")

print("SAM3 test passed!")
print("Score:", float(scores[best]))
print("Cutout saved to:", "{cutout_output}")
'''
    
    # Write to temporary file
    test_file = os.path.join(WORKSPACE, "test_sam3.py")
    with open(test_file, "w") as f:
        f.write(sam3_test_code)
    
    sam3_cmd = f"""
source {conda_base}/etc/profile.d/conda.sh
conda activate {SAM3_ENV}
python {test_file}
rm -f {test_file}
"""
    
    try:
        if run_cmd(f"bash -c '{sam3_cmd}'", timeout=300):
            log("SAM3 test passed! | SAM3 测试通过！", "success")
        else:
            log("SAM3 test failed | SAM3 测试失败", "error")
            return False
    except Exception as e:
        log(f"SAM3 test error: {e}", "error")
        return False
    
    # Test 3: SAM3D 3D reconstruction
    log("Test 3/3: SAM3D (3D reconstruction)...", "step")
    log("测试 SAM3D（3D 重建）...", "step")
    log("This may take 1-2 minutes...", "info")
    
    glb_output = os.path.join(WORKSPACE, "outputs/smoke_test.glb")
    
    sam3d_test_code = f'''
import os, sys, glob, shutil
import numpy as np
from PIL import Image

os.environ["HF_HOME"] = "{HF_HOME}"

ROOT = "{SAM3D_REPO}"
TAG = "{SAM3D_TAG}"
INPUT = "{cutout_output}"
OUT_GLB = "{glb_output}"

os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, "notebook"))

from inference import Inference

config_path = os.path.join(ROOT, "checkpoints", TAG, "pipeline.yaml")
if not os.path.exists(config_path):
    raise FileNotFoundError("Missing pipeline.yaml:", config_path)

print("Loading Inference from:", config_path)
inference = Inference(config_path, compile=False)

rgba = np.array(Image.open(INPUT).convert("RGBA"))
image = rgba[..., :3]
mask = (rgba[..., 3] > 0).astype(np.uint8)

print("Running inference...")
watch_dir = os.path.join(ROOT, "notebook", "meshes")
os.makedirs(watch_dir, exist_ok=True)
before = set(glob.glob(os.path.join(watch_dir, "**", "*.glb"), recursive=True))

out = inference(image, mask, seed=42)

after = set(glob.glob(os.path.join(watch_dir, "**", "*.glb"), recursive=True))
new_glb = list(after - before)

if new_glb:
    src = max(new_glb, key=lambda p: os.path.getmtime(p))
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    shutil.copy(src, OUT_GLB)
    print("GLB saved:", OUT_GLB)
    print("Size:", os.path.getsize(OUT_GLB), "bytes")
    print("SAM3D test passed!")
else:
    print("Warning: No GLB file generated")
'''
    
    # Write to temporary file
    test_file = os.path.join(WORKSPACE, "test_sam3d.py")
    with open(test_file, "w") as f:
        f.write(sam3d_test_code)
    
    sam3d_cmd = f"""
source {conda_base}/etc/profile.d/conda.sh
conda activate {SAM3D_ENV}
python {test_file}
rm -f {test_file}
"""
    
    try:
        if run_cmd(f"bash -c '{sam3d_cmd}'", timeout=600):
            log("SAM3D test passed! | SAM3D 测试通过！", "success")
        else:
            log("SAM3D test failed | SAM3D 测试失败", "error")
            return False
    except Exception as e:
        log(f"SAM3D test error: {e}", "error")
        return False
    
    log("All smoking tests passed! | 所有冒烟测试通过！", "success")
    return True

def start_server():
    """Start Flask and ngrok automatically 自动启动 Flask 和 ngrok"""
    log("Starting Server | 启动服务器", "header")
    
    # Pre-flight check: verify prompt.md exists (server will crash without it)
    # 预检查: 验证 prompt.md 存在（没有它服务器会崩溃）
    if not PROMPT_TEMPLATE_FILE.exists():
        log(f"❌ CRITICAL: Cannot start server - prompt.md not found!", "error")
        log(f"   Expected: {PROMPT_TEMPLATE_FILE}", "error")
        log("   服务器无法启动 - 请确保 prompt.md 文件存在", "error")
        return False
    
    conda_base = get_conda_base()
    app_file = BACKEND_FOLDER / "app.py"
    log_file = IW_FOLDER / "logs" / "flask.log"
    ngrok_log = IW_FOLDER / "logs" / "ngrok.log"
    
    # Create logs directory
    (IW_FOLDER / "logs").mkdir(parents=True, exist_ok=True)
    
    # Kill old processes 杀掉旧进程
    log("Cleaning up old processes | 清理旧进程...", "step")
    run_cmd("pkill -9 -f 'python.*app.py' || true", check=False)
    run_cmd("pkill -9 -f ngrok || true", check=False)
    run_cmd(f"fuser -k {FLASK_PORT}/tcp || true", check=False)
    time.sleep(2)
    
    # Start Flask 启动 Flask
    log(f"Starting Flask on port {FLASK_PORT} | 在端口 {FLASK_PORT} 启动 Flask...", "step")
    
    flask_start_script = f'''
#!/bin/bash
source {conda_base}/etc/profile.d/conda.sh
conda activate {SAM3_ENV}
cd {BACKEND_FOLDER}
export PORT={FLASK_PORT}
nohup python app.py > {log_file} 2>&1 &
echo $!
'''
    
    # Write and execute start script
    start_script_path = os.path.join(WORKSPACE, "start_flask.sh")
    with open(start_script_path, "w") as f:
        f.write(flask_start_script)
    os.chmod(start_script_path, 0o755)
    
    result = subprocess.run(
        ["bash", start_script_path],
        capture_output=True, text=True
    )
    flask_pid = result.stdout.strip()
    os.remove(start_script_path)
    
    # Wait for Flask to start
    time.sleep(3)
    
    # Check if Flask is running
    try:
        import requests
        response = requests.get(f"http://localhost:{FLASK_PORT}/health", timeout=5)
        if response.status_code == 200:
            log(f"Flask started successfully! PID: {flask_pid}", "success")
        else:
            log("Flask may not be responding correctly", "warning")
    except Exception as e:
        log(f"Flask health check failed: {e}", "warning")
    
    # Start ngrok 启动 ngrok
    log(f"Starting ngrok tunnel to {NGROK_DOMAIN} | 启动 ngrok 隧道...", "step")
    
    ngrok_cmd = f"nohup {NGROK_PATH} http --domain={NGROK_DOMAIN} {FLASK_PORT} > {ngrok_log} 2>&1 &"
    run_cmd(ngrok_cmd, check=False)
    
    time.sleep(3)
    
    # Check if ngrok is running
    result = subprocess.run(["pgrep", "-f", "ngrok"], capture_output=True, text=True)
    if result.returncode == 0:
        log(f"ngrok started successfully!", "success")
        log(f"Public URL: https://{NGROK_DOMAIN}", "success")
    else:
        log("ngrok may not have started correctly", "warning")
    
    return True

def print_summary():
    """Print setup summary 打印安装总结"""
    log("Setup Complete! | 安装完成！", "header")
    
    print(f"""
{Colors.GREEN}{'='*60}{Colors.END}
{Colors.BOLD}  🎉 All components installed successfully!{Colors.END}
{Colors.BOLD}  🎉 所有组件安装成功！{Colors.END}
{Colors.GREEN}{'='*60}{Colors.END}

{Colors.BOLD}Access URLs | 访问地址:{Colors.END}

  🌐 Public URL (ngrok):
     {Colors.CYAN}https://{NGROK_DOMAIN}{Colors.END}
  
  🖥️ Local URL:
     {Colors.CYAN}http://localhost:{FLASK_PORT}{Colors.END}

{Colors.BOLD}Useful Commands | 有用的命令:{Colors.END}

  View Flask logs | 查看 Flask 日志:
    tail -f {IW_FOLDER}/logs/flask.log
  
  View ngrok logs | 查看 ngrok 日志:
    tail -f {IW_FOLDER}/logs/ngrok.log
  
  Stop server | 停止服务:
    bash {SCRIPT_DIR}/stop.sh
  
  Restart server | 重启服务:
    bash {SCRIPT_DIR}/start.sh
  
  Re-run test | 重新测试:
    python {SCRIPT_DIR}/setup.py --test-only

{Colors.GREEN}{'='*60}{Colors.END}
""")

# ============================================================
# Main 主程序
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Imaginary World Setup Script | IW 安装脚本"
    )
    parser.add_argument("--test-only", action="store_true",
                       help="Only run smoking test | 仅运行测试")
    parser.add_argument("--skip-test", action="store_true",
                       help="Skip smoking test | 跳过测试")
    parser.add_argument("--skip-sam3", action="store_true",
                       help="Skip SAM3 setup | 跳过 SAM3 安装")
    parser.add_argument("--skip-sam3d", action="store_true",
                       help="Skip SAM3D setup | 跳过 SAM3D 安装")
    parser.add_argument("--skip-models", action="store_true",
                       help="Skip model download | 跳过模型下载")
    parser.add_argument("--api-only", action="store_true",
                       help="Only configure APIs | 仅配置 API")
    parser.add_argument("--start", action="store_true",
                       help="Start server after setup | 安装后启动服务器")
    parser.add_argument("--no-start", action="store_true",
                       help="Do not start server | 不启动服务器")
    parser.add_argument("--from-frozen", action="store_true",
                       help="Restore envs from exported snapshots | 从导出快照恢复环境")
    
    args = parser.parse_args()
    
    print(f"""
{Colors.CYAN}{'='*60}{Colors.END}
{Colors.BOLD}{Colors.CYAN}  🌟 Imaginary World Setup Script{Colors.END}
{Colors.BOLD}{Colors.CYAN}  🌟 IW 完整安装脚本{Colors.END}
{Colors.CYAN}{'='*60}{Colors.END}
    """)
    
    try:
        if args.test_only:
            # Only run tests
            setup_environment()
            run_smoking_test()
            return
        
        if args.api_only:
            # Only configure APIs
            update_env_file()
            test_openai_api()
            return
        
        # Full setup
        setup_environment()
        update_env_file()
        
        if args.from_frozen:
            # Restore from exported snapshots (faster & more reliable)
            # 从导出快照恢复（更快更可靠）
            restore_from_frozen()
        else:
            if not args.skip_sam3:
                setup_sam3()
            
            if not args.skip_sam3d:
                setup_sam3d()
        
        if not args.skip_models:
            download_checkpoints()
        
        install_flask_deps()
        install_ngrok()
        
        # Apply LocalStorage persistence patches
        # 应用 LocalStorage 持久化补丁
        apply_frontend_patches()
        
        if not args.skip_test:
            run_smoking_test()
        
        # Verify critical files before starting server
        # 在启动服务器前验证关键文件
        if not verify_critical_files():
            log("Cannot start server due to missing critical files!", "error")
            log("无法启动服务器 - 缺少关键文件！", "error")
            sys.exit(1)
        
        # Start server by default (unless --no-start)
        if not args.no_start:
            start_server()
        
        print_summary()
        
    except KeyboardInterrupt:
        log("\nSetup interrupted by user | 用户中断安装", "warning")
        sys.exit(1)
    except Exception as e:
        log(f"Setup failed: {e}", "error")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
