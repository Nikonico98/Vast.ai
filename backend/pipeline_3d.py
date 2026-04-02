"""
Imaginary World - 3D Pipeline (SAM3 + SAM3D)
===============================================
Handles:
- SAM3 2D segmentation (text-prompted)
- SAM3D 3D reconstruction (GLB generation)
- GPU acquisition via GPU_POOL
- Fallback to placeholder models on failure

Usage:
    from pipeline_3d import run_3d_pipeline

    # Start 3D pipeline in a background thread
    threading.Thread(
        target=run_3d_pipeline,
        args=(job_id, image_path, prompt),
        kwargs={"output_path": output_path}
    ).start()
"""

import os
import shutil
import subprocess
import threading
import time
import numpy as np
from datetime import datetime
from pathlib import Path
from typing import List

from config import (
    WORKSPACE, SAM3_ENV, SAM3_REPO, SAM3D_ENV, SAM3D_REPO, SAM3D_CHECKPOINT,
    HF_TOKEN, TEMP_FOLDER, RESULT_FOLDER
)
from job_manager import (
    log, load_jobs, save_jobs, update_job_status,
    get_conda_base, verify_sam3_environment, verify_sam3d_environment, JOBS_LOCK
)
from gpu_pool import GPU_POOL
from glb_processor import recenter_glb_origin_to_bottom, add_default_pbr_material, create_placeholder_glb

import json
import urllib.request as _urllib_request

# ==========================================
# Per-GPU Pipeline Lock (one full pipeline per GPU at a time)
# ==========================================
# Ensures only ONE SAM3+SAM3D pipeline runs per physical GPU.
# This guarantees SAM3 inference and SAM3D inference on the same GPU
# never overlap between different jobs, eliminating OOM risk entirely.
#
# VRAM budget with lock (per GPU, 24GB):
#   SAM3 idle(~4GB) + SAM3D idle(~13GB) = ~17GB baseline
#   SAM3 inference spike: +1-2GB → ~18-19GB
#   SAM3D inference peak @1024px: +1-2GB above idle → ~18-19GB
#   Never concurrent → peak never exceeds ~19GB → ~5GB headroom always
_GPU_PIPELINE_LOCKS = {}
_GPU_LOCKS_INIT = threading.Lock()

def _get_gpu_pipeline_lock(gpu_id: int) -> threading.Lock:
    """Get or create a per-GPU pipeline lock."""
    with _GPU_LOCKS_INIT:
        if gpu_id not in _GPU_PIPELINE_LOCKS:
            _GPU_PIPELINE_LOCKS[gpu_id] = threading.Lock()
        return _GPU_PIPELINE_LOCKS[gpu_id]

# ==========================================
# Model Server Configuration (Dual-GPU)
# ==========================================
# GPU 0 servers (real/photo pipeline) — SAM3 + SAM3D (persistent)
SAM3_SERVER_URL_GPU0 = os.getenv("SAM3_SERVER_URL_GPU0", "http://127.0.0.1:5561")
SAM3D_SERVER_URL_GPU0 = os.getenv("SAM3D_SERVER_URL_GPU0", "http://127.0.0.1:5562")
# GPU 1 servers (fictional pipeline) — SAM3 + SAM3D (persistent)
SAM3_SERVER_URL_GPU1 = os.getenv("SAM3_SERVER_URL_GPU1", "http://127.0.0.1:5571")
SAM3D_SERVER_URL_GPU1 = os.getenv("SAM3D_SERVER_URL_GPU1", "http://127.0.0.1:5572")
# Legacy (backward compat)
SAM3_SERVER_URL = os.getenv("SAM3_SERVER_URL", "http://127.0.0.1:5561")

def _get_sam3_server_url(gpu_id):
    """Get SAM3 server URL for a given GPU."""
    if gpu_id == 1:
        return SAM3_SERVER_URL_GPU1
    return SAM3_SERVER_URL_GPU0

def _get_sam3d_server_url(gpu_id):
    """Get SAM3D server URL for a given GPU."""
    if gpu_id == 1:
        return SAM3D_SERVER_URL_GPU1
    return SAM3D_SERVER_URL_GPU0


def _is_server_available(base_url, timeout=2):
    """Check if a persistent model server is up and has model loaded."""
    try:
        req = _urllib_request.Request(f"{base_url}/health")
        with _urllib_request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data.get("model_loaded", False)
    except Exception:
        return False


def _call_model_server(url, payload, timeout=600):
    """Send a JSON request to a model server and return the response."""
    data = json.dumps(payload).encode('utf-8')
    req = _urllib_request.Request(
        url, data=data,
        headers={'Content-Type': 'application/json'}
    )
    with _urllib_request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def _run_sam3(job_id, test_png, prompt, mask_png, cutout_png, gpu_id, conda_base, temp_dir):
    """Run SAM3 segmentation via persistent server or subprocess fallback."""
    start = time.time()

    sam3_url = _get_sam3_server_url(gpu_id)
    if _is_server_available(sam3_url):
        log(job_id, f"   🚀 Using persistent SAM3 server on GPU {gpu_id} ({sam3_url})")
        try:
            resp = _call_model_server(f"{sam3_url}/segment", {
                "image_path": str(test_png),
                "prompt": prompt,
                "mask_path": str(mask_png),
                "cutout_path": str(cutout_png),
            }, timeout=300)
            elapsed = time.time() - start
            log(job_id, f"   ⏱️ SAM3 completed in {elapsed:.1f}s (server mode)")
            if resp.get("success"):
                cov = resp.get('mask_coverage', 0)
                conf = resp.get('confidence', 0)
                log(job_id, f"   📏 Mask coverage: {cov*100:.2f}%, confidence: {conf:.2f}")
                return elapsed, True
            else:
                log(job_id, f"   ❌ SAM3 server error: {resp.get('error', 'Unknown')}")
                return elapsed, False
        except Exception as e:
            log(job_id, f"   ❌ SAM3 server call failed: {e}, falling back to subprocess")

    # Subprocess fallback
    log(job_id, "   ⚠️ SAM3 server not available, using subprocess (slower - includes model loading)")
    sam3_script = _build_sam3_script(prompt, test_png, mask_png, cutout_png)
    sam3_script_file = Path(temp_dir) / f"{job_id}_sam3_script.py"
    with open(sam3_script_file, 'w', encoding='utf-8') as f:
        f.write(sam3_script)
    sam3_cmd = f'''export CUDA_VISIBLE_DEVICES={gpu_id}
source {conda_base}/etc/profile.d/conda.sh
conda activate {SAM3_ENV}
python "{sam3_script_file}"
'''
    result = subprocess.run(
        ["bash", "-c", sam3_cmd],
        cwd=str(WORKSPACE), capture_output=True, text=True, timeout=600
    )
    elapsed = time.time() - start
    log(job_id, f"   ⏱️ SAM3 completed in {elapsed:.1f}s (subprocess mode)")
    _log_subprocess_result(job_id, "SAM3", result)
    return elapsed, result.returncode == 0


