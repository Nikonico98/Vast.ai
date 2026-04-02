"""
Imaginary World - GPU Service (Vast.ai)
=========================================
Standalone Flask API for 3D model generation.
Deployed on Vast.ai with GPU access (SAM3 + SAM3D).

This service ONLY handles 3D processing requests via REST API.
The main app (on Hostinger) sends images here and retrieves GLB models.

Endpoints:
    POST /api/gpu/process     - Submit image for 3D generation
    GET  /api/gpu/status/<id> - Check job status
    GET  /api/gpu/download/<id> - Download GLB result
    GET  /api/gpu/download_cutout/<id> - Download SAM3 cutout PNG
    GET  /api/gpu/health      - Health check
    POST /api/gpu/mode        - Set parallel/sequential mode
    DELETE /api/gpu/cleanup/<id> - Clean up temp files

Usage:
    python gpu_app.py
"""

import os
import hmac
import json
import subprocess
import threading
import time
import urllib.request as _urllib_request
from pathlib import Path
from datetime import datetime

from flask import Flask, request, jsonify, send_file, after_this_request as flask_after_this_request
from flask_cors import CORS
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# GPU Service Configuration
# ==========================================
WORKSPACE = os.getenv("WORKSPACE", "/workspace")
GPU_SERVICE_PORT = int(os.getenv("GPU_SERVICE_PORT", 9090))
# Support both legacy and new names for easier Hostinger compatibility.
GPU_API_KEY = os.getenv("GPU_API_KEY", os.getenv("GPU_API_SECRET", ""))

# SAM3 / SAM3D paths
SAM3_ENV = os.getenv("SAM3_ENV", "sam3")
SAM3_REPO = os.getenv("SAM3_REPO", os.path.join(WORKSPACE, "sam3"))
SAM3D_ENV = os.getenv("SAM3D_ENV", "sam3d-objects")
SAM3D_REPO = os.getenv("SAM3D_REPO", os.path.join(WORKSPACE, "sam-3d-objects"))
SAM3D_CHECKPOINT = os.getenv("SAM3D_CHECKPOINT", "hf")
# NOTE: SAM3D runs as on-demand subprocess, not persistent server.

# Hugging Face
HF_TOKEN = os.getenv("HF_TOKEN", "")
if HF_TOKEN:
    os.environ["HF_TOKEN"] = HF_TOKEN
    os.environ["HUGGINGFACE_HUB_TOKEN"] = HF_TOKEN
    os.environ["HF_HOME"] = os.path.join(WORKSPACE, ".hf_home")

# Storage paths
DATA_DIR = Path(os.getenv("GPU_DATA_DIR", os.path.join(WORKSPACE, "gpu_data")))
UPLOAD_DIR = DATA_DIR / "uploads"
RESULT_DIR = DATA_DIR / "results"
TEMP_DIR = DATA_DIR / "temp"
JOBS_FILE = DATA_DIR / "jobs.json"

for _d in [DATA_DIR, UPLOAD_DIR, RESULT_DIR, TEMP_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

# Allowed image extensions
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}


def _structured_job_paths(job_id: str, username: str = "", world_type: str = "", timestamp: str = "") -> dict:
    """
    Return a dict of paths for a job using the Hostinger-compatible structure:
        temp/{username}/{world_type}/{timestamp}/
            photos/          ← input image copy
            cutouts/         ← SAM3 cutout PNG
            fictional_3d/    ← GLB when world_type contains 'fictional'/'fantasy'/etc
            real_3d/         ← GLB when world_type is real/photo
            fictional_images/ ← (reserved for future use)

    Falls back to flat paths under TEMP_DIR/{job_id}/ when metadata is missing.
    """
    if username and world_type and timestamp:
        base = TEMP_DIR / username / world_type / timestamp
    else:
        base = TEMP_DIR / job_id

    base.mkdir(parents=True, exist_ok=True)
    for sub in ("photos", "cutouts", "fictional_3d", "real_3d", "fictional_images"):
        (base / sub).mkdir(parents=True, exist_ok=True)

    # Decide GLB subfolder by job type hint in job_id or world_type label
    job_lower = job_id.lower()
    world_lower = world_type.lower()
    is_fictional = ("fictional" in job_lower or "fantasy" in job_lower or
                    "scifi" in world_lower or "fantasy" in world_lower or
                    "fictional" in world_lower)
    glb_sub = "fictional_3d" if is_fictional else "real_3d"

    return {
        "base": base,
        "photos_dir": base / "photos",
        "cutouts_dir": base / "cutouts",
        "glb_dir": base / glb_sub,
        "image_path": base / "photos" / f"{job_id}_input.jpg",
        "glb_path": base / glb_sub / f"{job_id}.glb",
        "cutout_path": base / "cutouts" / f"{job_id}_cutout.png",
    }

