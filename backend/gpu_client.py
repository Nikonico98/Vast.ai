"""
Imaginary World - GPU Client
==============================
HTTP client for communicating with GPU workers (RunPod + Vast.ai).
Supports dual backends with automatic failover.
"""

import os
import time
import requests
from pathlib import Path
from typing import Optional, Tuple
from job_manager import log

from config import get_gpu_url, get_all_gpu_urls, GPU_API_SECRET, VASTAI_BEARER_TOKEN, GPU_BACKEND


def _headers():
    headers = {"X-GPU-API-Key": GPU_API_SECRET}
    if VASTAI_BEARER_TOKEN:
        headers["Authorization"] = f"Bearer {VASTAI_BEARER_TOKEN}"
    return headers


def _get_gpu_url_with_failover() -> Tuple[str, str]:
    """
    Get GPU URL with failover. Returns (url, backend_name).
    In auto mode: tries primary, falls back to secondary.
    """
    urls = get_all_gpu_urls()
    primary_url = get_gpu_url()  # respects GPU_BACKEND setting

    if primary_url:
        # Identify which backend the primary is
        backend = "runpod" if primary_url == urls.get("runpod") else "vastai"
        return primary_url, backend

    # If primary failed, try the other one
    for name, url in urls.items():
        if url:
            return url, name

    return "", "none"


def _check_single_worker(gpu_url: str) -> dict:
    """Check health of a single GPU worker."""
    try:
        health = {}
        r = requests.get(f"{gpu_url}/api/gpu/health", timeout=10)
        if r.status_code == 200:
            health = r.json()
        try:
            r2 = requests.get(f"{gpu_url}/system-metrics", headers=_headers(), timeout=10)
            if r2.status_code == 200:
                metrics = r2.json()
                gpu_info = metrics.get("gpu", {})
                health["gpu_count"] = gpu_info.get("count", gpu_info.get("nvidia_count", 0))
                health["available_gpus"] = health["gpu_count"]
                health["gpu_metrics"] = gpu_info
                gpus = []
                for i in range(health["gpu_count"]):
                    gpus.append({
                        "id": i, "name": f"GPU {i}", "status": "idle",
                        "total_memory_mb": gpu_info.get("memory_total", 0) / max(health["gpu_count"], 1),
                        "free_memory_mb": (gpu_info.get("memory_total", 0) - gpu_info.get("memory_used", 0)) / max(health["gpu_count"], 1),
                        "utilization": gpu_info.get("avg_load_percent", 0),
                    })
                health["gpus"] = gpus
                if health.get("status") == "ok":
                    health["status"] = "healthy"
        except Exception:
            pass
        if not health.get("gpu_count"):
            try:
                r3 = requests.get(f"{gpu_url}/api/gpu/health", headers=_headers(), timeout=10)
                if r3.status_code == 200:
                    health.update(r3.json())
            except Exception:
                pass
        return health if health else {"status": "unreachable", "error": "No valid response"}
    except Exception as e:
        return {"status": "unreachable", "error": str(e)}


def gpu_worker_health() -> dict:
    """Check GPU worker health. Uses primary backend (with failover info)."""
    gpu_url, backend = _get_gpu_url_with_failover()
    if not gpu_url:
        return {"status": "unreachable", "error": "No GPU URL configured"}
    health = _check_single_worker(gpu_url)
    health["active_backend"] = backend
    health["gpu_url"] = gpu_url
    return health


def gpu_all_workers_health() -> dict:
    """Check health of ALL configured GPU backends."""
    urls = get_all_gpu_urls()
    result = {}
    for name, url in urls.items():
        if url:
            h = _check_single_worker(url)
            h["url"] = url
            result[name] = h
        else:
            result[name] = {"status": "not_configured", "url": ""}
    return result