def _run_sam3d(job_id, input_png, glb_out, gpu_id, conda_base, temp_dir):
    """Run SAM3D reconstruction via persistent server or subprocess fallback.
    
    Tries the persistent SAM3D server first (model already in VRAM, fast).
    Falls back to on-demand subprocess if server is unavailable.
    """
    start = time.time()

    # Try persistent SAM3D server first
    sam3d_url = _get_sam3d_server_url(gpu_id)
    if _is_server_available(sam3d_url):
        log(job_id, f"   🚀 Using persistent SAM3D server on GPU {gpu_id} ({sam3d_url})")
        try:
            resp = _call_model_server(f"{sam3d_url}/reconstruct", {
                "cutout_path": str(input_png),
                "glb_path": str(glb_out),
                "job_id": job_id,
            }, timeout=600)
            elapsed = time.time() - start
            log(job_id, f"   ⏱️ SAM3D completed in {elapsed:.1f}s (server mode)")
            if resp.get("success"):
                glb_size = resp.get('glb_size', 0)
                log(job_id, f"   ✅ SAM3D GLB: {glb_size:,} bytes")
                return elapsed, True
            else:
                log(job_id, f"   ❌ SAM3D server error: {resp.get('error', 'Unknown')}")
                return elapsed, False
        except Exception as e:
            log(job_id, f"   ❌ SAM3D server call failed: {e}, falling back to subprocess")

    # Subprocess fallback (model loaded per-job, slower but always works)
    log(job_id, f"   ⚠️ SAM3D server not available, using subprocess on GPU {gpu_id} (slower - includes model loading)")
    sam3d_script = _build_sam3d_script(input_png, glb_out, job_id)
    sam3d_script_file = Path(temp_dir) / f"{job_id}_sam3d_script.py"
    with open(sam3d_script_file, 'w', encoding='utf-8') as f:
        f.write(sam3d_script)
    sam3d_cmd = f'''export CUDA_VISIBLE_DEVICES={gpu_id}
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
source {conda_base}/etc/profile.d/conda.sh
conda activate {SAM3D_ENV}
cd {SAM3D_REPO}
python "{sam3d_script_file}"
'''

    # Acquire per-GPU SAM3D lock to prevent OOM from concurrent subprocess inference
    gpu_lock = _get_sam3d_gpu_lock(gpu_id)
    log(job_id, f"   🔒 Waiting for SAM3D GPU {gpu_id} lock...")
    gpu_lock.acquire()
    log(job_id, f"   🔓 SAM3D GPU {gpu_id} lock acquired")
    try:
        result = subprocess.run(
            ["bash", "-c", sam3d_cmd],
            cwd=str(SAM3D_REPO), capture_output=True, text=True, timeout=1200
        )
    finally:
        gpu_lock.release()
        log(job_id, f"   🔒 SAM3D GPU {gpu_id} lock released")

    elapsed = time.time() - start
    log(job_id, f"   ⏱️ SAM3D completed in {elapsed:.1f}s (subprocess fallback)")
    _log_subprocess_result(job_id, "SAM3D", result, stdout_lines=15, stderr_lines=10)
    return elapsed, result.returncode == 0