# ==========================================
# Patch config module for pipeline_3d imports
# ==========================================
# pipeline_3d.py imports from config.py. We override those values here
# so the GPU service can run standalone without the full config.py.
import config
config.WORKSPACE = WORKSPACE
config.SAM3_ENV = SAM3_ENV
config.SAM3_REPO = SAM3_REPO
config.SAM3D_ENV = SAM3D_ENV
config.SAM3D_REPO = SAM3D_REPO
config.SAM3D_CHECKPOINT = SAM3D_CHECKPOINT
config.HF_TOKEN = HF_TOKEN
config.TEMP_FOLDER = TEMP_DIR
config.RESULT_FOLDER = RESULT_DIR
config.JOBS_FILE = JOBS_FILE

# Now import GPU-related modules
from gpu_pool import GPU_POOL
from pipeline_3d import run_3d_pipeline
from job_manager import (
    log, load_jobs, create_job, update_job_status,
    generate_job_id, verify_sam3_environment, verify_sam3d_environment
)
from glb_processor import create_placeholder_glb

# ==========================================
# Flask Application
# ==========================================
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})


# ==========================================
# Authentication Middleware
# ==========================================
@app.before_request
def check_api_key():
    """Verify API key for all /api/ endpoints."""
    if not request.path.startswith("/api/"):
        return

    # Health check doesn't require auth
    if request.path == "/api/gpu/health":
        return

    if not GPU_API_KEY:
        # No API key configured = open access (dev mode)
        return

    provided_key = request.headers.get("X-GPU-API-Key", "") or request.headers.get("X-API-Secret", "")
    if not provided_key or not hmac.compare_digest(provided_key, GPU_API_KEY):
        return jsonify(error="Unauthorized: Invalid or missing API key"), 401


# ==========================================
# POST /api/gpu/process - Submit 3D Job
# ==========================================
@app.route("/api/gpu/process", methods=["POST"])
def gpu_process():
    """
    Submit an image for 3D model generation.

    Form data:
        image: Image file (required)
        prompt: Text prompt for segmentation (required)
        job_id: Optional custom job ID (generated if not provided)

    Returns:
        { "job_id": "...", "status": "queued" }
    """
    # Validate image
    if "image" not in request.files:
        return jsonify(error="No image file provided"), 400

    image = request.files["image"]
    if not image.filename:
        return jsonify(error="Empty filename"), 400

    ext = image.filename.rsplit('.', 1)[-1].lower() if '.' in image.filename else ''
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify(error=f"File type not allowed. Use: {ALLOWED_EXTENSIONS}"), 400

    prompt = request.form.get("prompt", "").strip()
    if not prompt:
        return jsonify(error="Prompt is required"), 400

    # Use provided job_id or generate one
    job_id = request.form.get("job_id", "").strip()
    if not job_id:
        job_id = generate_job_id()

    # Structured temp path metadata (mirrors Hostinger layout)
    username = request.form.get("username", "").strip()
    world_type = request.form.get("world_type", "").strip()
    timestamp = request.form.get("timestamp", "").strip()

    paths = _structured_job_paths(job_id, username, world_type, timestamp)

    # Save uploaded image into photos/ subfolder
    image_path = paths["image_path"]
    image.save(str(image_path))

    log("GPU_API", f"New job {job_id}: prompt='{prompt}', base='{paths['base']}'")

    # Create job record
    create_job(job_id, prompt, str(image_path))

    # Start processing in background
    thread = threading.Thread(
        target=_run_gpu_job,
        args=(job_id, str(image_path), prompt, paths),
        daemon=True
    )
    thread.start()

    return jsonify({"job_id": job_id, "status": "queued"})


