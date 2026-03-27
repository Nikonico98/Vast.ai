"""
Imaginary World - GPU Client
==============================
HTTP client for communicating with the Vast.ai GPU worker.
Sends images + prompts to the GPU worker and retrieves results.
"""

import os
import time
import requests
from pathlib import Path
from typing import Optional, Tuple
from job_manager import log

from config import VASTAI_GPU_URL, GPU_API_SECRET, VASTAI_BEARER_TOKEN


def _headers():
    headers = {"X-API-Secret": GPU_API_SECRET}
    if VASTAI_BEARER_TOKEN:
        headers["Authorization"] = f"Bearer {VASTAI_BEARER_TOKEN}"
    return headers


def gpu_worker_health() -> dict:
    """Check if the Vast.ai GPU worker is reachable and healthy."""
    try:
        r = requests.get(f"{VASTAI_GPU_URL}/health", headers=_headers(), timeout=10)
        return r.json()
    except Exception as e:
        return {"status": "unreachable", "error": str(e)}


def submit_3d_job(image_path: str, prompt: str, job_id: str) -> Optional[str]:
    """
    Submit an image + prompt to the Vast.ai GPU worker for 3D generation.

    Args:
        image_path: Local path to the image file
        prompt: Simplified text prompt for SAM3 segmentation
        job_id: Job ID for tracking

    Returns:
        Remote job_id from GPU worker, or None on failure
    """
    try:
        log("GPU_CLIENT", f"Submitting job {job_id} to {VASTAI_GPU_URL}")
        with open(image_path, "rb") as f:
            files = {"image": (os.path.basename(image_path), f, "image/png")}
            data = {"prompt": prompt, "job_id": job_id}
            r = requests.post(
                f"{VASTAI_GPU_URL}/api/gpu/process",
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
            f"{VASTAI_GPU_URL}/api/gpu/status/{remote_job_id}",
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
            f"{VASTAI_GPU_URL}/api/gpu/download/{remote_job_id}",
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
            f"{VASTAI_GPU_URL}/api/gpu/download_cutout/{remote_job_id}",
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

        if state == "completed":
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