def run_3d_pipeline(job_id: str, image_path: str, prompt: str,
                    points: List = None, boxes: List = None,
                    output_path: str = None, temp_folder = None,
                    cutout_output_path: str = None):
    """
    Run the SAM3+SAM3D pipeline for 3D model generation.

    Uses GPU_POOL to acquire a GPU for this job. In parallel mode,
    multiple jobs can run on different GPUs simultaneously.

    Steps:
    1. SAM3 Segmentation (2D mask)
    2. SAM3D 3D Reconstruction (GLB file)

    Args:
        job_id: Unique job identifier
        image_path: Path to input image
        prompt: Text prompt for segmentation (e.g. "teddy bear")
        points: Optional point prompts
        boxes: Optional box prompts
        output_path: Optional custom output path for GLB file
        temp_folder: Optional temp folder path (defaults to global TEMP_FOLDER)
        cutout_output_path: Optional path to copy the SAM3 cutout PNG to (e.g. user's cutouts/ folder)
    """
    # Determine GPU based on job type:
    #   _photo_  jobs → GPU 0 (real items)
    #   _fictional_ jobs → GPU 1 (fictional items)
    #   other jobs → acquire from pool
    if "_photo_" in job_id:
        gpu_id = 0
        log(job_id, f"📌 Photo job → assigned to GPU 0")
    elif "_fictional_" in job_id:
        gpu_id = 1
        log(job_id, f"📌 Fictional job → assigned to GPU 1")
    else:
        # Non-paired job (manual /api/process), use pool
        log(job_id, f"⏳ Waiting for GPU (mode: {GPU_POOL.get_mode()}, available: {GPU_POOL.get_available_count()}/{GPU_POOL.get_gpu_count()})...")
        gpu_id = GPU_POOL.acquire(timeout=600)
        if gpu_id is None:
            log(job_id, "❌ Failed to acquire GPU (timeout)")
            update_job_status(job_id, "failed", "GPU acquisition timeout", 0)
            return

    # Resolve temp folder
    resolved_temp = Path(temp_folder) if temp_folder else TEMP_FOLDER
    resolved_temp.mkdir(parents=True, exist_ok=True)

    # Only release pool if we acquired from it (non-paired jobs)
    used_pool = "_photo_" not in job_id and "_fictional_" not in job_id

    try:
        # Acquire per-GPU pipeline lock: only ONE SAM3+SAM3D pipeline per GPU at a time
        gpu_lock = _get_gpu_pipeline_lock(gpu_id)
        log(job_id, f"🔒 Waiting for GPU {gpu_id} pipeline lock...")
        gpu_lock.acquire()
        log(job_id, f"🔓 GPU {gpu_id} pipeline lock acquired, starting pipeline...")
        try:
            _run_3d_pipeline_internal(job_id, image_path, prompt, points, boxes, output_path, gpu_id, resolved_temp, cutout_output_path)
        finally:
            gpu_lock.release()
            log(job_id, f"🔒 GPU {gpu_id} pipeline lock released")
        log(job_id, f"🔒 Done with GPU {gpu_id}")
    finally:
        if used_pool:
            GPU_POOL.release(gpu_id)