def _run_gpu_job(job_id, image_path, prompt, paths=None):
    """Background worker: run 3D pipeline for a single job."""
    if paths is None:
        paths = _structured_job_paths(job_id)

    output_path = str(paths["glb_path"])
    cutout_path = str(paths["cutout_path"])
    # Use a per-job scratch dir inside base for intermediate SAM3/SAM3D files
    temp_folder = str(paths["base"] / "_work")

    try:
        run_3d_pipeline(
            job_id=job_id,
            image_path=image_path,
            prompt=prompt,
            output_path=output_path,
            temp_folder=temp_folder,
            cutout_output_path=cutout_path,
        )
    except Exception as e:
        log("GPU_API", f"Job {job_id} failed with exception: {e}")
        update_job_status(job_id, "failed", str(e), 0)


# ==========================================
# POST /api/gpu/process_batch - Submit Multiple Jobs in Parallel
# ==========================================
@app.route("/api/gpu/process_batch", methods=["POST"])
def gpu_process_batch():
    """
    Submit multiple images for parallel 3D model generation.
    Each job is assigned to a different GPU for true parallel processing.

    This endpoint is designed for submitting both "real" and "fictional"
    3D model jobs simultaneously, so each runs on a separate GPU.

    Form data (multipart):
        images: Multiple image files
        prompts: JSON array of text prompts (one per image)
        job_ids: Optional JSON array of pre-assigned job IDs
        labels: Optional JSON array of labels (e.g. ["real", "fictional"])

    Returns:
        { "jobs": [{"job_id": "...", "label": "...", "gpu_id": ...}, ...] }
    """
    images = request.files.getlist("images")
    if not images or len(images) == 0:
        return jsonify(error="No image files provided"), 400

    # Parse prompts
    prompts_raw = request.form.get("prompts", "[]")
    try:
        prompts = json.loads(prompts_raw)
    except (json.JSONDecodeError, TypeError):
        prompts = [request.form.get("prompt", "object")] * len(images)

    if len(prompts) < len(images):
        prompts.extend(["object"] * (len(images) - len(prompts)))

    # Parse optional job IDs
    job_ids_raw = request.form.get("job_ids", "[]")
    try:
        job_ids = json.loads(job_ids_raw)
    except (json.JSONDecodeError, TypeError):
        job_ids = []

    # Parse optional labels
    labels_raw = request.form.get("labels", "[]")
    try:
        labels = json.loads(labels_raw)
    except (json.JSONDecodeError, TypeError):
        labels = []

    # Structured path metadata (shared across all jobs in the batch)
    username = request.form.get("username", "").strip()
    world_type = request.form.get("world_type", "").strip()
    timestamp = request.form.get("timestamp", "").strip()

    available_gpus = GPU_POOL.get_available_count()
    total_gpus = GPU_POOL.get_gpu_count()

    log("GPU_API", f"Batch request: {len(images)} jobs, {available_gpus}/{total_gpus} GPUs available")

    results = []
    threads = []

    for i, image in enumerate(images):
        if not image.filename:
            continue

        ext = image.filename.rsplit('.', 1)[-1].lower() if '.' in image.filename else ''
        if ext not in ALLOWED_EXTENSIONS:
            continue

        prompt = prompts[i] if i < len(prompts) else "object"
        job_id = job_ids[i] if i < len(job_ids) and job_ids[i] else generate_job_id()
        label = labels[i] if i < len(labels) else f"job_{i}"

        # Build structured paths for this job
        paths = _structured_job_paths(job_id, username, world_type, timestamp)

        # Save uploaded image into photos/ subfolder
        image_path = paths["image_path"]
        image.save(str(image_path))

        log("GPU_API", f"Batch job {i}: {job_id} (label={label}, prompt='{prompt}')")

        # Create job record
        create_job(job_id, prompt, str(image_path))

        # Start processing thread
        thread = threading.Thread(
            target=_run_gpu_job,
            args=(job_id, str(image_path), prompt, paths),
            daemon=True
        )
        threads.append(thread)

        results.append({
            "job_id": job_id,
            "label": label,
            "prompt": prompt,
            "status": "queued",
        })

    # Start all threads simultaneously for true parallel GPU execution
    for thread in threads:
        thread.start()

    log("GPU_API", f"Batch: {len(threads)} jobs dispatched to parallel threads")

    return jsonify({
        "jobs": results,
        "total_submitted": len(results),
        "available_gpus": available_gpus,
        "gpu_mode": GPU_POOL.get_mode(),
    })


