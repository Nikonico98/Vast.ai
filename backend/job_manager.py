"""
Imaginary World - GPU Worker Job Manager
==========================================
Minimal job tracking for the GPU worker.
"""

import os
import json
import uuid
import subprocess
import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, List

from config import JOBS_FILE, ALLOWED_EXTENSIONS, SAM3_ENV, SAM3_REPO, SAM3D_ENV


def log(context, message):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] [{context}] {message}", flush=True)


JOBS_LOCK = threading.Lock()


def load_jobs() -> Dict:
    if JOBS_FILE.exists():
        try:
            with open(JOBS_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}


def save_jobs(jobs: Dict):
    with open(JOBS_FILE, 'w') as f:
        json.dump(jobs, f, indent=2, default=str)


def create_job(job_id: str, prompt: str, input_file: str, boxes: List = None, points: List = None):
    with JOBS_LOCK:
        jobs = load_jobs()
        jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "prompt": prompt,
            "boxes": boxes or [],
            "points": points or [],
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "started_at": None,
            "completed_at": None,
            "current_step": "Queued",
            "progress": 0,
            "files": {"input": input_file},
            "error": None,
        }
        save_jobs(jobs)


def update_job_status(job_id: str, status: str, step: str = "", progress: int = 0,
                      error: str = None, files: Dict = None):
    with JOBS_LOCK:
        jobs = load_jobs()
        if job_id in jobs:
            jobs[job_id]["status"] = status
            jobs[job_id]["current_step"] = step
            jobs[job_id]["progress"] = progress
            jobs[job_id]["updated_at"] = datetime.now().isoformat()
            if error:
                jobs[job_id]["error"] = error
            if files:
                jobs[job_id]["files"].update(files)
            if status == "completed":
                jobs[job_id]["completed_at"] = datetime.now().isoformat()
            save_jobs(jobs)
    log(job_id, f"Status: {status} | Step: {step} | Progress: {progress}%")


def generate_job_id() -> str:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    unique = uuid.uuid4().hex[:6]
    return f"job_{timestamp}_{unique}"


def allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_conda_base() -> str:
    try:
        result = subprocess.run(["conda", "info", "--base"],
                               capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass
    for path in ["/opt/miniforge3", "/opt/conda", "/root/miniconda3"]:
        if os.path.exists(path):
            return path
    return "/opt/conda"


def get_conda_env_path(env_name: str) -> str:
    """Get the actual filesystem path of a conda environment."""
    try:
        result = subprocess.run(["conda", "env", "list"],
                               capture_output=True, text=True, timeout=10)
        for line in result.stdout.splitlines():
            if line.startswith('#') or not line.strip():
                continue
            parts = line.split()
            # Line format: "name  [*] /path" or "name  /path"
            for part in parts:
                if part.startswith('/'):
                    name_part = parts[0]
                    if name_part == env_name:
                        return part
    except:
        pass
    # Fallback: construct path from conda base
    return os.path.join(get_conda_base(), "envs", env_name)


def conda_env_exists(env_name: str) -> bool:
    try:
        result = subprocess.run(["conda", "env", "list"],
                               capture_output=True, text=True, timeout=10)
        return env_name in result.stdout
    except:
        return False


def _check_env_cuda(env_name: str, label: str):
    """Verify a conda env exists and has CUDA-enabled torch."""
    if not conda_env_exists(env_name):
        return False, f"{label} env '{env_name}' not found"
    env_path = get_conda_env_path(env_name)
    python_path = os.path.join(env_path, "bin", "python")
    if not os.path.exists(python_path):
        return False, f"Python not found in {label} env at {env_path}"
    try:
        result = subprocess.run(
            [python_path, "-c", "import torch; print(torch.cuda.is_available())"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return False, f"{label} check failed: {result.stderr[:150]}"
        if "True" not in result.stdout:
            return False, f"CUDA not available in {label} env"
        return True, f"{label} env ready (CUDA available)"
    except Exception as e:
        return False, f"{label} check error: {e}"


def verify_sam3_environment():
    return _check_env_cuda(SAM3_ENV, "SAM3")


def verify_sam3d_environment():
    return _check_env_cuda(SAM3D_ENV, "SAM3D")