def _run_3d_pipeline_internal(job_id: str, image_path: str, prompt: str,
                              points: List = None, boxes: List = None,
                              output_path: str = None, gpu_id: int = 0,
                              temp_folder: Path = None, cutout_output_path: str = None):
    """Internal implementation of 3D pipeline (called with GPU acquired)"""
    start_time = time.time()
    conda_base = get_conda_base()

    # Use provided temp_folder or global default
    temp_dir = temp_folder if temp_folder else TEMP_FOLDER
    temp_dir.mkdir(parents=True, exist_ok=True)

    # Pre-flight check: Verify SAM3 environment (2D segmentation)
    log(job_id, "🔍 Pre-flight check: Verifying SAM3 environment...")
    sam3_ok, sam3_msg = verify_sam3_environment()
    if not sam3_ok:
        log(job_id, f"⚠️ SAM3 environment check failed: {sam3_msg}")
        log(job_id, "💡 SAM3 segmentation will use fallback (full image mask).")
        log(job_id, "   To fix: conda activate sam3 && pip install setuptools")
    else:
        log(job_id, f"✅ {sam3_msg}")

    # Pre-flight check: Verify SAM3D environment (3D reconstruction)
    log(job_id, "🔍 Pre-flight check: Verifying SAM3D environment...")
    sam3d_ok, sam3d_msg = verify_sam3d_environment()
    if not sam3d_ok:
        log(job_id, f"❌ SAM3D environment check failed: {sam3d_msg}")
        log(job_id, "💡 To fix this issue, run on your Vast.ai server:")
        log(job_id, "   cd /workspace/IW/setup && bash fix_sam3d_env.sh")
        update_job_status(job_id, "failed", f"SAM3D environment not ready: {sam3d_msg}", 0)

        # Create placeholder so the job shows something
        glb_out = Path(output_path) if output_path else RESULT_FOLDER / f"{job_id}.glb"
        create_placeholder_glb(str(glb_out))
        return
    else:
        log(job_id, f"✅ {sam3d_msg}")

    # Output paths
    test_png = temp_dir / f"{job_id}_test.png"
    cutout_png = temp_dir / f"{job_id}_cutout.png"
    mask_png = temp_dir / f"{job_id}_mask.png"
    glb_out = Path(output_path) if output_path else RESULT_FOLDER / f"{job_id}.glb"
    glb_out.parent.mkdir(parents=True, exist_ok=True)

    try:
        log(job_id, "=" * 50)
        log(job_id, "🚀 Starting SAM3+SAM3D Pipeline")
        log(job_id, f"   Prompt: {prompt}")
        log(job_id, f"   🏠 Environment Check:")
        log(job_id, f"   - WORKSPACE: {WORKSPACE}")
        log(job_id, f"   - SAM3_REPO: {SAM3_REPO}")
        log(job_id, f"   - SAM3D_REPO: {SAM3D_REPO}")
        log(job_id, f"   - Conda base: {conda_base}")
        log(job_id, f"   ✅ Running on Vast.ai - SAM3/SAM3D should work!")
        log(job_id, "=" * 50)

        update_job_status(job_id, "processing", "Initializing", 5)

        # Update started_at (thread-safe)
        with JOBS_LOCK:
            jobs = load_jobs()
            if job_id in jobs:
                jobs[job_id]["started_at"] = datetime.now().isoformat()
                save_jobs(jobs)
            else:
                log(job_id, f"⚠️ Job {job_id} not found in jobs, creating it now...")
                jobs[job_id] = {
                    "job_id": job_id,
                    "status": "processing",
                    "prompt": prompt,
                    "created_at": datetime.now().isoformat(),
                    "started_at": datetime.now().isoformat(),
                    "updated_at": datetime.now().isoformat(),
                    "current_step": "Initializing",
                    "progress": 5,
                    "files": {"input": image_path},
                    "error": None
                }
                save_jobs(jobs)

        # ========================================
        # Step 1: Prepare Image
        # ========================================
        log(job_id, "📁 Step 1/3: Preparing image...")
        update_job_status(job_id, "processing", "Preparing image", 10)

        log(job_id, f"📋 Input validation:")
        log(job_id, f"   - Source image: {image_path}")
        log(job_id, f"   - Target image: {test_png}")
        log(job_id, f"   - Text prompt: '{prompt}'")

        if not os.path.exists(image_path):
            log(job_id, f"   ❌ Source image does not exist: {image_path}")
            update_job_status(job_id, "failed", "Source image not found", 0)
            return

        source_size = os.path.getsize(image_path)
        log(job_id, f"   📊 Source image size: {source_size:,} bytes")

        shutil.copy(image_path, test_png)

        if not test_png.exists():
            log(job_id, f"   ❌ Failed to copy image to {test_png}")
            update_job_status(job_id, "failed", "Image copy failed", 0)
            return

        target_size = os.path.getsize(test_png)
        log(job_id, f"   ✅ Image copied successfully")
        log(job_id, f"   📊 Target image size: {target_size:,} bytes")

        # Verify image is valid
        try:
            from PIL import Image
            with Image.open(test_png) as img:
                log(job_id, f"   📊 Image dimensions: {img.size[0]}x{img.size[1]}")
                log(job_id, f"   📊 Image mode: {img.mode}")
                log(job_id, f"   ✅ Image validation passed")
        except Exception as e:
            log(job_id, f"   ❌ Image validation failed: {e}")
            update_job_status(job_id, "failed", "Invalid image format", 0)
            return

        # ========================================
        # Step 2: SAM3 Segmentation
        # ========================================
        log(job_id, "🔍 Step 2/3: SAM3 Segmentation...")
        update_job_status(job_id, "processing", "SAM3 Segmentation", 30)

        sam3_start = time.time()
        sam3_time, sam3_success = _run_sam3(
            job_id, str(test_png), prompt, str(mask_png), str(cutout_png),
            gpu_id, conda_base, temp_dir
        )

        # Check output files
        log(job_id, f"   📁 Checking SAM3 output files:")
        log(job_id, f"   - Mask file: {mask_png} {'✅' if mask_png.exists() else '❌'}")
        log(job_id, f"   - Cutout file: {cutout_png} {'✅' if cutout_png.exists() else '❌'}")

        if mask_png.exists():
            mask_size = os.path.getsize(mask_png)
            log(job_id, f"     📊 Mask size: {mask_size:,} bytes")

        if cutout_png.exists():
            cutout_size = os.path.getsize(cutout_png)
            log(job_id, f"     📊 Cutout size: {cutout_size:,} bytes")
        else:
            log(job_id, "   ❌ SAM3 did not generate cutout.png")
            sam3_success = False

        # Create fallback cutout if SAM3 failed
        if not sam3_success:
            log(job_id, "   🔧 Creating fallback cutout (full image)...")
            try:
                from PIL import Image
                img = Image.open(test_png).convert("RGB")
                img_np = np.array(img)
                alpha = np.ones((img_np.shape[0], img_np.shape[1]), dtype=np.uint8) * 255
                rgba = np.concatenate([img_np, alpha[..., None]], axis=2)
                Image.fromarray(rgba, "RGBA").save(cutout_png)
                log(job_id, "   ✅ Fallback cutout created")
            except Exception as e:
                log(job_id, f"   ❌ Failed to create fallback: {e}")
                update_job_status(job_id, "failed", "Image Processing Failed", 0, error=str(e))
                return
        else:
            log(job_id, "   ✅ SAM3 segmentation complete")

        # Copy cutout to user folder if requested
        if cutout_output_path and cutout_png.exists():
            try:
                cutout_dest = Path(cutout_output_path)
                cutout_dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(cutout_png, cutout_dest)
                log(job_id, f"   📋 Cutout saved to user folder: {cutout_dest}")
            except Exception as e:
                log(job_id, f"   ⚠️ Failed to copy cutout to user folder: {e}")

        update_job_status(job_id, "processing", "SAM3 Complete", 50)

        # ========================================
        # Step 3: SAM3D 3D Reconstruction
        # ========================================
        log(job_id, "🎨 Step 3/3: SAM3D 3D Reconstruction...")
        update_job_status(job_id, "processing", "SAM3D Reconstruction", 60)

        sam3d_total_time = 0.0
        sam3d_success = False
        sam3d_input_used = ""

        # Prefer SAM3 cutout first. If it fails, retry SAM3D with the original image
        # before falling back to placeholder.
        sam3d_attempts = [
            ("SAM3 cutout", str(cutout_png)),
            ("original image", str(test_png)),
        ]

        for attempt_idx, (attempt_name, attempt_input) in enumerate(sam3d_attempts, start=1):
            if attempt_idx > 1:
                update_job_status(job_id, "processing", f"SAM3D Retry ({attempt_name})", 70)
                log(job_id, f"   🔁 Retry {attempt_idx - 1}: SAM3D using {attempt_name}")
            else:
                log(job_id, f"   🎯 Attempt {attempt_idx}: SAM3D using {attempt_name}")

            attempt_time, attempt_success = _run_sam3d(
                job_id, attempt_input, str(glb_out), gpu_id, conda_base, temp_dir
            )
            sam3d_total_time += attempt_time

            glb_valid = glb_out.exists() and os.path.getsize(glb_out) > 1000
            if attempt_success and glb_valid:
                sam3d_success = True
                sam3d_input_used = attempt_name
                break

            # Clean invalid partial output before next retry.
            if glb_out.exists():
                try:
                    glb_size = os.path.getsize(glb_out)
                    if glb_size <= 1000:
                        glb_out.unlink(missing_ok=True)
                except Exception:
                    pass

            if attempt_idx < len(sam3d_attempts):
                log(job_id, f"   ⚠️ SAM3D attempt failed with {attempt_name}, trying next strategy...")

        # Check GLB output
        log(job_id, f"   📁 Checking SAM3D output:")
        log(job_id, f"   - Expected GLB: {glb_out}")
        log(job_id, f"   - GLB exists: {'✅' if glb_out.exists() else '❌'}")

        if glb_out.exists():
            glb_size = os.path.getsize(glb_out)
            log(job_id, f"     📊 GLB file size: {glb_size:,} bytes")
            if glb_size > 1000:
                log(job_id, f"     ✅ GLB appears to contain real data")
            else:
                log(job_id, f"     ⚠️ GLB is very small, might be placeholder")

        # Check if SAM3D failed and create placeholder
        if not sam3d_success:
            log(job_id, f"   🔧 Creating placeholder GLB...")
            create_placeholder_glb(str(glb_out))
        else:
            log(job_id, f"   ✅ SAM3D succeeded with {sam3d_input_used}")

        if not glb_out.exists():
            log(job_id, "   ❌ SAM3D did not generate GLB file")
            log(job_id, f"   🔧 Creating placeholder GLB...")
            create_placeholder_glb(str(glb_out))

        log(job_id, "   ✅ SAM3D reconstruction complete")

        # ========================================
        # Step 4: Adjust Model Origin for AR
        # ========================================
        if glb_out.exists():
            glb_size = os.path.getsize(glb_out)
            if glb_size > 5000:  # Only process real models
                log(job_id, "🔧 Step 4: Adjusting model origin for AR...")
                update_job_status(job_id, "processing", "Adjusting Origin", 93)

                success = recenter_glb_origin_to_bottom(str(glb_out), job_id)
                if success:
                    log(job_id, "   ✅ Model origin adjusted to bottom center")
                else:
                    log(job_id, "   ⚠️ Origin adjustment skipped or failed")

                # Add default PBR material for proper lighting/reflections
                log(job_id, "🎨 Adding PBR material for AR lighting...")
                pbr_ok = add_default_pbr_material(str(glb_out), job_id)
                if pbr_ok:
                    log(job_id, "   ✅ PBR material added")
                else:
                    log(job_id, "   ⚠️ PBR material skipped (already has materials or failed)")
            else:
                log(job_id, "   ⚠️ Skipping origin adjustment for placeholder model")

        update_job_status(job_id, "processing", "SAM3D Complete", 95)

        # ========================================
        # Finalize
        # ========================================
        total_time = time.time() - start_time

        final_glb_exists = glb_out.exists()
        final_glb_size = os.path.getsize(glb_out) if final_glb_exists else 0

        log(job_id, "=" * 50)
        log(job_id, "🎉 Pipeline Complete!")
        log(job_id, f"   📊 Performance:")
        log(job_id, f"   - Total time: {total_time:.1f}s ({total_time/60:.1f}min)")
        log(job_id, f"   - SAM3: {sam3_time:.1f}s")
        log(job_id, f"   - SAM3D: {sam3d_total_time:.1f}s")
        log(job_id, f"   📁 Final Results:")
        log(job_id, f"   - GLB file: {glb_out}")
        log(job_id, f"   - GLB exists: {'✅' if final_glb_exists else '❌'}")
        log(job_id, f"   - GLB size: {final_glb_size:,} bytes")

        if final_glb_size > 5000:
            log(job_id, f"   🎯 Result: REAL 3D MODEL generated!")
        elif final_glb_size > 1000:
            log(job_id, f"   🤔 Result: Small 3D model (might be basic)")
        else:
            log(job_id, f"   ⚠️ Result: PLACEHOLDER CUBE (pipeline failed)")

        log(job_id, "=" * 50)

        # Cleanup temp files (keep cutout/mask/test images for debugging)
        try:
            sam3_script_file.unlink(missing_ok=True)
            sam3d_script_file.unlink(missing_ok=True)
            # Keep these for inspection:
            #   {job_id}_test.png    - original input image
            #   {job_id}_cutout.png  - SAM3 foreground cutout (RGBA, BG zeroed)
            #   {job_id}_mask.png    - SAM3 binary mask
            log(job_id, f"   📁 Debug images kept in temp:")
            log(job_id, f"      - {test_png.name}")
            log(job_id, f"      - {cutout_png.name}")
            log(job_id, f"      - {mask_png.name}")
        except:
            pass

        files_payload = {"glb": str(glb_out)}
        if cutout_output_path and Path(cutout_output_path).exists():
            files_payload["cutout"] = str(cutout_output_path)

        update_job_status(
            job_id,
            "completed",
            "Complete",
            100,
            files=files_payload
        )

    except subprocess.TimeoutExpired:
        log(job_id, "❌ Pipeline timeout")
        update_job_status(job_id, "failed", "Timeout", 0, error="Pipeline timeout")
    except Exception as e:
        import traceback
        log(job_id, f"❌ Pipeline error: {type(e).__name__}: {e}")
        log(job_id, f"Traceback: {traceback.format_exc()}")
        update_job_status(job_id, "failed", "Error", 0, error=str(e))


