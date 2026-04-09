"""
Imaginary World - Vast.ai GPU Worker Configuration
====================================================
Minimal config for the GPU-only worker.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

# ==========================================
# Directory Configuration
# ==========================================
BASE_DIR = Path(__file__).parent
DATA_FOLDER = BASE_DIR / "data"
TEMP_FOLDER = DATA_FOLDER / "temp"
RESULT_FOLDER = DATA_FOLDER / "results"
UPLOAD_FOLDER = DATA_FOLDER / "uploads"
JOBS_FILE = DATA_FOLDER / "jobs.json"

# ==========================================
# SAM3 / SAM3D Configuration
# ==========================================
WORKSPACE = os.getenv("WORKSPACE", "/workspace")
SAM3_ENV = os.getenv("SAM3_ENV", "sam3")
SAM3_REPO = os.getenv("SAM3_REPO", os.path.join(WORKSPACE, "sam3"))
SAM3D_ENV = os.getenv("SAM3D_ENV", "sam3d-objects")
SAM3D_REPO = os.getenv("SAM3D_REPO", os.path.join(WORKSPACE, "sam-3d-objects"))
SAM3D_CHECKPOINT = os.getenv("SAM3D_CHECKPOINT", "hf")

# ==========================================
# Hugging Face Token
# ==========================================
HF_TOKEN = os.getenv("HF_TOKEN", "")
if HF_TOKEN:
    os.environ["HF_TOKEN"] = HF_TOKEN
    os.environ["HUGGINGFACE_HUB_TOKEN"] = HF_TOKEN
    os.environ["HF_HOME"] = os.path.join(WORKSPACE, ".hf_home")

# ==========================================
# Server Configuration
# ==========================================
SERVER_PORT = int(os.getenv("GPU_WORKER_PORT", 9090))
GPU_API_SECRET = os.getenv("GPU_API_SECRET", "change-me-to-a-random-secret")

# ==========================================
# File Configuration
# ==========================================
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}

# ==========================================
# Create directories
# ==========================================
for _folder in [DATA_FOLDER, TEMP_FOLDER, RESULT_FOLDER, UPLOAD_FOLDER]:
    _folder.mkdir(parents=True, exist_ok=True)
