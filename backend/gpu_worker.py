"""
Imaginary World - Vast.ai GPU Worker
======================================
Lightweight Flask API that ONLY handles SAM3/SAM3D 3D generation.
No story logic, no auth, no database - just GPU processing.

Endpoints:
  POST /api/gpu/process    - Submit image + prompt for 3D generation
  GET  /api/gpu/status/<id> - Check job status
  GET  /api/gpu/download/<id> - Download generated GLB
  GET  /api/gpu/download_cutout/<id> - Download SAM3 cutout PNG
  GET  /health             - Health check
"""

import os
import threading
from datetime import datetime
from pathlib import Path
from functools import wraps

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename

from config import (
    DATA_FOLDER, TEMP_FOLDER, RESULT_FOLDER, UPLOAD_FOLDER,
    SERVER_PORT, GPU_API_SECRET, ALLOWED_EXTENSIONS,
    SAM3_ENV, SAM3_REPO, SAM3D_ENV, SAM3D_REPO,
)
from job_manager import (
    log, load_jobs, save_jobs, create_job, update_job_status,
    generate_job_id, allowed_file, JOBS_LOCK,
    get_conda_base, conda_env_exists,
    verify_sam3_environment, verify_sam3d_environment,
)
from gpu_pool import GPU_POOL
from pipeline_3d import run_3d_pipeline


app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
GPU_POOL.initialize()

# ==========================================
# Authentication Middleware
# ==========================================
def require_api_secret(f):
    """Verify the shared API secret on incoming requests."""
    @wraps(f)
    def decorated(*args, **kwargs):
        secret = request.headers.get("X-API-Secret", "")
        if GPU_API_SECRET and GPU_API_SECRET != "change-me-to-a-random-secret":
            if secret != GPU_API_SECRET:
                return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


# ==========================================
# Health Check
# ==========================================
@app.route('/health')
def health_check():
    sam3_ok, sam3_msg = verify_sam3_environment()
    sam3d_ok, sam3d_msg = verify_sam3d_environment()
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "gpu_count": GPU_POOL.get_gpu_count(),
        "gpu_mode": GPU_POOL.get_mode(),
        "sam3": {"ready": sam3_ok, "message": sam3_msg},
        "sam3d": {"ready": sam3d_ok, "message": sam3d_msg},
    })


@app.route('/api/gpu/info', methods=['GET'])
@require_api_secret
def gpu_info():
    """Get detailed GPU information."""
    gpus = GPU_POOL.get_gpu_info()
    return jsonify({
        "success": True,
        "mode": GPU_POOL.get_mode(),
        "total_gpus": GPU_POOL.get_gpu_count(),
        "available_gpus": GPU_POOL.get_available_count(),
        "gpus": gpus,
    })


@app.route('/api/env-status')
@require_api_secret
def env_status():
    conda_base = get_conda_base()
    sam3_exists = conda_env_exists(SAM3_ENV)
    sam3_ok, sam3_msg = verify_sam3_environment() if sam3_exists else (False, "Not found")
    sam3d_exists = conda_env_exists(SAM3D_ENV)
    sam3d_ok, sam3d_msg = verify_sam3d_environment() if sam3d_exists else (False, "Not found")

    checkpoint_path = os.path.join(SAM3D_REPO, "checkpoints/hf/pipeline.yaml")
    checkpoints_ok = os.path.exists(checkpoint_path)

    return jsonify({
        "timestamp": datetime.now().isoformat(),
        "conda_base": conda_base,
        "environments": {
            "sam3": {"name": SAM3_ENV, "exists": sam3_exists, "ready": sam3_ok, "message": sam3_msg},
            "sam3d": {"name": SAM3D_ENV, "exists": sam3d_exists, "ready": sam3d_ok, "message": sam3d_msg, "checkpoints_ok": checkpoints_ok},
        },
        "ready": sam3_ok and sam3d_ok and checkpoints_ok,
    })