def _log_subprocess_result(job_id: str, step_name: str, result,
                           stdout_lines: int = 10, stderr_lines: int = 5):
    """Log subprocess execution results in a consistent format."""
    log(job_id, f"   📋 {step_name} execution results:")
    log(job_id, f"   - Return code: {result.returncode}")
    log(job_id, f"   - stdout length: {len(result.stdout)} chars")
    log(job_id, f"   - stderr length: {len(result.stderr)} chars")

    if result.stdout:
        log(job_id, f"   📝 {step_name} stdout preview:")
        lines = result.stdout.strip().split('\n')[-stdout_lines:]
        for line in lines:
            log(job_id, f"      {line}")

    if result.stderr:
        log(job_id, f"   ⚠️ {step_name} stderr:")
        lines = result.stderr.strip().split('\n')[-stderr_lines:]
        for line in lines:
            log(job_id, f"      {line}")


def _build_sam3_script(prompt: str, test_png: Path, mask_png: Path, cutout_png: Path) -> str:
    """Build the SAM3 segmentation Python script as a string."""
    return f'''import os, sys
import numpy as np
from PIL import Image, ImageOps
import torch

print("🚀 SAM3 Starting...")
print(f"📝 Text prompt: '{prompt}'")

os.environ["HF_HOME"] = "{WORKSPACE}/.hf_home"
sys.path.insert(0, "{SAM3_REPO}")

try:
    from sam3.model_builder import build_sam3_image_model
    from sam3.model.sam3_image_processor import Sam3Processor
    print("✅ SAM3 modules imported successfully")
except ImportError as e:
    print(f"❌ SAM3 import error: {{e}}")
    sys.exit(1)

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"🖥️ Device: {{device}}")

print("📦 Loading SAM3 model...")
model = build_sam3_image_model().to(device).eval()
# Use lower confidence_threshold (0.15) so real-world photo detections
# are not filtered out by the processor. Our script applies its own
# MIN_CONFIDENCE check (0.3) on the returned scores.
processor = Sam3Processor(model, confidence_threshold=0.15)
print("✅ SAM3 model loaded (confidence_threshold=0.15)")

# ============================================
# Pre-process image for better segmentation
# ============================================
print(f"🖼️ Loading image: {test_png}")
image = Image.open("{test_png}")
print(f"   Raw image: size={{image.size}}, mode={{image.mode}}, format={{image.format}}")

# 1) Apply EXIF orientation (phone photos may be rotated via metadata)
try:
    image = ImageOps.exif_transpose(image)
    print(f"   ✅ EXIF transpose applied")
except Exception:
    pass

# 2) Convert to RGB (handles MPO, RGBA, palette, etc.)
image = image.convert("RGB")
print(f"   Converted to RGB: {{image.size}}")

# 3) Resize large images to avoid extreme aspect-ratio distortion
#    SAM3 internally squashes to 1008x1008. A 3213x5712 photo becomes
#    severely distorted. Pre-resizing to max 1500px preserves proportions.
MAX_DIM = 1500
orig_w, orig_h = image.size
if max(orig_w, orig_h) > MAX_DIM:
    scale = MAX_DIM / max(orig_w, orig_h)
    new_w = int(orig_w * scale)
    new_h = int(orig_h * scale)
    image = image.resize((new_w, new_h), Image.LANCZOS)
    print(f"   📐 Resized: {{orig_w}}x{{orig_h}} → {{new_w}}x{{new_h}} (scale={{scale:.3f}})")
else:
    print(f"   📐 No resize needed (max dim {{max(orig_w, orig_h)}} <= {{MAX_DIM}})")

# Keep a reference to the original full-size image for the final cutout
original_image = Image.open("{test_png}")
try:
    original_image = ImageOps.exif_transpose(original_image)
except Exception:
    pass
original_image = original_image.convert("RGB")
print(f"   Original image for cutout: {{original_image.size}}")

print("🔄 Setting image in processor...")
state = processor.set_image(image)
print("✅ Image set in processor")

# Try text prompt segmentation
print(f"🎯 Running segmentation with prompt: '{prompt}'")
try:
    output = processor.set_text_prompt(state=state, prompt="{prompt}")
    masks, scores = output["masks"], output["scores"]
    print(f"📊 Segmentation results:")
    print(f"   - Masks shape: {{masks.shape if masks.numel() > 0 else 'Empty'}}")
    print(f"   - Scores: {{scores.tolist() if scores.numel() > 0 else 'Empty'}}")

    # Check for valid masks
    if scores.numel() == 0 or masks.numel() == 0:
        print("⚠️ No objects detected for prompt '{prompt}', using full image mask")
        img_np = np.array(image)
        mask2d = np.ones((img_np.shape[0], img_np.shape[1]), dtype=bool)
        print("📦 Created fallback mask (full image)")
    else:
        best = int(torch.argmax(scores).item())
        mask = masks[best].detach().to("cpu").numpy()
        best_score = scores[best].item()
        print(f"🎯 Selected mask {{best}} with score {{best_score:.3f}}")

        if mask.ndim == 3:
            mask2d = mask[0]
        else:
            mask2d = mask
        mask2d = mask2d.astype(bool)

        # Calculate mask coverage
        mask_ratio = mask2d.sum() / mask2d.size
        print(f"📏 Mask covers {{mask_ratio*100:.2f}}% of image")

        MIN_COVERAGE = 0.0001  # 0.01%
        MIN_CONFIDENCE = 0.3

        if mask_ratio < MIN_COVERAGE:
            print(f"⚠️ Mask essentially empty ({{mask_ratio*100:.4f}}% < 0.01%), using full image")
            mask2d = np.ones_like(mask2d, dtype=bool)
            print("📦 Created fallback mask (full image)")
        elif best_score < MIN_CONFIDENCE:
            print(f"⚠️ SAM3 confidence too low ({{best_score:.2f}} < 0.3), using full image")
            mask2d = np.ones_like(mask2d, dtype=bool)
            print("📦 Created fallback mask (full image)")
        else:
            print(f"✅ Accepting mask - {{mask_ratio*100:.2f}}% coverage, {{best_score:.2f}} confidence")
            if mask_ratio < 0.01:
                print(f"   ℹ️ Note: Small mask accepted (thin object like pole/wire)")

except Exception as e:
    print(f"❌ SAM3 text prompt failed: {{e}}")
    print("📦 Creating full image mask as fallback")
    img_np = np.array(image)
    mask2d = np.ones((img_np.shape[0], img_np.shape[1]), dtype=bool)

# Scale mask back to original image size for the cutout
orig_w, orig_h = original_image.size
resized_w, resized_h = image.size

if (orig_w, orig_h) != (resized_w, resized_h):
    # mask2d was generated at the resized resolution; scale it back
    mask_img = Image.fromarray(mask2d.astype(np.uint8) * 255, mode="L")
    mask_img = mask_img.resize((orig_w, orig_h), Image.NEAREST)
    mask2d_full = np.array(mask_img).astype(bool)
    print(f"   📐 Mask scaled back: {{resized_w}}x{{resized_h}} → {{orig_w}}x{{orig_h}}")
else:
    mask2d_full = mask2d

# Save mask at original resolution
Image.fromarray((mask2d_full.astype(np.uint8) * 255), mode="L").save("{mask_png}")

# Generate RGBA cutout with background RGB zeroed out
# CRITICAL: Background pixels must have RGB=0 (black), not the original white.
# If white background leaks into SAM3D, MoGe depth model interprets it as a
# real flat surface, causing a rectangular plate artifact in the 3D model.
img_np = np.array(original_image)
img_np[~mask2d_full] = 0  # Zero out background RGB
alpha = (mask2d_full * 255).astype(np.uint8)[..., None]
rgba = np.concatenate([img_np, alpha], axis=2)
Image.fromarray(rgba, "RGBA").save("{cutout_png}")
print(f"   ✅ Cutout saved with black background (BG pixels zeroed)")
print(f"   📊 Cutout size: {{rgba.shape[1]}}x{{rgba.shape[0]}}")

print("SAM3 processing done!")
'''


