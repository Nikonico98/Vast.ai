"""
Imaginary World - Hostinger Configuration
===========================================
Configuration for Hostinger VPS deployment.
No GPU/SAM3/SAM3D dependencies.
"""

import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# Directory Configuration
# ==========================================
BASE_DIR = Path(__file__).parent.parent      # hostinger/
BACKEND_DIR = Path(__file__).parent          # hostinger/backend/
FRONTEND_FOLDER = BASE_DIR / "frontend"
DATA_FOLDER = BASE_DIR / "data"
DATA_FOLDER_TEST = BASE_DIR / "data_test"
TEMP_FOLDER = DATA_FOLDER / "temp"
JOBS_FILE = DATA_FOLDER / "jobs.json"
USER_COUNTER_FILE = DATA_FOLDER / "user_counter.json"

UPLOAD_FOLDER = DATA_FOLDER / "uploads"
RESULT_FOLDER = DATA_FOLDER / "results"
JOURNEYS_FOLDER = DATA_FOLDER / "journeys"

TEMPLATE_FOLDER = BACKEND_DIR / "templates"
TEMPLATE_FILE = TEMPLATE_FOLDER / "prompt.md"

# ==========================================
# Vast.ai GPU Worker URL
# ==========================================
# This is the URL of your Vast.ai GPU worker (set via .env or ngrok domain)
VASTAI_GPU_URL = os.getenv("VASTAI_GPU_URL", "http://213.181.122.2:50663")

# Shared secret for authenticating requests between Hostinger and Vast.ai
# Header name: X-GPU-API-Key
GPU_API_SECRET = os.getenv("GPU_API_SECRET", "niko2026IWSecretKey")

# Caddy Bearer token (not used on current instance - direct connection)
VASTAI_BEARER_TOKEN = os.getenv("VASTAI_BEARER_TOKEN", "")

# Vast.ai Instance Management API
VASTAI_API_KEY = os.getenv("VASTAI_API_KEY", "")
VASTAI_INSTANCE_ID = os.getenv("VASTAI_INSTANCE_ID", "")

# ==========================================
# AI API Configuration (OpenAI GPT-5.2)
# ==========================================
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.2")
OPENAI_TEMPERATURE = float(os.getenv("OPENAI_TEMPERATURE", "0.5"))

AI_MODEL = OPENAI_MODEL
AI_MODEL_VISION = OPENAI_MODEL
AI_TEMPERATURE = OPENAI_TEMPERATURE

# ==========================================
# Luma AI Image Generation
# ==========================================
LUMA_API_KEY = os.getenv("LUMA_API_KEY", "")
LUMA_API_BASE = "https://api.lumalabs.ai/dream-machine/v1"
LUMA_MODEL = os.getenv("LUMA_MODEL", "photon-1")

# ==========================================
# File Configuration
# ==========================================
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB

# ==========================================
# Server Configuration
# ==========================================
SERVER_PORT = int(os.getenv("PORT", 5000))
DEBUG_MODE = os.getenv("DEBUG", "false").lower() == "true"
SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_hex(32))

# ==========================================
# Imaginary World Definitions
# ==========================================
VALID_IMAGINARY_WORLDS = [
    "Historical", "Overlaid", "Alternate",
    "SciFi_Earth", "SciFi_Galaxy", "Fantasy"
]

WORLD_DISPLAY_NAMES = {
    "Historical": "Historical",
    "Overlaid": "Overlaid",
    "Alternate": "Alternate",
    "SciFi_Earth": "Sci-Fi Earth",
    "SciFi_Galaxy": "Sci-Fi Galaxy",
    "Fantasy": "Fantasy",
}

ACTION_TO_AR = {
    "Touch": "Tap",
    "Turning": "Rotate",
    "Following": "Track"
}

AR_INTERACTIONS_FALLBACK = {
    "Tap": "Tap to reveal the item.",
    "Rotate": "Rotate item to reveal.",
    "Track": "Track to unlock."
}

# ==========================================
# Create necessary directories
# ==========================================
for _folder in [FRONTEND_FOLDER, DATA_FOLDER, UPLOAD_FOLDER, RESULT_FOLDER, TEMP_FOLDER, JOURNEYS_FOLDER]:
    _folder.mkdir(parents=True, exist_ok=True)