# ==========================================
# 3D Generation API
# ==========================================
@app.route('/api/gpu/process', methods=['POST'])
@require_api_secret
def api_gpu_process():
    """
    Submit an image + prompt for SAM3/SAM3D 3D generation.

    Form Data:
        image: file (PNG/JPG)
        prompt: text prompt for SAM3 segmentation
        job_id: (optional) pre-assigned job ID
    """
    if 'image' not in request.files:
        return jsonify(error="No image file provided"), 400

    image = request.files['image']
    prompt = request.form.get('prompt', 'object')
    requested_job_id = request.form.get('job_id', '')

    if not image.filename:
        return jsonify(error="Empty filename"), 400

    job_id = requested_job_id or generate_job_id()

    filename = secure_filename(image.filename)
    image_path = UPLOAD_FOLDER / f"{job_id}_{filename}"
    image.save(str(image_path))

    output_path = RESULT_FOLDER / f"{job_id}.glb"
    cutout_path = RESULT_FOLDER / f"{job_id}_cutout.png"

    log("GPU_WORKER", f"New job {job_id}: prompt='{prompt}'")

    create_job(job_id, prompt, str(image_path))

    thread = threading.Thread(
        target=run_3d_pipeline,
        args=(job_id, str(image_path), prompt),
        kwargs={
            "output_path": str(output_path),
            "temp_folder": str(TEMP_FOLDER),
            "cutout_output_path": str(cutout_path),
        },
        daemon=True,
    )
    thread.start()

    return jsonify({"job_id": job_id, "status": "queued"})


@app.route('/api/gpu/status/<job_id>', methods=['GET'])
@require_api_secret
def api_gpu_status(job_id):
    """Check job processing status."""
    jobs = load_jobs()
    if job_id not in jobs:
        return jsonify(error="Job not found"), 404

    job = jobs[job_id]
    response = {
        "status": job.get("status", "unknown"),
        "step": job.get("current_step", ""),
        "progress": job.get("progress", 0),
    }

    if job.get("status") == "completed" and job.get("files", {}).get("glb"):
        response["glb_ready"] = True

    if job.get("error"):
        response["error"] = job["error"]

    return jsonify(response)


@app.route('/api/gpu/download/<job_id>', methods=['GET'])
@require_api_secret
def api_gpu_download(job_id):
    """Download the generated GLB file."""
    jobs = load_jobs()
    if job_id not in jobs:
        return jsonify(error="Job not found"), 404

    job = jobs[job_id]
    if job.get("status") != "completed":
        return jsonify(error="Job not completed"), 400

    glb_path = job.get("files", {}).get("glb")
    if not glb_path or not Path(glb_path).exists():
        # Try default location
        default_path = RESULT_FOLDER / f"{job_id}.glb"
        if default_path.exists():
            glb_path = str(default_path)
        else:
            return jsonify(error="GLB file not found"), 404

    return send_file(glb_path, mimetype='model/gltf-binary', as_attachment=True, download_name=f"{job_id}.glb")


@app.route('/api/gpu/download_cutout/<job_id>', methods=['GET'])
@require_api_secret
def api_gpu_download_cutout(job_id):
    """Download the SAM3 cutout PNG."""
    cutout_path = RESULT_FOLDER / f"{job_id}_cutout.png"
    if not cutout_path.exists():
        # Also check temp folder
        cutout_path = TEMP_FOLDER / f"{job_id}_cutout.png"

    if not cutout_path.exists():
        return jsonify(error="Cutout not found"), 404

    return send_file(str(cutout_path), mimetype='image/png', as_attachment=True, download_name=f"{job_id}_cutout.png")


# ==========================================
# Main Entry Point
# ==========================================
if __name__ == "__main__":
    GPU_POOL.initialize()

    print("")
    print("=" * 60)
    print("  🎮 Imaginary World - GPU Worker (Vast.ai)")
    print("=" * 60)
    print(f"  GPU Count:   {GPU_POOL.get_gpu_count()}")
    print(f"  GPU Mode:    {GPU_POOL.get_mode()}")
    print(f"  SAM3 Env:    {SAM3_ENV}")
    print(f"  SAM3D Env:   {SAM3D_ENV}")
    print(f"  Data:        {DATA_FOLDER}")
    print(f"  Port:        {SERVER_PORT}")

    if GPU_API_SECRET == "change-me-to-a-random-secret":
        print(f"  ⚠️  WARNING: Using default API secret! Set GPU_API_SECRET in .env")
    else:
        print(f"  Auth:        API Secret ✅")

    print("=" * 60)
    print(f"  🌐 URL: http://0.0.0.0:{SERVER_PORT}")
    print("=" * 60)
    print("")

    app.run(host="0.0.0.0", port=SERVER_PORT, debug=False)
