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
# RunPod GPU Worker URL
# ==========================================
# RunPod provides a stable HTTPS proxy URL:
#   https://{POD_ID}-{PORT}.proxy.runpod.net
# Set this in .env — it never changes as long as the Pod exists.
RUNPOD_GPU_URL = os.getenv("RUNPOD_GPU_URL", "")

# Vast.ai GPU Worker URL (can run alongside RunPod)
VASTAI_GPU_URL_OVERRIDE = os.getenv("VASTAI_GPU_URL", "")

# Shared secret for authenticating requests between Hostinger and GPU worker
# Header name: X-GPU-API-Key
GPU_API_SECRET = os.getenv("GPU_API_SECRET", "niko2026IWSecretKey")

# RunPod API Key (for Pod management: start/stop/status)
RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY", "")
RUNPOD_POD_ID = os.getenv("RUNPOD_POD_ID", "")

# Vast.ai keys
VASTAI_API_KEY = os.getenv("VASTAI_API_KEY", "")
VASTAI_INSTANCE_ID = os.getenv("VASTAI_INSTANCE_ID", "")
VASTAI_INSTANCE_LABEL = os.getenv("VASTAI_INSTANCE_LABEL", "Eric,Niko")
_VASTAI_LABELS = [l.strip() for l in VASTAI_INSTANCE_LABEL.split(",") if l.strip()]
VASTAI_BEARER_TOKEN = os.getenv("VASTAI_BEARER_TOKEN", "")
VASTAI_GPU_CONTAINER_PORT = int(os.getenv("VASTAI_GPU_CONTAINER_PORT", "1111"))

# GPU backend preference: "runpod", "vastai", or "auto" (try RunPod first, fallback to Vast.ai)
GPU_BACKEND = os.getenv("GPU_BACKEND", "auto")

# ==========================================
# GPU URL Resolution (Dual Backend: RunPod + Vast.ai)
# ==========================================

_gpu_url_cache = {"runpod": None, "vastai": None, "ts_runpod": 0, "ts_vastai": 0}
_GPU_URL_CACHE_TTL = 300  # 5 minutes


def _resolve_runpod_url() -> str:
    """Resolve RunPod GPU URL (static or auto-discover)."""
    if RUNPOD_GPU_URL:
        return RUNPOD_GPU_URL.rstrip("/")
    now = time.time()
    if _gpu_url_cache["runpod"] and (now - _gpu_url_cache["ts_runpod"]) < _GPU_URL_CACHE_TTL:
        return _gpu_url_cache["runpod"]
    if RUNPOD_API_KEY and RUNPOD_POD_ID:
        try:
            r = _requests.post(
                "https://api.runpod.io/graphql?api_key=" + RUNPOD_API_KEY,
                json={"query": '{ pod(input: {podId: "' + RUNPOD_POD_ID + '"}) { id runtime { ports { ip isIpPublic privatePort publicPort type } } } }'},
                timeout=15,
            )
            pod = r.json().get("data", {}).get("pod", {})
            if pod and pod.get("runtime"):
                url = f"https://{RUNPOD_POD_ID}-5555.proxy.runpod.net"
                _gpu_url_cache["runpod"] = url
                _gpu_url_cache["ts_runpod"] = now
                return url
        except Exception:
            pass
    return _gpu_url_cache.get("runpod", "") or ""


def _extract_vastai_url(instance: dict) -> str:
    """Extract GPU URL from a Vast.ai instance dict."""
    public_ip = instance.get("public_ipaddr", "")
    ports = instance.get("ports") or {}
    port_key = f"{VASTAI_GPU_CONTAINER_PORT}/tcp"
    if not (public_ip and port_key in ports):
        return ""
    port_info = ports[port_key]
    if isinstance(port_info, list) and port_info:
        external_port = port_info[0].get("HostPort", "")
    elif isinstance(port_info, dict):
        external_port = port_info.get("HostPort", "")
    else:
        return ""
    return f"http://{public_ip}:{external_port}" if external_port else ""