def submit_3d_job(image_path: str, prompt: str, job_id: str) -> Optional[str]:
    """
    Submit an image + prompt to GPU worker for 3D generation.
    Tries primary backend first, falls back to secondary.
    """
    gpu_url, backend = _get_gpu_url_with_failover()
    if not gpu_url:
        log("GPU_CLIENT", "No GPU URL available")
        return None

    try:
        log("GPU_CLIENT", f"Submitting job {job_id} to {backend}: {gpu_url}")
        with open(image_path, "rb") as f:
            files = {"image": (os.path.basename(image_path), f, "image/png")}
            data = {"prompt": prompt, "job_id": job_id}
            r = requests.post(
                f"{gpu_url}/api/gpu/process",
                files=files,
                data=data,
                headers=_headers(),
                timeout=60,
            )

        if r.status_code == 200:
            result = r.json()
            remote_job_id = result.get("job_id", job_id)
            log("GPU_CLIENT", f"Job submitted successfully: {remote_job_id}")
            return remote_job_id
        else:
            log("GPU_CLIENT", f"Submit failed: HTTP {r.status_code} - {r.text[:200]}")
            return None
    except Exception as e:
        log("GPU_CLIENT", f"Submit error: {e}")
        return None


def poll_3d_status(remote_job_id: str) -> dict:
    """
    Poll the GPU worker for job status.

    Returns:
        {"status": "processing|completed|failed", "progress": int, ...}
    """
    try:
        r = requests.get(
            f"{get_gpu_url()}/api/gpu/status/{remote_job_id}",
            headers=_headers(),
            timeout=15,
        )
        if r.status_code == 200:
            return r.json()
        return {"status": "unknown", "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"status": "unknown", "error": str(e)}


def download_3d_result(remote_job_id: str, local_path: str) -> bool:
    """
    Download the generated GLB file from the GPU worker.

    Args:
        remote_job_id: Job ID on the GPU worker
        local_path: Where to save the GLB file locally

    Returns:
        True if download succeeded
    """
    try:
        r = requests.get(
            f"{get_gpu_url()}/api/gpu/download/{remote_job_id}",
            headers=_headers(),
            timeout=120,
            stream=True,
        )
        if r.status_code == 200:
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
            with open(local_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
            size = os.path.getsize(local_path)
            log("GPU_CLIENT", f"Downloaded GLB: {local_path} ({size:,} bytes)")
            return size > 0
        else:
            log("GPU_CLIENT", f"Download failed: HTTP {r.status_code}")
            return False
    except Exception as e:
        log("GPU_CLIENT", f"Download error: {e}")
        return False


def download_cutout(remote_job_id: str, local_path: str) -> bool:
    """Download the SAM3 cutout PNG from the GPU worker."""
    try:
        r = requests.get(
            f"{get_gpu_url()}/api/gpu/download_cutout/{remote_job_id}",
            headers=_headers(),
            timeout=60,
            stream=True,
        )
        if r.status_code == 200:
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
            with open(local_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
            return os.path.getsize(local_path) > 0
        return False
    except Exception as e:
        log("GPU_CLIENT", f"Cutout download error: {e}")
        return False


def run_remote_3d_pipeline(
    job_id: str,
    image_path: str,
    prompt: str,
    glb_output_path: str,
    cutout_output_path: str = None,
    timeout: int = 600,
    progress_callback=None,
) -> Tuple[bool, Optional[str]]:
    """
    Full workflow: submit job → poll until done → download GLB.

    Args:
        job_id: Local job ID
        image_path: Path to image
        prompt: SAM3 prompt
        glb_output_path: Where to save the GLB
        cutout_output_path: Where to save the cutout PNG (optional)
        timeout: Max seconds to wait
        progress_callback: Optional callable(step: str, progress: int) for live updates

    Returns:
        (success: bool, error_message: str or None)
    """
    remote_id = submit_3d_job(image_path, prompt, job_id)
    if not remote_id:
        return False, "Failed to submit job to GPU worker"

    start = time.time()
    poll_interval = 3  # seconds

    while time.time() - start < timeout:
        status = poll_3d_status(remote_id)
        state = status.get("status", "unknown")
        progress = status.get("progress", 0)
        step = status.get("step", "")

        log("GPU_CLIENT", f"[{job_id}] {state} - {step} ({progress}%)")

        # Forward live progress to Hostinger job store
        if progress_callback and state == "processing":
            progress_callback(step, progress)

        if state == "completed":
            if progress_callback:
                progress_callback("Downloading model", 90)
            ok = download_3d_result(remote_id, glb_output_path)
            if cutout_output_path:
                download_cutout(remote_id, cutout_output_path)
            if ok:
                return True, None
            else:
                return False, "GLB download failed"

        if state == "failed":
            return False, status.get("error", "GPU worker reported failure")

        time.sleep(poll_interval)

    return False, f"Timeout after {timeout}s"