# ==========================================
# GET /api/gpu/status/<job_id> - Check Status
# ==========================================
@app.route("/api/gpu/status/<job_id>", methods=["GET"])
def gpu_status(job_id):
    """Check the status of a 3D processing job."""
    jobs = load_jobs()

    if job_id not in jobs:
        return jsonify(error="Job not found"), 404

    job = jobs[job_id]

    status = job.get("status", "unknown")
    progress = job.get("progress", 0)
    current_step = job.get("current_step", "")

    # Detect stale completed jobs where output files no longer exist
    if status == "completed":
        glb_path = job.get("files", {}).get("glb")
        if not glb_path or not Path(glb_path).exists():
            status = "expired"
            progress = 0
            current_step = "Results expired - please resubmit"

    response = {
        "job_id": job_id,
        "status": status,
        "progress": progress,
        "current_step": current_step,
    }

    if status == "completed":
        glb_path = job.get("files", {}).get("glb")
        if glb_path and Path(glb_path).exists():
            response["download_url"] = f"/api/gpu/download/{job_id}"

        cutout_path = job.get("files", {}).get("cutout")
        if cutout_path and Path(cutout_path).exists():
            response["cutout_download_url"] = f"/api/gpu/download_cutout/{job_id}"

    if job.get("error"):
        response["error"] = job["error"]

    return jsonify(response)


# ==========================================
# POST /api/gpu/status_batch - Check Multiple Jobs
# ==========================================
@app.route("/api/gpu/status_batch", methods=["POST"])
def gpu_status_batch():
    """
    Check status of multiple jobs at once.
    Useful for monitoring parallel real + fictional 3D generation.

    JSON body:
        { "job_ids": ["job_id_1", "job_id_2", ...] }

    Returns:
        { "jobs": { "job_id_1": {...}, "job_id_2": {...} } }
    """
    data = request.get_json() or {}
    job_ids = data.get("job_ids", [])

    if not job_ids:
        return jsonify(error="No job_ids provided"), 400

    jobs = load_jobs()
    results = {}

    for job_id in job_ids:
        if job_id not in jobs:
            results[job_id] = {"status": "not_found"}
            continue

        job = jobs[job_id]
        status = job.get("status", "unknown")
        progress = job.get("progress", 0)
        current_step = job.get("current_step", "")

        # Detect stale completed jobs where output files no longer exist
        if status == "completed":
            glb_path = job.get("files", {}).get("glb")
            if not glb_path or not Path(glb_path).exists():
                status = "expired"
                progress = 0
                current_step = "Results expired - please resubmit"

        result = {
            "status": status,
            "progress": progress,
            "current_step": current_step,
        }

        if status == "completed":
            glb_path = job.get("files", {}).get("glb")
            if glb_path and Path(glb_path).exists():
                result["download_url"] = f"/api/gpu/download/{job_id}"

            cutout_path = job.get("files", {}).get("cutout")
            if cutout_path and Path(cutout_path).exists():
                result["cutout_download_url"] = f"/api/gpu/download_cutout/{job_id}"

        if job.get("error"):
            result["error"] = job["error"]

        results[job_id] = result

    all_completed = all(
        r.get("status") in ("completed", "failed", "not_found", "expired")
        for r in results.values()
    )

    return jsonify({
        "jobs": results,
        "all_completed": all_completed,
    })


