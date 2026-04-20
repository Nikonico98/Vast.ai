"""
RigAnything Test — Configuration
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# Paths
# ==========================================
BASE_DIR = Path(__file__).parent
WORKSPACE = Path(os.getenv("WORKSPACE", "/workspace"))
RIGANYTHING_DIR = WORKSPACE / "RigAnything"
RIGANYTHING_CKPT = RIGANYTHING_DIR / "ckpt" / "riganything_ckpt.pt"
RIGANYTHING_CONFIG = RIGANYTHING_DIR / "config.yaml"
RIGANYTHING_EXAMPLES = RIGANYTHING_DIR / "data_examples"

# Working directories
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# ==========================================
# OpenAI API
# ==========================================
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4")

# ==========================================
# RigAnything Inference
# ==========================================
CONDA_ENV = os.getenv("RIGANYTHING_CONDA_ENV", "riganything")
MAX_FACES = int(os.getenv("MAX_FACES", "80000"))
SIMPLIFY = True

# ==========================================
# Server
# ==========================================
SERVER_PORT = int(os.getenv("RIG_TEST_PORT", "8080"))