def _build_sam3d_script(input_png: Path, glb_out: Path, job_id: str = "") -> str:
    """Build the SAM3D reconstruction Python script as a string.
    
    Each job gets its own meshes directory to avoid race conditions
    when multiple SAM3D jobs run in parallel on different GPUs.
    """
    return f'''import os, sys, glob, shutil
import numpy as np
from PIL import Image

print("🎨 SAM3D Starting...")
print(f"📂 Input image: {input_png}")
print(f"📁 Output GLB: {glb_out}")
print(f"🆔 Job ID: {job_id}")

os.environ["HF_HOME"] = "{WORKSPACE}/.hf_home"

ROOT = "{SAM3D_REPO}"
TAG = "{SAM3D_CHECKPOINT}"
INPUT = "{input_png}"
OUT_GLB = "{glb_out}"
JOB_ID = "{job_id}"

print(f"🏠 SAM3D Environment:")
print(f"   - ROOT: {{ROOT}}")
print(f"   - TAG: {{TAG}}")
print(f"   - INPUT: {{INPUT}}")
print(f"   - OUTPUT: {{OUT_GLB}}")

os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, "notebook"))
print(f"✅ Changed to SAM3D directory")

# Create per-job meshes directory to avoid race condition with parallel jobs
# SAM3D writes intermediate GLB files to notebook/meshes/. When two jobs run
# in parallel, they can pick up each other's files. Using a per-job symlink
# or isolated watch directory prevents this.
job_meshes_dir = os.path.join(ROOT, "notebook", f"meshes_{{JOB_ID}}")
default_meshes_dir = os.path.join(ROOT, "notebook", "meshes")
os.makedirs(job_meshes_dir, exist_ok=True)
os.makedirs(default_meshes_dir, exist_ok=True)
print(f"📁 Per-job meshes directory: {{job_meshes_dir}}")

try:
    from inference import Inference
    print("✅ SAM3D Inference imported successfully")
except ImportError as e:
    print(f"❌ SAM3D import error: {{e}}")
    sys.exit(1)

config_path = os.path.join(ROOT, f"checkpoints/{{TAG}}/pipeline.yaml")
print(f"🔍 Looking for config: {{config_path}}")
if not os.path.exists(config_path):
    print(f"❌ Missing pipeline.yaml: {{config_path}}")
    sys.exit(1)

print(f"📦 Loading SAM3D Inference from: {{config_path}}")
try:
    inference = Inference(config_path, compile=False)
    print("✅ SAM3D Inference loaded")
except Exception as e:
    print(f"❌ Failed to load SAM3D Inference: {{e}}")
    sys.exit(1)

# Load image as RGBA (works for both cutout and original image)
print(f"🖼️ Loading image as RGBA: {{INPUT}}")
if not os.path.exists(INPUT):
    print(f"❌ Input file not found: {{INPUT}}")
    sys.exit(1)

rgba = np.array(Image.open(INPUT).convert("RGBA"))
image = rgba[..., :3].copy()
mask  = (rgba[..., 3] > 0).astype(np.uint8)

# Resize large images to reduce peak VRAM usage
# SAM3D needs ~18GB for 1536x1536; resizing to 1024 saves ~4-6GB
MAX_DIM = 1024
orig_h, orig_w = image.shape[:2]
if max(orig_h, orig_w) > MAX_DIM:
    scale = MAX_DIM / max(orig_h, orig_w)
    new_h, new_w = int(orig_h * scale), int(orig_w * scale)
    image = np.array(Image.fromarray(image).resize((new_w, new_h), Image.LANCZOS))
    mask = np.array(Image.fromarray(mask * 255).resize((new_w, new_h), Image.LANCZOS))
    mask = (mask > 127).astype(np.uint8)
    print(f"📐 Resized from {{orig_h}}x{{orig_w}} to {{new_h}}x{{new_w}} (VRAM optimization)")

# CRITICAL: Zero out background RGB so MoGe depth model doesn't treat it as a surface.
# Without this, a white/colored background becomes a flat plate in the 3D model.
image[mask == 0] = 0

bg_pixel_count = (mask == 0).sum()
total_pixels = mask.size
print(f"📊 Image info:")
print(f"   - RGB shape: {{image.shape}}")
print(f"   - Mask shape: {{mask.shape}}")
print(f"   - Mask coverage: {{(mask > 0).sum() / mask.size * 100:.1f}}%")
print(f"   - BG pixels zeroed: {{bg_pixel_count}} / {{total_pixels}} ({{bg_pixel_count/total_pixels*100:.1f}}%)")

print("🚀 Running SAM3D inference...")

# Free any cached VRAM before inference to maximize available memory
import torch
import gc
torch.cuda.empty_cache()
gc.collect()

# Track new files in BOTH default and per-job meshes directories
# SAM3D may write to the default meshes/ dir; we watch both to be safe
watch_dirs = [default_meshes_dir, job_meshes_dir]
before = set()
for wd in watch_dirs:
    os.makedirs(wd, exist_ok=True)
    before.update(glob.glob(os.path.join(wd, "**", "*.glb"), recursive=True))
print(f"📁 Watching directories: {{watch_dirs}}")
print(f"📄 Files before: {{len(before)}} GLB files")

# Run inference with OOM retry at smaller resolution
def _run_inference(img, msk, max_dim_override=None):
    if max_dim_override and max(img.shape[:2]) > max_dim_override:
        s = max_dim_override / max(img.shape[:2])
        nh, nw = int(img.shape[0] * s), int(img.shape[1] * s)
        img = np.array(Image.fromarray(img).resize((nw, nh), Image.LANCZOS))
        msk = np.array(Image.fromarray(msk * 255).resize((nw, nh), Image.LANCZOS))
        msk = (msk > 127).astype(np.uint8)
        img[msk == 0] = 0
        print(f"📐 OOM retry: further resized to {{nh}}x{{nw}}")
    return inference(img, msk, seed=42)

out = None
try:
    out = _run_inference(image, mask)
    print(f"✅ SAM3D inference completed")
    print(f"📊 Output type: {{type(out)}}")
except (torch.cuda.OutOfMemoryError, RuntimeError) as e:
    if "out of memory" in str(e).lower() or "CUDA" in str(e):
        print(f"⚠️ OOM on first attempt, clearing cache and retrying at 768px...")
        torch.cuda.empty_cache()
        gc.collect()
        try:
            out = _run_inference(image, mask, max_dim_override=768)
            print(f"✅ SAM3D inference completed (OOM retry at 768px)")
            print(f"📊 Output type: {{type(out)}}")
        except Exception as e2:
            print(f"❌ SAM3D inference FAILED on retry: {{e2}}")
            print(f"⚠️ SAM3D failed, using placeholder: OOM retry also failed")
            import traceback
            traceback.print_exc()
            sys.exit(1)
    else:
        raise
except Exception as e:
    print(f"❌ SAM3D inference FAILED: {{e}}")
    print(f"⚠️ SAM3D failed, using placeholder: Inference exception")
    import traceback
    traceback.print_exc()
    sys.exit(1)

after = set()
for wd in watch_dirs:
    after.update(glob.glob(os.path.join(wd, "**", "*.glb"), recursive=True))
new_glb = list(after - before)
print(f"📄 Files after: {{len(after)}} GLB files")
print(f"📁 New GLB files: {{len(new_glb)}}")

# Try to export from returned dict
import shutil
src_glb = None

print("💾 Attempting to save GLB...")
glb_saved = False

try:
    if isinstance(out, dict):
        print(f"📊 Output dict keys: {{list(out.keys())}}")
        if "glb" in out:
            glb = out["glb"]
            print(f"📦 GLB object type: {{type(glb)}}")
            if hasattr(glb, "export"):
                print("🔄 Exporting via .export() method...")
                glb.export(OUT_GLB)
                src_glb = OUT_GLB
                glb_saved = True
                print(f"✅ GLB exported to: {{OUT_GLB}}")
            elif isinstance(glb, (bytes, bytearray)):
                print("🔄 Writing GLB bytes...")
                with open(OUT_GLB, "wb") as f:
                    f.write(glb)
                src_glb = OUT_GLB
                glb_saved = True
                print(f"✅ GLB bytes written to: {{OUT_GLB}}")
            else:
                print(f"⚠️ Unknown GLB object type: {{type(glb)}}")
        else:
            print("⚠️ No 'glb' key in output dict")
    else:
        print(f"⚠️ Output is not a dict: {{type(out)}}")
except Exception as e:
    print(f"❌ GLB export failed: {{e}}")
    print(f"⚠️ SAM3D failed, using placeholder: Export exception")
    import traceback
    traceback.print_exc()

# Copy found GLB file if direct export failed
if new_glb and not glb_saved:
    print(f"🔄 Trying to copy from generated files...")
    try:
        src_glb = max(new_glb, key=lambda p: os.path.getmtime(p))
        print(f"📂 Copying from: {{src_glb}}")
        shutil.copy(src_glb, OUT_GLB)
        glb_saved = True
        print(f"✅ GLB copied to: {{OUT_GLB}}")
    except Exception as e:
        print(f"❌ GLB copy failed: {{e}}")
        print(f"⚠️ SAM3D failed, using placeholder: Copy exception")

# Final check
if os.path.exists(OUT_GLB):
    file_size = os.path.getsize(OUT_GLB)
    print(f"✅ Success! GLB saved: {{OUT_GLB}}")
    print(f"📊 File size: {{file_size:,}} bytes")
    if file_size < 5000:
        print(f"⚠️ SAM3D failed, using placeholder: GLB too small ({{file_size}} bytes)")
        sys.exit(1)
    else:
        print(f"🎉 REAL 3D MODEL generated successfully!")
        sys.exit(0)
else:
    print("❌ FAILED: GLB file not found after processing")
    print("⚠️ SAM3D failed, using placeholder: No GLB output file")
    sys.exit(1)

# Cleanup per-job meshes directory
try:
    if os.path.exists(job_meshes_dir):
        shutil.rmtree(job_meshes_dir, ignore_errors=True)
        print(f"🧹 Cleaned up per-job meshes dir: {{job_meshes_dir}}")
except Exception:
    pass

print("🎨 SAM3D processing complete!")
'''