def _resolve_vastai_instance_id() -> str:
    """Auto-discover Vast.ai instance ID by label if not set.
    When multiple candidates exist, verifies GPU health to pick the right one."""
    global VASTAI_INSTANCE_ID
    if VASTAI_INSTANCE_ID:
        return VASTAI_INSTANCE_ID
    # Check cache
    cached = _gpu_url_cache.get("vastai_instance_id")
    if cached and (time.time() - _gpu_url_cache.get("ts_vastai_id", 0)) < _GPU_URL_CACHE_TTL:
        return cached
    if not VASTAI_API_KEY:
        return ""
    try:
        r = _requests.get(
            "https://console.vast.ai/api/v0/instances/",
            headers={"Authorization": f"Bearer {VASTAI_API_KEY}"},
            timeout=15,
        )
        data = r.json()
        instances = data.get("instances", data) if isinstance(data, dict) else data
        if not isinstance(instances, list):
            instances = [instances] if instances else []
        # Filter: running instances matching the label with the expected port
        candidates = [
            i for i in instances
            if i.get("actual_status") == "running"
            and (not _VASTAI_LABELS or i.get("label") in _VASTAI_LABELS)
            and f"{VASTAI_GPU_CONTAINER_PORT}/tcp" in (i.get("ports") or {})
        ]
        if not candidates:
            return ""
        if len(candidates) == 1:
            instance_id = str(candidates[0]["id"])
        else:
            # Multiple candidates — verify GPU health to pick the right one
            instance_id = ""
            candidates.sort(key=lambda i: i.get("start_date", 0), reverse=True)
            for c in candidates:
                url = _extract_vastai_url(c)
                if not url:
                    continue
                try:
                    hr = _requests.get(
                        f"{url}/api/gpu/health",
                        headers={"X-GPU-API-Key": GPU_API_SECRET},
                        timeout=8,
                    )
                    if hr.status_code == 200 and hr.json().get("status") in ("ok", "healthy"):
                        instance_id = str(c["id"])
                        # Cache the verified URL too
                        _gpu_url_cache["vastai"] = url
                        _gpu_url_cache["ts_vastai"] = time.time()
                        break
                except Exception:
                    continue
            if not instance_id:
                # Fallback: pick newest if none passed health check
                instance_id = str(candidates[0]["id"])
        _gpu_url_cache["vastai_instance_id"] = instance_id
        _gpu_url_cache["ts_vastai_id"] = time.time()
        return instance_id
    except Exception:
        pass
    return _gpu_url_cache.get("vastai_instance_id", "") or ""


def _resolve_vastai_url() -> str:
    """Resolve Vast.ai GPU URL (static or auto-discover)."""
    if VASTAI_GPU_URL_OVERRIDE:
        return VASTAI_GPU_URL_OVERRIDE.rstrip("/")
    now = time.time()
    if _gpu_url_cache["vastai"] and (now - _gpu_url_cache["ts_vastai"]) < _GPU_URL_CACHE_TTL:
        return _gpu_url_cache["vastai"]
    instance_id = _resolve_vastai_instance_id()
    # If instance discovery already cached the URL, return it
    if _gpu_url_cache["vastai"] and (time.time() - _gpu_url_cache["ts_vastai"]) < _GPU_URL_CACHE_TTL:
        return _gpu_url_cache["vastai"]
    if VASTAI_API_KEY and instance_id:
        try:
            r = _requests.get(
                f"https://console.vast.ai/api/v0/instances/{instance_id}/",
                headers={"Authorization": f"Bearer {VASTAI_API_KEY}"},
                timeout=15,
            )
            data = r.json()
            instance = data.get("instances", data)
            if isinstance(instance, list):
                instance = instance[0] if instance else {}
            url = _extract_vastai_url(instance)
            if url:
                _gpu_url_cache["vastai"] = url
                _gpu_url_cache["ts_vastai"] = now
                return url
        except Exception:
            pass
    return _gpu_url_cache.get("vastai", "") or ""


def get_gpu_url(backend: str = None) -> str:
    """
    Get GPU worker URL. Supports dual backends.

    Args:
        backend: Force a specific backend ("runpod" or "vastai").
                 None uses GPU_BACKEND setting ("auto" tries RunPod first).

    Returns:
        GPU worker URL string, or "" if none available.
    """
    target = backend or GPU_BACKEND

    if target == "runpod":
        return _resolve_runpod_url()
    elif target == "vastai":
        return _resolve_vastai_url()
    else:  # "auto" — try RunPod first, fallback to Vast.ai
        url = _resolve_runpod_url()
        if url:
            return url
        return _resolve_vastai_url()


def get_all_gpu_urls() -> dict:
    """Get URLs for all configured GPU backends."""
    return {
        "runpod": _resolve_runpod_url(),
        "vastai": _resolve_vastai_url(),
    }


# Keep a static reference for backward compat (used in startup print)
VASTAI_GPU_URL = VASTAI_GPU_URL_OVERRIDE or RUNPOD_GPU_URL or "(auto-discover)"

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