# ==========================================
# GET /api/gpu/download/<job_id> - Download GLB
# ==========================================
@app.route("/api/gpu/download/<job_id>", methods=["GET"])
def gpu_download(job_id):
    """Download the generated GLB model."""
    jobs = load_jobs()

    if job_id not in jobs:
        return jsonify(error="Job not found"), 404

    job = jobs[job_id]

    if job.get("status") != "completed":
        return jsonify(error="Job not completed yet"), 400

    glb_path = job.get("files", {}).get("glb")
    if not glb_path or not Path(glb_path).exists():
        return jsonify(error="GLB file not found"), 404

    @flask_after_this_request
    def _cleanup_glb(response):
        if response.status_code == 200:
            _delete_file_safe(glb_path, "GLB", job_id)
        return response

    return send_file(
        glb_path,
        mimetype='model/gltf-binary',
        as_attachment=True,
        download_name=f"{job_id}.glb"
    )


def _delete_file_safe(path: str, label: str, job_id: str):
    """Delete a file silently after successful download."""
    try:
        p = Path(path)
        if p.exists():
            p.unlink()
            log("GPU_API", f"[{job_id}] Auto-deleted {label}: {path}")
    except Exception as e:
        log("GPU_API", f"[{job_id}] Failed to delete {label}: {e}")


@app.route("/api/gpu/download_cutout/<job_id>", methods=["GET"])
def gpu_download_cutout(job_id):
    """Download the SAM3 cutout PNG."""
    jobs = load_jobs()

    if job_id not in jobs:
        return jsonify(error="Job not found"), 404

    job = jobs[job_id]
    cutout_path = job.get("files", {}).get("cutout")

    if not cutout_path:
        fallback = RESULT_DIR / f"{job_id}_cutout.png"
        if fallback.exists():
            cutout_path = str(fallback)

    if not cutout_path or not Path(cutout_path).exists():
        return jsonify(error="Cutout file not found"), 404

    @flask_after_this_request
    def _cleanup_cutout(response):
        if response.status_code == 200:
            _delete_file_safe(cutout_path, "cutout", job_id)
        return response

    return send_file(
        cutout_path,
        mimetype='image/png',
        as_attachment=True,
        download_name=f"{job_id}_cutout.png"
    )


# ==========================================
# GET /api/gpu/health - Health Check
# ==========================================
# ==========================================
# Model Server Health Helpers (SAM3 persistent, SAM3D on-demand)
# ==========================================
# GPU 0 servers (real/photo pipeline) — SAM3 only
SAM3_SERVER_URL_GPU0 = os.getenv("SAM3_SERVER_URL_GPU0", "http://127.0.0.1:5561")
# GPU 1 servers (fictional pipeline) — SAM3 only
SAM3_SERVER_URL_GPU1 = os.getenv("SAM3_SERVER_URL_GPU1", "http://127.0.0.1:5571")
# Legacy
SAM3_SERVER_URL = os.getenv("SAM3_SERVER_URL", "http://127.0.0.1:5561")
# NOTE: SAM3D no longer has persistent servers (runs as subprocess)

def _check_model_server(base_url, timeout=3):
    """Check a persistent model server's health."""
    try:
        req = _urllib_request.Request(f"{base_url}/health")
        with _urllib_request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            loaded = bool(data.get("model_loaded"))
            return {
                "status": "running" if loaded else "loading",
                "model_loaded": loaded,
                "ready": loaded,
                "loaded": loaded,
                "device": data.get("device", "unknown"),
            }
    except Exception:
        return {"status": "offline", "model_loaded": False, "ready": False, "loaded": False}

