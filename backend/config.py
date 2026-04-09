"""
Imaginary World - Hostinger Configuration
===========================================
Configuration for Hostinger VPS deployment.
No GPU/SAM3/SAM3D dependencies.
"""

import os
import time
import secrets
import requests as _requests
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
# Manual override: if set, skip auto-discovery
VASTAI_GPU_URL_OVERRIDE = os.getenv("VASTAI_GPU_URL", "")

# Shared secret for authenticating requests between Hostinger and Vast.ai
# Header name: X-GPU-API-Key
GPU_API_SECRET = os.getenv("GPU_API_SECRET", "niko2026IWSecretKey")

# Caddy Bearer token (not used on current instance - direct connection)
VASTAI_BEARER_TOKEN = os.getenv("VASTAI_BEARER_TOKEN", "")

# Vast.ai Instance Management API
VASTAI_API_KEY = os.getenv("VASTAI_API_KEY", "")
VASTAI_INSTANCE_ID = os.getenv("VASTAI_INSTANCE_ID", "")

# GPU service container port (the port your GPU worker listens on INSIDE the container)
VASTAI_GPU_CONTAINER_PORT = int(os.getenv("VASTAI_GPU_CONTAINER_PORT", "1111"))

# ==========================================
# Auto-discover GPU URL from Vast.ai API
# ==========================================
_gpu_url_cache = {"url": None, "timestamp": 0}
_GPU_URL_CACHE_TTL = 300  # 5 minutes

def get_gpu_url() -> str:
    """
    Get the current GPU worker URL. Auto-discovers from Vast.ai API
    using the instance ID and port mappings. Caches for 5 minutes.
    Falls back to VASTAI_GPU_URL env var if auto-discovery fails.
    """
    # 1) Manual override always wins
    if VASTAI_GPU_URL_OVERRIDE:
        return VASTAI_GPU_URL_OVERRIDE.rstrip("/")

    # 2) Return cached value if fresh
    now = time.time()
    if _gpu_url_cache["url"] and (now - _gpu_url_cache["timestamp"]) < _GPU_URL_CACHE_TTL:
        return _gpu_url_cache["url"]

    # 3) Auto-discover via Vast.ai API
    if VASTAI_API_KEY and VASTAI_INSTANCE_ID:
        try:
            r = _requests.get(
                f"https://console.vast.ai/api/v0/instances/{VASTAI_INSTANCE_ID}/",
                headers={"Authorization": f"Bearer {VASTAI_API_KEY}"},
                timeout=15,
            )
            data = r.json()
            instance = data.get("instances", data)
            if isinstance(instance, list):
                instance = instance[0] if instance else {}

            public_ip = instance.get("public_ipaddr", "")
            ports = instance.get("ports", {})

            # Find the external port mapped to GPU_CONTAINER_PORT/tcp
            port_key = f"{VASTAI_GPU_CONTAINER_PORT}/tcp"
            if ports and port_key in ports:
                port_info = ports[port_key]
                # Vast.ai format: [{"HostIp": "0.0.0.0", "HostPort": "20700"}]
                if isinstance(port_info, list) and port_info:
                    external_port = port_info[0].get("HostPort", "")
                elif isinstance(port_info, dict):
                    external_port = port_info.get("HostPort", "")
                else:
                    external_port = ""

                if public_ip and external_port:
                    url = f"http://{public_ip}:{external_port}"
                    _gpu_url_cache["url"] = url
                    _gpu_url_cache["timestamp"] = now
                    return url
        except Exception:
            pass

    # 4) Return stale cache if available
    if _gpu_url_cache["url"]:
        return _gpu_url_cache["url"]

    return ""

# Keep a static reference for backward compat (used in startup print)
VASTAI_GPU_URL = VASTAI_GPU_URL_OVERRIDE or "(auto-discover)"

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
