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

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# GPU Service Configuration
# ==========================================
WORKSPACE = os.getenv("WORKSPACE", "/workspace")
GPU_SERVICE_PORT = int(os.getenv("GPU_SERVICE_PORT", 9090))
GPU_API_KEY = os.getenv("GPU_API_KEY", "")  # Required for authentication

# SAM3 / SAM3D paths
SAM3_ENV = os.getenv("SAM3_ENV", "sam3")
SAM3_REPO = os.getenv("SAM3_REPO", os.path.join(WORKSPACE, "sam3"))
SAM3D_ENV = os.getenv("SAM3D_ENV", "sam3d-objects")
SAM3D_REPO = os.getenv("SAM3D_REPO", os.path.join(WORKSPACE, "sam-3d-objects"))
SAM3D_CHECKPOINT = os.getenv("SAM3D_CHECKPOINT", "hf")

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

    provided_key = request.headers.get("X-GPU-API-Key", "")
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

    # Save uploaded image
    filename = secure_filename(image.filename)
    image_path = UPLOAD_DIR / f"{job_id}_{filename}"
    image.save(str(image_path))

    log("GPU_API", f"New job {job_id}: prompt='{prompt}', file='{filename}'")

    # Create job record
    create_job(job_id, prompt, str(image_path))

    # Start processing in background
    thread = threading.Thread(
        target=_run_gpu_job,
        args=(job_id, str(image_path), prompt),
        daemon=True
    )
    thread.start()

    return jsonify({"job_id": job_id, "status": "queued"})


def _run_gpu_job(job_id, image_path, prompt):
    """Background worker: run 3D pipeline for a single job."""
    output_path = str(RESULT_DIR / f"{job_id}.glb")
    temp_folder = str(TEMP_DIR / job_id)

    try:
        run_3d_pipeline(
            job_id=job_id,
            image_path=image_path,
            prompt=prompt,
            output_path=output_path,
            temp_folder=temp_folder
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

        # Save uploaded image
        filename = secure_filename(image.filename)
        image_path = UPLOAD_DIR / f"{job_id}_{filename}"
        image.save(str(image_path))

        log("GPU_API", f"Batch job {i}: {job_id} (label={label}, prompt='{prompt}')")

        # Create job record
        create_job(job_id, prompt, str(image_path))

        # Start processing thread
        thread = threading.Thread(
            target=_run_gpu_job,
            args=(job_id, str(image_path), prompt),
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

    response = {
        "job_id": job_id,
        "status": job.get("status", "unknown"),
        "progress": job.get("progress", 0),
        "current_step": job.get("current_step", ""),
    }

    if job.get("status") == "completed":
        glb_path = job.get("files", {}).get("glb")
        if glb_path and Path(glb_path).exists():
            response["download_url"] = f"/api/gpu/download/{job_id}"

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
        result = {
            "status": job.get("status", "unknown"),
            "progress": job.get("progress", 0),
            "current_step": job.get("current_step", ""),
        }

        if job.get("status") == "completed":
            glb_path = job.get("files", {}).get("glb")
            if glb_path and Path(glb_path).exists():
                result["download_url"] = f"/api/gpu/download/{job_id}"

        if job.get("error"):
            result["error"] = job["error"]

        results[job_id] = result

    all_completed = all(
        r.get("status") in ("completed", "failed", "not_found")
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

    return send_file(
        glb_path,
        mimetype='model/gltf-binary',
        as_attachment=True,
        download_name=f"{job_id}.glb"
    )


# ==========================================
# GET /api/gpu/health - Health Check
# ==========================================
# ==========================================
# Model Server Health Helpers (Dual-GPU)
# ==========================================
# GPU 0 servers (real/photo pipeline)
SAM3_SERVER_URL_GPU0 = os.getenv("SAM3_SERVER_URL_GPU0", "http://127.0.0.1:5561")
SAM3D_SERVER_URL_GPU0 = os.getenv("SAM3D_SERVER_URL_GPU0", "http://127.0.0.1:5562")
# GPU 1 servers (fictional pipeline)
SAM3_SERVER_URL_GPU1 = os.getenv("SAM3_SERVER_URL_GPU1", "http://127.0.0.1:5571")
SAM3D_SERVER_URL_GPU1 = os.getenv("SAM3D_SERVER_URL_GPU1", "http://127.0.0.1:5572")
# Legacy
SAM3_SERVER_URL = os.getenv("SAM3_SERVER_URL", "http://127.0.0.1:5561")
SAM3D_SERVER_URL = os.getenv("SAM3D_SERVER_URL", "http://127.0.0.1:5562")

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

    # Check all 4 persistent model servers
    sam3_gpu0 = _check_model_server(SAM3_SERVER_URL_GPU0)
    sam3d_gpu0 = _check_model_server(SAM3D_SERVER_URL_GPU0)
    sam3_gpu1 = _check_model_server(SAM3_SERVER_URL_GPU1)
    sam3d_gpu1 = _check_model_server(SAM3D_SERVER_URL_GPU1)

    # Aggregate for frontend (which expects single sam3/sam3d objects)
    sam3_combined = _aggregate_service(sam3_gpu0, sam3_gpu1)
    sam3d_combined = _aggregate_service(sam3d_gpu0, sam3d_gpu1)

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
        "sam3d": sam3d_combined,
        "gpu_info": gpu_info,
        "gpus": gpu_info,
        "architecture": "dual-gpu",
        "servers": {
            "gpu0": {"sam3": sam3_gpu0, "sam3d": sam3d_gpu0, "role": "real/photo"},
            "gpu1": {"sam3": sam3_gpu1, "sam3d": sam3d_gpu1, "role": "fictional"},
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
    """Clean up temp files and uploads for a completed job."""
    # Clean temp folder
    temp_path = TEMP_DIR / job_id
    if temp_path.exists():
        import shutil
        shutil.rmtree(str(temp_path), ignore_errors=True)

    # Clean upload
    for f in UPLOAD_DIR.glob(f"{job_id}_*"):
        f.unlink(missing_ok=True)

    return jsonify({"status": "cleaned", "job_id": job_id})


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
    print(f"  SAM3D Env:     {SAM3D_ENV}")
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