def _aggregate_service(server0, server1):
    """Aggregate two per-GPU server statuses into one combined status."""
    both_ready = server0.get("ready", False) and server1.get("ready", False)
    any_ready = server0.get("ready", False) or server1.get("ready", False)
    if both_ready:
        status = "running"
    elif any_ready:
        status = "partial"
    else:
        status = "offline"
    return {
        "status": status,
        "model_loaded": both_ready,
        "ready": both_ready,
        "loaded": both_ready,
        "gpu0": server0,
        "gpu1": server1,
    }


@app.route("/api/gpu/health", methods=["GET"])
def gpu_health():
    """Health check endpoint."""
    gpu_info = GPU_POOL.get_gpu_info()

    # Check SAM3/SAM3D environments
    sam3_ok, sam3_msg = verify_sam3_environment()
    sam3d_ok, sam3d_msg = verify_sam3d_environment()

    # Check all persistent model servers (SAM3 only)
    sam3_gpu0 = _check_model_server(SAM3_SERVER_URL_GPU0)
    sam3_gpu1 = _check_model_server(SAM3_SERVER_URL_GPU1)

    # Aggregate for frontend
    sam3_combined = _aggregate_service(sam3_gpu0, sam3_gpu1)
    # SAM3D is on-demand subprocess — always "available" if env is ready
    sam3d_on_demand = {
        "status": "on-demand" if sam3d_ok else "env_missing",
        "model_loaded": False,
        "ready": sam3d_ok,
        "loaded": False,
        "mode": "subprocess",
        "note": "SAM3D runs as on-demand subprocess to save VRAM",
    }

    return jsonify({
        "success": True,
        "status": "ok",
        "gpu_count": GPU_POOL.get_gpu_count(),
        "gpu_mode": GPU_POOL.get_mode(),
        "mode": GPU_POOL.get_mode(),
        "total_gpus": GPU_POOL.get_gpu_count(),
        "available_gpus": GPU_POOL.get_available_count(),
        "sam3_ready": sam3_ok,
        "sam3d_ready": sam3d_ok,
        "sam3": sam3_combined,
        "sam3d": sam3d_on_demand,
        "gpu_info": gpu_info,
        "gpus": gpu_info,
        "architecture": "sam3-persistent-sam3d-ondemand",
        "servers": {
            "gpu0": {"sam3": sam3_gpu0, "sam3d": "on-demand subprocess", "role": "real/photo"},
            "gpu1": {"sam3": sam3_gpu1, "sam3d": "on-demand subprocess", "role": "fictional"},
        },
        "timestamp": datetime.utcnow().isoformat()
    })


# ==========================================
# POST /api/gpu/restart - Restart Model Servers
# ==========================================
@app.route("/api/gpu/restart", methods=["POST"])
def gpu_restart():
    """Restart SAM3/SAM3D persistent model servers."""
    data = request.get_json() or {}
    target = data.get("target", "all")  # all, gpu0, gpu1

    if target not in ("all", "gpu0", "gpu1"):
        return jsonify(error="target must be 'all', 'gpu0', or 'gpu1'"), 400

    script = Path(__file__).parent / "start_model_servers.sh"
    if not script.exists():
        return jsonify(success=False, error="start_model_servers.sh not found"), 500

    def _do_restart():
        subprocess.run(
            ["bash", str(script), target],
            cwd=str(script.parent),
            timeout=300,
        )

    thread = threading.Thread(target=_do_restart, daemon=True)
    thread.start()

    return jsonify({
        "success": True,
        "message": f"Restarting {target} model server(s)... This takes 30-60 seconds.",
        "target": target,
    })


# ==========================================
# POST /api/gpu/mode - Set GPU Mode
# ==========================================
@app.route("/api/gpu/mode", methods=["POST"])
def gpu_mode():
    """Set GPU processing mode (parallel/sequential)."""
    data = request.get_json() or {}
    mode = data.get("mode", "sequential")

    if mode not in ("parallel", "sequential"):
        return jsonify(error="Mode must be 'parallel' or 'sequential'"), 400

    GPU_POOL.set_mode(mode)
    return jsonify({
        "mode": GPU_POOL.get_mode(),
        "gpu_count": GPU_POOL.get_gpu_count()
    })


# ==========================================
# DELETE /api/gpu/cleanup/<job_id> - Cleanup
# ==========================================
@app.route("/api/gpu/cleanup/<job_id>", methods=["DELETE"])
def gpu_cleanup(job_id):
    """Clean up all temp files for a completed job."""
    import shutil

    jobs = load_jobs()
    job = jobs.get(job_id, {})

    deleted = []

    # Delete files listed in the job record
    for key in ("glb", "cutout", "input"):
        fpath = job.get("files", {}).get(key)
        if fpath and Path(fpath).exists():
            try:
                Path(fpath).unlink()
                deleted.append(fpath)
            except Exception:
                pass

    # Clean per-job _work scratch dir
    work_dir = None
    glb_path = job.get("files", {}).get("glb", "")
    if glb_path:
        work_dir = Path(glb_path).parent.parent / "_work"
    if work_dir and work_dir.exists():
        shutil.rmtree(str(work_dir), ignore_errors=True)
        deleted.append(str(work_dir))

    # Legacy flat-dir fallback
    temp_path = TEMP_DIR / job_id
    if temp_path.exists():
        shutil.rmtree(str(temp_path), ignore_errors=True)
        deleted.append(str(temp_path))
    for f in UPLOAD_DIR.glob(f"{job_id}_*"):
        f.unlink(missing_ok=True)
        deleted.append(str(f))
    for f in RESULT_DIR.glob(f"{job_id}*"):
        f.unlink(missing_ok=True)
        deleted.append(str(f))

    return jsonify({"status": "cleaned", "job_id": job_id, "deleted": deleted})


# ==========================================
# GET /api/gpu/jobs - List Recent Jobs
# ==========================================
@app.route("/api/gpu/jobs", methods=["GET"])
def gpu_jobs():
    """List recent jobs (last 50)."""
    jobs = load_jobs()
    recent = sorted(jobs.items(), key=lambda x: x[1].get("created_at", ""), reverse=True)[:50]
    return jsonify({
        "jobs": [
            {
                "job_id": jid,
                "status": j.get("status"),
                "prompt": j.get("prompt"),
                "progress": j.get("progress", 0),
                "created_at": j.get("created_at"),
            }
            for jid, j in recent
        ]
    })


# ==========================================
# Main Entry Point
# ==========================================
if __name__ == "__main__":
    print("=" * 60)
    print("  🔧 Imaginary World - GPU Service (Vast.ai)")
    print("=" * 60)

    # Initialize GPU Pool
    GPU_POOL.initialize()

    print(f"  GPU Count:     {GPU_POOL.get_gpu_count()}")
    print(f"  GPU Mode:      {GPU_POOL.get_mode()}")
    print(f"  SAM3 Env:      {SAM3_ENV}")
    print(f"  SAM3D Env:     {SAM3D_ENV} (on-demand subprocess)")
    print(f"  SAM3D Mode:    subprocess (not persistent - saves ~13GB VRAM/GPU)")
    print(f"  Data Dir:      {DATA_DIR}")
    print(f"  Port:          {GPU_SERVICE_PORT}")
    print(f"  API Key:       {'Configured ✅' if GPU_API_KEY else 'Not set ⚠️ (open access)'}")
    print(f"  HF Token:      {'Set ✅' if HF_TOKEN else 'Not set ⚠️'}")
    print("=" * 60)

    app.run(
        host="0.0.0.0",
        port=GPU_SERVICE_PORT,
        debug=False,
        threaded=True
    )
