"""
Imaginary World - Hostinger Backend
=====================================
Runs on Hostinger VPS (no GPU required).
Handles: story generation, auth, file serving, image generation.
Delegates SAM3/SAM3D 3D generation to Vast.ai GPU worker via HTTP.
"""

import os
import json
import uuid
import shutil
import threading
import time
import base64
import io
import requests
from datetime import datetime
from pathlib import Path
from PIL import Image as PILImage

from flask import Flask, request, jsonify, send_file, send_from_directory, session, g
from flask_cors import CORS
from werkzeug.utils import secure_filename

from config import (
    FRONTEND_FOLDER, DATA_FOLDER, DATA_FOLDER_TEST,
    UPLOAD_FOLDER, RESULT_FOLDER, TEMPLATE_FILE,
    ALLOWED_EXTENSIONS, MAX_FILE_SIZE, SERVER_PORT, DEBUG_MODE, SECRET_KEY,
    VALID_IMAGINARY_WORLDS, WORLD_DISPLAY_NAMES, ACTION_TO_AR, AR_INTERACTIONS_FALLBACK,
    OPENAI_MODEL, VASTAI_GPU_URL, VASTAI_API_KEY, VASTAI_INSTANCE_ID,
    VASTAI_GPU_CONTAINER_PORT,
    RUNPOD_API_KEY, RUNPOD_POD_ID, GPU_BACKEND,
    GPU_API_SECRET, get_gpu_url, get_all_gpu_urls,
)

from database import (
    init_db, create_user, verify_user, get_user_by_id, get_user_by_username,
    create_story, update_story_progress, get_user_stories, get_story_by_journey_id,
    get_db_stats
)

import ai_service
from ai_service import (
    OPENAI_CLIENT, OPENAI_AVAILABLE, LUMA_AVAILABLE, IMAGE_AVAILABLE,
    reload_system_prompt, chat_with_context,
    generate_opening_story, analyze_photo, generate_event,
    upload_image_to_cdn, generate_fictional_image
)

from gpu_client import gpu_worker_health, gpu_all_workers_health, run_remote_3d_pipeline

from job_manager import (
    log, load_jobs, save_jobs, create_job, update_job_status, generate_job_id,
    save_journey, load_journey,
    allowed_file, simplify_prompt_for_sam3, JOBS_LOCK
)

from user_manager import (
    get_next_user_id, get_current_data_folder, create_user_folder,
    get_user_path, save_user_journey, load_user_journey,
    load_journey_unified, smart_save_journey,
    create_story_folder, get_next_guest_id, get_story_path, list_user_journeys,
)

from glb_processor import create_placeholder_glb


# ==========================================
# Per-Journey Locks (prevent concurrent photo_event for same journey)
# ==========================================
_journey_locks = {}
_journey_locks_lock = threading.Lock()

def get_journey_lock(journey_id: str) -> threading.Lock:
    """Get or create a lock for a specific journey to prevent concurrent photo uploads."""
    with _journey_locks_lock:
        if journey_id not in _journey_locks:
            _journey_locks[journey_id] = threading.Lock()
        return _journey_locks[journey_id]


# ==========================================
# Flask Application Setup
# ==========================================
app = Flask(__name__, static_folder=str(FRONTEND_FOLDER))
app.secret_key = SECRET_KEY
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE
CORS(app, resources={r"/*": {"origins": "*"}})

# Initialize database and load system prompt at startup (works with gunicorn)
from database import init_db
init_db()
reload_system_prompt()


# ==========================================
# Global JSON Error Handlers (prevent HTML error pages)
# ==========================================
import traceback

@app.errorhandler(500)
def handle_500(e):
    log("ERROR", f"500 Internal Server Error: {e}")
    traceback.print_exc()
    return jsonify({"success": False, "error": "Internal server error"}), 500

@app.errorhandler(404)
def handle_404(e):
    if request.path.startswith('/api/'):
        return jsonify({"success": False, "error": "Not found"}), 404
    return e

@app.errorhandler(405)
def handle_405(e):
    if request.path.startswith('/api/'):
        return jsonify({"success": False, "error": "Method not allowed"}), 405
    return e


# ==========================================
# Image Compression for Vision API
# ==========================================
def compress_image_for_vision(image_path, max_dim=512, quality=80):
    try:
        with PILImage.open(image_path) as img:
            if img.mode in ('RGBA', 'P', 'LA'):
                img = img.convert('RGB')
            img.thumbnail((max_dim, max_dim), PILImage.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=quality)
            b64 = base64.b64encode(buf.getvalue()).decode('ascii')
            log("COMPRESS", f"Vision image: {os.path.getsize(image_path) / 1024:.0f}KB → {len(b64) * 3 / 4 / 1024:.0f}KB ({img.size[0]}×{img.size[1]})")
            return b64
    except Exception as e:
        log("COMPRESS", f"⚠️ PIL compression failed: {e}")
        with open(image_path, "rb") as f:
            return base64.b64encode(f.read()).decode("ascii")


# ==========================================
# Request Middleware
# ==========================================
@app.before_request
def before_request():
    try:
        from urllib.parse import urlparse
        referer_path = urlparse(request.headers.get('Referer', '')).path
        is_test_mode = (
            request.path.startswith('/test')
            or request.args.get('test') == '1'
            or referer_path.startswith('/test')
        )

        if is_test_mode:
            g.data_folder = DATA_FOLDER_TEST
            g.is_test_mode = True
            DATA_FOLDER_TEST.mkdir(parents=True, exist_ok=True)
            (DATA_FOLDER_TEST / "temp").mkdir(parents=True, exist_ok=True)
        else:
            g.data_folder = DATA_FOLDER
            g.is_test_mode = False

        if "session_user_id" not in session:
            session["session_user_id"] = str(uuid.uuid4())
        g.user_id = session["session_user_id"]
        g.user_path = g.data_folder / "journeys" / g.user_id
        g.user_path.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        log("MIDDLEWARE", f"before_request error: {e}")
        traceback.print_exc()


# ==========================================
# Health Check
# ==========================================
@app.route('/health')
def health_check():
    gpu_health = gpu_worker_health()
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "ai_available": OPENAI_AVAILABLE,
        "gpu_worker": gpu_health,
        "test_mode": getattr(g, 'is_test_mode', False)
    })


@app.route('/api/debug/test-db')
def test_db():
    """Debug endpoint to check database connectivity."""
    from database import DB_PATH, get_db
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM users")
        count = cursor.fetchone()["count"]
        conn.close()
        return jsonify({
            "db_path": str(DB_PATH),
            "db_exists": DB_PATH.exists(),
            "user_count": count,
            "status": "ok"
        })
    except Exception as e:
        return jsonify({
            "db_path": str(DB_PATH),
            "db_exists": DB_PATH.exists(),
            "error": str(e),
            "status": "error"
        }), 500


@app.route('/api/gpu/status', methods=['GET'])
def gpu_status():
    """Proxy GPU status from Vast.ai worker."""
    health = gpu_worker_health()
    
    return jsonify({
        "success": True,
        "mode": health.get("gpu_mode", health.get("mode", "parallel")),
        "total_gpus": health.get("gpu_count", health.get("total_gpus", 0)),
        "available_gpus": health.get("available_gpus", 0),
        "gpus": health.get("gpus", health.get("gpu_info", [])),
        "gpu_worker_url": get_gpu_url(),
        "gpu_worker_status": health,
        "sam3": health.get("sam3", {}),
        "sam3d": health.get("sam3d", {}),
    })


@app.route('/api/gpu/mode', methods=['POST'])
def set_gpu_mode():
    """Proxy GPU mode change to Vast.ai worker."""
    import requests as req
    data = request.get_json() or {}
    mode = data.get("mode", "parallel")
    try:
        r = req.post(
            f"{get_gpu_url()}/api/gpu/mode",
            json={"mode": mode},
            headers={"X-GPU-API-Key": GPU_API_SECRET},
            timeout=10,
        )
        if r.status_code == 200:
            return jsonify(r.json())
        return jsonify({"success": True, "mode": mode})
    except Exception:
        return jsonify({"success": True, "mode": mode})


# ==========================================
# RunPod GPU Pod Management  (replaces Vast.ai instance management)
# ==========================================
RUNPOD_API_URL = "https://api.runpod.io/graphql"


def _runpod_query(query: str, variables: dict = None) -> dict:
    """Execute a RunPod GraphQL query."""
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    r = requests.post(
        f"{RUNPOD_API_URL}?api_key={RUNPOD_API_KEY}",
        json=payload,
        timeout=30,
    )
    return r.json()


@app.route('/api/gpu/instance/status', methods=['GET'])
def gpu_instance_status():
    """Get GPU instance status. Auto-detects: RunPod first, then Vast.ai."""
    # Try RunPod first
    if RUNPOD_API_KEY and RUNPOD_POD_ID:
        try:
            result = _runpod_query(
                '{ pod(input: {podId: "%s"}) { id name runtime { uptimeInSeconds gpus { id gpuUtilPercent memoryUtilPercent } ports { ip isIpPublic privatePort publicPort type } } machine { gpuDisplayName } gpuCount costPerHr desiredStatus } }' % RUNPOD_POD_ID
            )
            pod = result.get("data", {}).get("pod")
            if pod:
                status = pod.get("desiredStatus", "unknown")
                gpu_name = pod.get("machine", {}).get("gpuDisplayName", "Unknown") if pod.get("machine") else "Unknown"
                num_gpus = pod.get("gpuCount", 0)
                cost_per_hr = pod.get("costPerHr", 0)
                runtime = pod.get("runtime") or {}
                uptime = runtime.get("uptimeInSeconds", 0)

                return jsonify({
                    "success": True,
                    "configured": True,
                    "status": "running" if runtime else status.lower(),
                    "gpu_name": gpu_name,
                    "num_gpus": num_gpus,
                    "dph_total": round(cost_per_hr, 4),
                    "uptime_seconds": uptime,
                    "pod_id": RUNPOD_POD_ID,
                    "provider": "runpod",
                })
        except Exception as e:
            log("GPU_STATUS", f"RunPod query failed: {e}")

    # Fallback to Vast.ai
    if VASTAI_API_KEY and VASTAI_INSTANCE_ID:
        try:
            r = requests.get(
                f"{VASTAI_API_BASE}/instances/{VASTAI_INSTANCE_ID}/",
                headers=_vastai_headers(), timeout=15
            )
            data = r.json()
            instance = data.get("instances", data)
            if isinstance(instance, list):
                instance = instance[0] if instance else {}
            return jsonify({
                "success": True, "configured": True, "provider": "vastai",
                "status": instance.get("actual_status", instance.get("cur_state", "unknown")),
                "gpu_name": instance.get("gpu_name", "Unknown"),
                "num_gpus": instance.get("num_gpus", 0),
                "dph_total": round(instance.get("dph_total", 0), 4),
                "disk_space": round(instance.get("disk_space", 0), 1),
                "disk_usage": round(instance.get("disk_usage", instance.get("disk_util", 0)), 1),
                "instance_id": VASTAI_INSTANCE_ID,
            })
        except Exception as e:
            return jsonify({"success": False, "configured": True, "error": str(e)})

    return jsonify({
        "success": False,
        "configured": False,
        "error": "No GPU backend configured. Set RUNPOD or VASTAI credentials in .env"
    })


@app.route('/api/gpu/instance/start', methods=['POST'])
def gpu_instance_start():
    """Start GPU instance. Tries RunPod first, then Vast.ai."""
    if RUNPOD_API_KEY and RUNPOD_POD_ID:
        try:
            result = _runpod_query(
                'mutation { podResume(input: {podId: "%s", gpuCount: 1}) { id desiredStatus } }' % RUNPOD_POD_ID
            )
            pod = result.get("data", {}).get("podResume")
            if pod:
                log("RUNPOD", f"Pod {RUNPOD_POD_ID} resume requested")
                return jsonify({"success": True, "message": "RunPod resume requested", "provider": "runpod"})
            errors = result.get("errors", [])
            err_msg = errors[0].get("message", "Unknown error") if errors else "Unknown error"
            return jsonify({"success": False, "error": err_msg}), 502
        except Exception as e:
            log("GPU_START", f"RunPod start failed: {e}")

    if VASTAI_API_KEY and VASTAI_INSTANCE_ID:
        try:
            r = requests.put(
                f"{VASTAI_API_BASE}/instances/{VASTAI_INSTANCE_ID}/",
                json={"state": "running"}, headers=_vastai_headers(), timeout=30,
            )
            if r.status_code in (200, 202):
                log("VASTAI", f"Instance {VASTAI_INSTANCE_ID} start requested")
                return jsonify({"success": True, "message": "Vast.ai start requested", "provider": "vastai"})
            return jsonify({"success": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}), 502
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500

    return jsonify({"success": False, "error": "No GPU backend configured"}), 400


@app.route('/api/gpu/instance/stop', methods=['POST'])
def gpu_instance_stop():
    """Stop GPU instance. Tries RunPod first, then Vast.ai."""
    if RUNPOD_API_KEY and RUNPOD_POD_ID:
        try:
            result = _runpod_query(
                'mutation { podStop(input: {podId: "%s"}) { id desiredStatus } }' % RUNPOD_POD_ID
            )
            pod = result.get("data", {}).get("podStop")
            if pod:
                log("RUNPOD", f"Pod {RUNPOD_POD_ID} stop requested")
                return jsonify({"success": True, "message": "RunPod stop requested", "provider": "runpod"})
            errors = result.get("errors", [])
            err_msg = errors[0].get("message", "Unknown error") if errors else "Unknown error"
            return jsonify({"success": False, "error": err_msg}), 502
        except Exception as e:
            log("GPU_STOP", f"RunPod stop failed: {e}")

    if VASTAI_API_KEY and VASTAI_INSTANCE_ID:
        try:
            r = requests.put(
                f"{VASTAI_API_BASE}/instances/{VASTAI_INSTANCE_ID}/",
                json={"state": "stopped"}, headers=_vastai_headers(), timeout=30,
            )
            if r.status_code in (200, 202):
                log("VASTAI", f"Instance {VASTAI_INSTANCE_ID} stop requested")
                return jsonify({"success": True, "message": "Vast.ai stop requested", "provider": "vastai"})
            return jsonify({"success": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}), 502
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500

    return jsonify({"success": False, "error": "No GPU backend configured"}), 400


# ==========================================
# Vast.ai Instance Management
# ==========================================
VASTAI_API_BASE = "https://console.vast.ai/api/v0"


def _vastai_headers():
    return {"Authorization": f"Bearer {VASTAI_API_KEY}"}


@app.route('/api/gpu/vastai/status', methods=['GET'])
def gpu_vastai_status():
    """Get Vast.ai instance status."""
    if not VASTAI_API_KEY or not VASTAI_INSTANCE_ID:
        return jsonify({"success": False, "configured": False, "error": "Vast.ai not configured"})
    try:
        r = requests.get(
            f"{VASTAI_API_BASE}/instances/{VASTAI_INSTANCE_ID}/",
            headers=_vastai_headers(), timeout=15
        )
        data = r.json()
        instance = data.get("instances", data)
        if isinstance(instance, list):
            instance = instance[0] if instance else {}
        return jsonify({
            "success": True, "configured": True, "provider": "vastai",
            "status": instance.get("actual_status", instance.get("cur_state", "unknown")),
            "gpu_name": instance.get("gpu_name", "Unknown"),
            "num_gpus": instance.get("num_gpus", 0),
            "dph_total": round(instance.get("dph_total", 0), 4),
            "instance_id": VASTAI_INSTANCE_ID,
        })
    except Exception as e:
        return jsonify({"success": False, "configured": True, "error": str(e)})


@app.route('/api/gpu/vastai/start', methods=['POST'])
def gpu_vastai_start():
    """Start the Vast.ai GPU instance."""
    if not VASTAI_API_KEY or not VASTAI_INSTANCE_ID:
        return jsonify({"success": False, "error": "Vast.ai not configured"}), 400
    try:
        r = requests.put(
            f"{VASTAI_API_BASE}/instances/{VASTAI_INSTANCE_ID}/",
            json={"state": "running"}, headers=_vastai_headers(), timeout=30,
        )
        if r.status_code in (200, 202):
            log("VASTAI", f"Instance {VASTAI_INSTANCE_ID} start requested")
            return jsonify({"success": True, "message": "Instance start requested"})
        return jsonify({"success": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}), 502
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/gpu/vastai/stop', methods=['POST'])
def gpu_vastai_stop():
    """Stop the Vast.ai GPU instance."""
    if not VASTAI_API_KEY or not VASTAI_INSTANCE_ID:
        return jsonify({"success": False, "error": "Vast.ai not configured"}), 400
    try:
        r = requests.put(
            f"{VASTAI_API_BASE}/instances/{VASTAI_INSTANCE_ID}/",
            json={"state": "stopped"}, headers=_vastai_headers(), timeout=30,
        )
        if r.status_code in (200, 202):
            log("VASTAI", f"Instance {VASTAI_INSTANCE_ID} stop requested")
            return jsonify({"success": True, "message": "Instance stop requested"})
        return jsonify({"success": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}), 502
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==========================================
# Combined GPU Status (both backends)
# ==========================================
@app.route('/api/gpu/all-status', methods=['GET'])
def gpu_all_status():
    """Get health/status of ALL configured GPU backends."""
    workers = gpu_all_workers_health()
    return jsonify({
        "success": True,
        "active_backend": GPU_BACKEND,
        "backends": workers,
    })


@app.route('/api/gpu/services/status', methods=['GET'])
def gpu_services_status():
    """Check SAM3/SAM3D service status on the GPU worker."""
    health = gpu_worker_health()
    return jsonify({
        "success": True,
        "worker_reachable": health.get("status") in ("healthy", "ok"),
        "sam3": health.get("sam3", {}),
        "sam3d": health.get("sam3d", {}),
        "gpu_mode": health.get("gpu_mode", "unknown"),
    })


@app.route('/api/gpu/services/restart', methods=['POST'])
def gpu_services_restart():
    """Request SAM3/SAM3D service restart on the GPU worker."""
    try:
        r = requests.post(
            f"{get_gpu_url()}/api/gpu/restart",
            headers={"X-GPU-API-Key": GPU_API_SECRET},
            timeout=30,
        )
        if r.status_code == 200:
            return jsonify(r.json())
        return jsonify({
            "success": False,
            "error": f"GPU worker returned {r.status_code}",
        }), 502
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Cannot reach GPU worker: {e}",
        }), 502


@app.route('/api/env-status')
def env_status():
    """Check environment status. SAM3/SAM3D runs on GPU workers (RunPod/Vast.ai)."""
    gpu_health = gpu_worker_health()
    gpu_ready = gpu_health.get("status") in ("healthy", "ok")
    return jsonify({
        "timestamp": datetime.now().isoformat(),
        "deployment": "hostinger-split",
        "active_gpu_backend": gpu_health.get("active_backend", GPU_BACKEND),
        "environments": {
            "sam3": {"ready": gpu_ready, "message": f"Runs on {gpu_health.get('active_backend', 'GPU')} worker"},
            "sam3d": {"ready": gpu_ready, "message": f"Runs on {gpu_health.get('active_backend', 'GPU')} worker"},
        },
        "ai": {
            "provider": "OpenAI" if OPENAI_AVAILABLE else None,
            "available": OPENAI_AVAILABLE,
            "image_available": IMAGE_AVAILABLE,
        },
        "gpu_worker": gpu_health,
        "ready": OPENAI_AVAILABLE and gpu_ready,
    })


@app.route('/debug/routes')
def debug_routes():
    routes = []
    for rule in app.url_map.iter_rules():
        routes.append({"path": str(rule), "methods": sorted(rule.methods), "endpoint": rule.endpoint})
    return jsonify({"routes": sorted(routes, key=lambda x: x["path"])})


@app.route('/api/reload-template', methods=['POST'])
def api_reload_template():
    try:
        reload_system_prompt()
        return jsonify({
            "success": True,
            "message": "Template reloaded successfully",
            "template_length": len(ai_service.SYSTEM_PROMPT_TEMPLATE) if ai_service.SYSTEM_PROMPT_TEMPLATE else 0,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/template-status')
def api_template_status():
    return jsonify({
        "template_loaded": ai_service.SYSTEM_PROMPT_TEMPLATE is not None,
        "template_length": len(ai_service.SYSTEM_PROMPT_TEMPLATE) if ai_service.SYSTEM_PROMPT_TEMPLATE else 0,
        "template_file": str(TEMPLATE_FILE),
        "template_exists": TEMPLATE_FILE.exists(),
        "ar_interactions": ai_service.AR_INTERACTIONS,
        "format": "markdown"
    })


@app.route('/api/test-ai')
def api_test_ai():
    """Debug endpoint: test OpenAI API call directly."""
    import traceback
    result = {
        "openai_available": OPENAI_AVAILABLE,
        "openai_client": OPENAI_CLIENT is not None,
        "template_loaded": ai_service.SYSTEM_PROMPT_TEMPLATE is not None,
        "template_length": len(ai_service.SYSTEM_PROMPT_TEMPLATE) if ai_service.SYSTEM_PROMPT_TEMPLATE else 0,
        "model": OPENAI_MODEL,
    }
    if OPENAI_AVAILABLE and OPENAI_CLIENT:
        try:
            response = OPENAI_CLIENT.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[{"role": "user", "content": "Say hello in 5 words."}],
                max_completion_tokens=50,
                temperature=0.3,
            )
            result["test_response"] = response.choices[0].message.content
            result["success"] = True
        except Exception as e:
            result["success"] = False
            result["error"] = str(e)
            result["error_type"] = type(e).__name__
            result["traceback"] = traceback.format_exc()
    return jsonify(result)


# ==========================================
# Authentication API
# ==========================================
@app.route('/api/auth/register', methods=['POST'])
def api_auth_register():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "") or "test1234"
    display_name = data.get("display_name", "").strip() or username

    if not username or len(username) < 1:
        return jsonify({"success": False, "error": "Username is required"}), 400

    result = create_user(username, password, display_name)
    if result["success"]:
        session["user_id"] = result["user_id"]
        session["username"] = username
        session["display_name"] = display_name
        session["is_guest"] = False
        log("AUTH", f"User registered: {username} (ID: {result['user_id']})")
        return jsonify({
            "success": True,
            "user": {"id": result["user_id"], "username": username, "display_name": display_name}
        })
    else:
        return jsonify(result), 400


@app.route('/api/auth/login', methods=['POST'])
def api_auth_login():
    try:
        data = request.get_json() or {}
        username = data.get("username", "").strip()
        if not username:
            return jsonify({"success": False, "error": "Username is required"}), 400

        user = get_user_by_username(username)
        if user:
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["display_name"] = user["display_name"]
            session["is_guest"] = False
            log("AUTH", f"User logged in: {username}")
            return jsonify({"success": True, "user": user})
        else:
            return jsonify({"success": False, "error": "User not found. Please register first."}), 401
    except Exception as e:
        log("AUTH", f"Login error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": f"Server error: {str(e)}"}), 500


@app.route('/api/auth/logout', methods=['POST'])
def api_auth_logout():
    username = session.get("username", "unknown")
    session.clear()
    log("AUTH", f"User logged out: {username}")
    return jsonify({"success": True})


@app.route('/api/auth/me', methods=['GET'])
def api_auth_me():
    if "user_id" in session and not session.get("is_guest"):
        user = get_user_by_id(session["user_id"])
        if user:
            return jsonify({"logged_in": True, "is_guest": False, "user": user})

    if session.get("is_guest"):
        return jsonify({"logged_in": False, "is_guest": True, "guest_id": session.get("guest_id")})

    return jsonify({"logged_in": False, "is_guest": False})


@app.route('/api/auth/guest', methods=['POST'])
def api_auth_guest():
    data = request.get_json(silent=True) or {}
    requested_guest_id = data.get("guest_id")
    guest_id = requested_guest_id if requested_guest_id else f"guest_{int(time.time())}"

    session["guest_id"] = guest_id
    session["is_guest"] = True
    session.pop("user_id", None)
    session.pop("username", None)

    user_folder_id = data.get("user_folder_id")
    if user_folder_id:
        session["guest_user_id"] = user_folder_id

    log("AUTH", f"Guest session started: {guest_id}")
    return jsonify({"success": True, "guest_id": guest_id})


# ==========================================
# Story List API
# ==========================================
@app.route('/api/stories', methods=['GET'])
def api_get_stories():
    if "user_id" not in session or session.get("is_guest"):
        return jsonify({"success": False, "error": "Please login first"}), 401

    # Get stories from database
    db_stories = get_user_stories(session["user_id"])

    # Also scan filesystem for this user's journeys (handles cases where DB record failed)
    db_user = get_user_by_id(session["user_id"])
    username = db_user["username"] if db_user else None

    # Merge: use DB stories but enrich with filesystem data
    stories = []
    seen_journey_ids = set()

    for story in db_stories:
        journey = load_user_journey(story["user_folder_id"])
        if journey:
            story["events"] = journey.get("events", [])
            story["story_background"] = journey.get("story_background", story.get("story_background", ""))
            story["progress"] = len(journey.get("events", []))
            story["status"] = journey.get("status", story.get("status", "active"))
        stories.append(story)
        seen_journey_ids.add(story.get("journey_id"))

    # Add filesystem-only journeys not in DB
    if username:
        fs_journeys = list_user_journeys(username)
        for fj in fs_journeys:
            if fj.get("journey_id") and fj["journey_id"] not in seen_journey_ids:
                stories.append({
                    "journey_id": fj["journey_id"],
                    "user_folder_id": fj["user_folder_id"],
                    "imaginary_world": fj["imaginary_world"],
                    "title": fj["title"],
                    "story_background": fj.get("story_background", ""),
                    "progress": fj.get("progress", 0),
                    "total_events": fj.get("total_events", 3),
                    "status": fj.get("status", "active"),
                    "created_at": fj.get("created_at", ""),
                    "events": [],
                })

    return jsonify({"success": True, "stories": stories})


@app.route('/api/stories/<journey_id>', methods=['GET'])
def api_get_story_detail(journey_id):
    story = get_story_by_journey_id(journey_id)

    if story:
        session_uid = str(session.get("user_id", ""))
        story_uid = str(story.get("user_id", ""))
        if session_uid != story_uid and not session.get("is_guest"):
            return jsonify({"success": False, "error": "Access denied"}), 403

    journey, user_folder_id = load_journey_unified(journey_id)
    if not journey:
        return jsonify({"success": False, "error": "Journey data not found"}), 404

    if not story and session.get("is_guest"):
        journey_user_id = journey.get("user_id", "")
        session_user_id = str(session.get("guest_user_id", session.get("user_id", "")))
        if journey_user_id and session_user_id and journey_user_id != session_user_id:
            return jsonify({"success": False, "error": "Access denied"}), 403

    return jsonify({
        "success": True,
        "story": story or {"journey_id": journey_id, "status": journey.get("status", "in_progress")},
        "journey": journey,
    })


@app.route('/api/db-stats', methods=['GET'])
def api_db_stats():
    stats = get_db_stats()
    return jsonify(stats)


# ==========================================
# Translation API
# ==========================================
@app.route('/api/translate', methods=['POST'])
def api_translate():
    if not OPENAI_AVAILABLE:
        return jsonify({"error": "AI service unavailable"}), 503

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    text = data.get("text", "").strip()
    target = data.get("target", "zh-CN")

    if not text:
        return jsonify({"error": "No text provided"}), 400
    if target not in ("zh-CN", "zh-TW"):
        return jsonify({"error": "Unsupported target language"}), 400

    lang_name = "Simplified Chinese" if target == "zh-CN" else "Traditional Chinese"

    try:
        response = OPENAI_CLIENT.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": f"You are a translator. Translate the following English text into {lang_name}. Preserve the narrative tone. Output ONLY the translated text."},
                {"role": "user", "content": text},
            ],
            temperature=0.3,
            max_completion_tokens=2000,
        )
        translated = response.choices[0].message.content.strip()
        return jsonify({"translated": translated, "target": target})
    except Exception as e:
        return jsonify({"error": "Translation failed"}), 500


# ==========================================
# Static File Serving
# ==========================================
@app.route('/')
def serve_index():
    return send_from_directory(str(FRONTEND_FOLDER), 'index.html')


def _ar_response(directory, filename):
    from flask import make_response
    resp = make_response(send_from_directory(str(directory), filename))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp


@app.route('/ar/tap/')
def serve_ar_tap():
    return _ar_response(FRONTEND_FOLDER / 'ar' / 'tap', 'index.html')

@app.route('/ar/tap/<path:filename>')
def serve_ar_tap_static(filename):
    return _ar_response(FRONTEND_FOLDER / 'ar' / 'tap', filename)

@app.route('/ar/rotate/')
def serve_ar_rotate():
    return _ar_response(FRONTEND_FOLDER / 'ar' / 'rotate', 'index.html')

@app.route('/ar/rotate/<path:filename>')
def serve_ar_rotate_static(filename):
    return _ar_response(FRONTEND_FOLDER / 'ar' / 'rotate', filename)

@app.route('/ar/track/')
def serve_ar_track():
    return _ar_response(FRONTEND_FOLDER / 'ar' / 'track', 'index.html')

@app.route('/ar/track/<path:filename>')
def serve_ar_track_static(filename):
    return _ar_response(FRONTEND_FOLDER / 'ar' / 'track', filename)

@app.route('/ar/viewer/')
def serve_ar_viewer():
    return _ar_response(FRONTEND_FOLDER / 'ar' / 'viewer', 'index.html')

@app.route('/ar/viewer/<path:filename>')
def serve_ar_viewer_static(filename):
    return _ar_response(FRONTEND_FOLDER / 'ar' / 'viewer', filename)

@app.route('/test')
@app.route('/test/')
def serve_test_index():
    return send_from_directory(str(FRONTEND_FOLDER), 'index.html')

@app.route('/test/<path:filename>')
def serve_test_static(filename):
    if filename.startswith('api/'):
        return jsonify({"error": "Not found"}), 404
    if filename.startswith('js/'):
        js_folder = FRONTEND_FOLDER / "js"
        js_file = filename[3:]
        if (js_folder / js_file).exists():
            return send_from_directory(str(js_folder), js_file)
    file_path = FRONTEND_FOLDER / filename
    if file_path.exists() and file_path.is_file():
        return send_from_directory(str(FRONTEND_FOLDER), filename)
    return jsonify({"error": "File not found"}), 404

@app.route('/<path:filename>')
def serve_static(filename):
    if filename.startswith('api/'):
        return jsonify({"error": "Not found"}), 404
    if filename.startswith('js/'):
        js_folder = FRONTEND_FOLDER / "js"
        js_file = filename[3:]
        if (js_folder / js_file).exists():
            return send_from_directory(str(js_folder), js_file)
    file_path = FRONTEND_FOLDER / filename
    if file_path.exists() and file_path.is_file():
        return send_from_directory(str(FRONTEND_FOLDER), filename)
    return jsonify({"error": "File not found"}), 404

@app.route('/results/<path:filename>')
def serve_result(filename):
    return send_from_directory(str(RESULT_FOLDER), filename)

@app.route('/user/<path:user_path>')
def serve_user_file(user_path):
    """Serve files from user story folders.
    Supports both new paths (eric/Historical/20260401_120000/photos/event_1.jpg)
    and legacy paths (user_1/photos/event_1.jpg).
    """
    allowed_subfolders = {"photos", "fictional_images", "cutouts", "real_3d", "fictional_3d"}

    # Split path to find the subfolder and filename
    parts = user_path.split("/")
    # Find the subfolder in the path
    subfolder_idx = None
    for i, part in enumerate(parts):
        if part in allowed_subfolders:
            subfolder_idx = i
            break

    if subfolder_idx is None or subfolder_idx + 1 >= len(parts):
        return jsonify(error="Invalid path"), 404

    # Everything before subfolder is the user_folder_id
    user_folder_id = "/".join(parts[:subfolder_idx])
    subfolder = parts[subfolder_idx]
    filename = "/".join(parts[subfolder_idx + 1:])

    for data_folder in [get_current_data_folder(), DATA_FOLDER_TEST, DATA_FOLDER]:
        file_dir = data_folder / user_folder_id / subfolder
        file_path = file_dir / filename
        if file_path.exists() and file_path.is_file():
            return send_from_directory(str(file_dir), filename)
    return jsonify(error="File not found"), 404


# ==========================================
# STORY API: Start Journey
# ==========================================
@app.route("/api/start", methods=["POST"])
def api_start():
    data = request.get_json() or {}
    imaginary_world = data.get("imaginary_world", "Fantasy")

    log("START", f"=== API START CALLED ===")

    if imaginary_world not in VALID_IMAGINARY_WORLDS:
        imaginary_world = "Fantasy"

    backend_world = imaginary_world
    world_label = WORLD_DISPLAY_NAMES.get(imaginary_world, imaginary_world)

    # Create story folder with new structure: data/{username}/{world_type}/{timestamp}/
    if "user_id" in session and not session.get("is_guest"):
        from database import get_user_by_id
        db_user = get_user_by_id(session["user_id"])
        if db_user:
            username = db_user['username']
        else:
            username = get_next_guest_id()
    else:
        username = get_next_guest_id()

    user_folder_id, story_folder = create_story_folder(username, imaginary_world)

    journey_id = str(uuid.uuid4())
    journey = {
        "user_id": user_folder_id,
        "username": username,
        "journey_id": journey_id,
        "imaginary_world": imaginary_world,
        "backend_world": backend_world,
        "world_label": world_label,
        "story_background": "",
        "goal": "",
        "titles": [],
        "nodes": [],
        "events": [],
        "total_events": 3,
        "status": "active",
        "created_at": datetime.now().isoformat(),
        "conversation_history": [],
    }

    user_message = f"""I choose the {world_label} world type. 
Please create a story for me.

Respond in this exact format:
Story Background: (within 30 words)
Goal: (the protagonist's objective, within 20 words)
Title: (a captivating title, 5-10 words)"""

    ai_response = chat_with_context(journey, user_message, task_type="story")

    story_background = ""
    goal = ""
    title = world_label

    lines = ai_response.split('\n')
    for line in lines:
        line = line.strip()
        if line.lower().startswith("story background:"):
            story_background = line.split(":", 1)[1].strip()
        elif line.lower().startswith("goal:"):
            goal = line.split(":", 1)[1].strip()
        elif line.lower().startswith("title:"):
            title = line.split(":", 1)[1].strip()

    journey["story_background"] = story_background or f"A mysterious {world_label} awaits."
    journey["goal"] = goal or "Find three magical items."
    journey["titles"].append(title or f"Adventure in {world_label}")

    story_html = f"<p><strong>{journey['story_background']}</strong></p>"
    journey["nodes"].append({
        "story_background": journey["story_background"],
        "goal": journey["goal"],
        "story_html": story_html,
        "ts": time.time()
    })

    save_user_journey(user_folder_id, journey)

    if "user_id" in session and not session.get("is_guest"):
        try:
            create_story(
                user_id=session["user_id"],
                journey_id=journey_id,
                user_folder_id=user_folder_id,
                imaginary_world=imaginary_world,
                title=journey["titles"][0] if journey["titles"] else world_label,
                story_background=journey["story_background"]
            )
        except Exception as e:
            log("START", f"Failed to record story in database: {e}")

    log("START", f"Journey created: {journey_id}")
    return jsonify(journey)


# ==========================================
# STORY API: Feedback
# ==========================================
@app.route("/api/feedback", methods=["POST"])
def api_feedback():
    data = request.get_json() or {}
    journey_id = data.get("journey_id")
    decision = data.get("decision")

    if decision not in {"accept", "reject"}:
        return jsonify(error="decision must be 'accept' or 'reject'"), 400

    journey, user_folder_id = load_journey_unified(journey_id)
    if not journey:
        return jsonify(error="Journey not found"), 404

    save_user_id = user_folder_id or g.user_id

    if decision == "accept":
        journey["status"] = "accepted"
        journey["decision"] = "accept"
        if "conversation_history" not in journey:
            journey["conversation_history"] = []
        journey["conversation_history"].append({"role": "user", "content": "I like this story. Let's continue."})
        smart_save_journey(save_user_id, journey_id, journey)
        return jsonify(journey)

    # Regenerate
    world_label = journey.get("world_label", "Fantasy")
    previous_backgrounds = [node["story_background"] for node in journey.get("nodes", []) if node.get("story_background")]
    rejected_list = "\n".join(f'- "{bg}"' for bg in previous_backgrounds)

    user_message = f"""I don't like this story. Please generate a completely different one.

Previously rejected stories:
{rejected_list}

Please create something COMPLETELY DIFFERENT:
- Different time period
- Different geographic region
- Different atmosphere

Respond in this exact format:
Story Background: (within 30 words)
Goal: (the protagonist's objective, within 20 words)
Title: (a captivating title, 5-10 words)"""

    ai_response = chat_with_context(journey, user_message, task_type="story_regenerate")

    story_background = ""
    goal = ""
    title = world_label

    lines = ai_response.split('\n')
    for line in lines:
        line = line.strip()
        if line.lower().startswith("story background:"):
            story_background = line.split(":", 1)[1].strip()
        elif line.lower().startswith("goal:"):
            goal = line.split(":", 1)[1].strip()
        elif line.lower().startswith("title:"):
            title = line.split(":", 1)[1].strip()

    journey["story_background"] = story_background or f"A mysterious {world_label} awaits."
    journey["goal"] = goal or "Find three magical items."
    journey["titles"].append(title or f"Adventure in {world_label}")
    journey["nodes"].append({
        "story_background": journey["story_background"],
        "goal": journey["goal"],
        "story_html": f"<p><strong>{journey['story_background']}</strong></p>",
        "ts": time.time()
    })
    journey["decision"] = "reject"

    smart_save_journey(save_user_id, journey_id, journey)
    return jsonify(journey)


# ==========================================
# STORY API: Photo Event
# ==========================================
@app.route("/api/photo_event", methods=["POST"])
def api_photo_event():
    journey_id = request.form.get("journey_id")
    photo = request.files.get("photo")

    if not journey_id or not photo:
        return jsonify(error="journey_id and photo are required"), 400

    # Acquire per-journey lock to prevent concurrent photo uploads (TOCTOU fix)
    journey_lock = get_journey_lock(journey_id)
    if not journey_lock.acquire(blocking=False):
        return jsonify(error="A photo is already being processed for this journey. Please wait."), 429

    try:
        return _process_photo_event(journey_id, photo)
    finally:
        journey_lock.release()


def _process_photo_event(journey_id, photo):
    """Internal photo event processing, called under journey lock."""
    journey, user_folder_id = load_journey_unified(journey_id)
    if not journey:
        return jsonify(error="Journey not found"), 404

    user_id = journey.get("user_id") or user_folder_id

    total_events = journey.get("total_events", 3)
    existing_events = len(journey.get("events", []))
    if existing_events >= total_events:
        return jsonify(error=f"Journey already has {existing_events}/{total_events} events."), 400
    if journey.get("status") == "completed":
        return jsonify(error="Journey is already completed"), 400

    log("PHOTO_EVENT", f"Processing photo for {journey_id} (user: {user_id})")

    event_index = len(journey.get("events", []))
    event_num = event_index + 1

    filename = secure_filename(photo.filename or "upload.jpg")
    ext = filename.rsplit('.', 1)[-1] if '.' in filename else 'jpg'

    if user_id:
        photo_filename = f"event_{event_num}.{ext}"
        photo_path = get_user_path(user_id, "photos") / photo_filename
        photo_path.parent.mkdir(parents=True, exist_ok=True)
    else:
        timestamp = int(time.time())
        photo_filename = f"{journey_id}_{timestamp}_{filename}"
        photo_path = UPLOAD_FOLDER / photo_filename

    photo.save(str(photo_path))
    photo_base64 = compress_image_for_vision(photo_path, max_dim=512, quality=80)

    world_label = journey.get("world_label", "Fantasy")
    backend_world = journey.get("backend_world", "Fantasy")

    if "conversation_history" not in journey:
        journey["conversation_history"] = []

    user_message = f"""This is photo {event_num} of 3 for my story adventure.

Please analyze this photo and create Event {event_num}.

IMPORTANT: Choose an Event Action Category that fits naturally with the story and the object in the photo:
- "Touch" for actions like touching, tapping, pressing, or making physical contact
- "Turning" for actions like rotating, spinning, turning, or twisting  
- "Following" for actions like following, tracking, chasing, or pursuing

The AR Interaction will be mapped from your chosen action:
- Touch → Tap (tap on 3D object to reveal fictional item)
- Turning → Rotate (rotate 3D object to reveal fictional item inside)
- Following → Track (track moving 3D object to reveal fictional item)

Respond in this EXACT format:

Photo Place: (one short phrase describing the location/setting)
Photo Place Category: (one short phrase - basic-level category)
Photo Item: (one or two key objects visible)
Photo Item Category: (one short phrase - basic-level category)

Fictional Event: (30-40 word narrative)
Fictional Location: (a location in the {world_label} world matching Photo Place Category)
Fictional Item: (a fictional version matching Photo Item Category)
Fictional Action: (what the hero does with the item)
Event Action Category: (choose one: Touch, Turning, or Following)

AR Interaction: (describe the AR interaction based on your chosen action category)
3D Item or Character: (one or two phrases)"""

    ai_response = chat_with_context(journey, user_message, image_base64=photo_base64, task_type="photo_event")

    # Parse response
    photo_analysis = {"photo_place": "", "photo_place_category": "", "photo_item": "", "photo_item_category": ""}
    event_data = {"fictional_event": "", "fictional_location": "", "fictional_item_or_character": "", "event_action": "", "event_action_category": "Touch", "ar_interaction": "", "3d_item": ""}

    lines = ai_response.split('\n')
    for line in lines:
        line = line.strip()
        lower_line = line.lower()

        if lower_line.startswith("photo place category:"):
            photo_analysis["photo_place_category"] = line.split(":", 1)[1].strip()
        elif lower_line.startswith("photo place:"):
            photo_analysis["photo_place"] = line.split(":", 1)[1].strip()
        elif lower_line.startswith("photo item category:"):
            photo_analysis["photo_item_category"] = line.split(":", 1)[1].strip()
        elif lower_line.startswith("photo item:"):
            photo_analysis["photo_item"] = line.split(":", 1)[1].strip()
        elif lower_line.startswith("fictional event"):
            event_data["fictional_event"] = line.split(":", 1)[1].strip()
        elif lower_line.startswith("fictional location:"):
            event_data["fictional_location"] = line.split(":", 1)[1].strip()
        elif lower_line.startswith("fictional item"):
            event_data["fictional_item_or_character"] = line.split(":", 1)[1].strip()
        elif lower_line.startswith("fictional action:"):
            event_data["event_action"] = line.split(":", 1)[1].strip()
        elif lower_line.startswith("event action category:"):
            category = line.split(":", 1)[1].strip().lower()
            if "touch" in category:
                event_data["event_action_category"] = "Touch"
            elif "turning" in category or "turn" in category or "rotate" in category:
                event_data["event_action_category"] = "Turning"
            elif "following" in category or "follow" in category or "track" in category:
                event_data["event_action_category"] = "Following"
        elif lower_line.startswith("ar interaction:"):
            event_data["ar_interaction"] = line.split(":", 1)[1].strip()
        elif lower_line.startswith("3d item") or lower_line.startswith("3d character"):
            event_data["3d_item"] = line.split(":", 1)[1].strip()

    ar_type = ACTION_TO_AR.get(event_data["event_action_category"], "Tap")
    ar_interaction_desc = ai_service.AR_INTERACTIONS.get(ar_type, AR_INTERACTIONS_FALLBACK.get(ar_type, ""))

    # Generate fictional image
    fictional_image_url = None
    fictional_image_path = None
    fictional_image_source = ""
    item_name = event_data.get("fictional_item_or_character", photo_analysis.get("photo_item", ""))
    if item_name:
        fictional_image_url, fictional_image_path, fictional_image_source = generate_fictional_image(
            item_name, backend_world, world_label, journey_id, event_index, user_id,
            story_background=journey.get("story_background", ""),
            photo_path=str(photo_path)
        )

    if user_id:
        photo_image_url = f"/user/{user_id}/photos/event_{event_num}.{ext}"
    else:
        photo_image_url = f"/results/photo_{photo_filename}"
        shutil.copy(photo_path, RESULT_FOLDER / f"photo_{photo_filename}")

    photo_3d_job_id = f"{journey_id}_photo_{event_index}"
    fictional_3d_job_id = f"{journey_id}_fictional_{event_index}" if fictional_image_path else None

    event = {
        "event_id": str(uuid.uuid4()),
        "event_index": event_index,
        "photo_place": photo_analysis.get("photo_place", ""),
        "photo_place_category": photo_analysis.get("photo_place_category", ""),
        "photo_item": photo_analysis.get("photo_item", ""),
        "photo_item_category": photo_analysis.get("photo_item_category", ""),
        "event_text": event_data.get("fictional_event", ""),
        "fictional_location": event_data.get("fictional_location", ""),
        "fictional_item_or_character": event_data.get("fictional_item_or_character", ""),
        "event_action": event_data.get("event_action", ""),
        "event_action_category": event_data.get("event_action_category", "Touch"),
        "location": event_data.get("fictional_location", ""),
        "item_or_character": event_data.get("fictional_item_or_character", ""),
        "action": event_data.get("event_action", ""),
        "action_category": event_data.get("event_action_category", "Touch"),
        "ar_interaction": event_data.get("ar_interaction", "") or ar_interaction_desc,
        "ar_interaction_type": ar_type,
        "ar_interaction_description": ar_interaction_desc,
        "3d_item": event_data.get("3d_item", "") or f"3D {event_data.get('fictional_item_or_character', '')}",
        "photo_item_name": photo_analysis.get("photo_item", "Real Item"),
        "fictional_item_name": event_data.get("fictional_item_or_character", "Fictional Character"),
        "photo_image_url": photo_image_url,
        "fictional_image_url": fictional_image_url,
        "fictional_image_source": fictional_image_source,
        "photo_3d_job_id": photo_3d_job_id,
        "fictional_3d_job_id": fictional_3d_job_id,
        "photo_path": str(photo_path),
        "fictional_image_path": str(fictional_image_path) if fictional_image_path else None,
        "timestamp": time.time()
    }

    if "events" not in journey:
        journey["events"] = []
    journey["events"].append(event)

    # Pre-create job records for frontend polling
    if event.get("photo_item"):
        simplified_photo_prompt = simplify_prompt_for_sam3(event["photo_item"])
        create_job(photo_3d_job_id, simplified_photo_prompt, str(photo_path))

    if fictional_image_path and event.get("item_or_character"):
        simplified_fictional_prompt = simplify_prompt_for_sam3(event["item_or_character"])
        create_job(fictional_3d_job_id, simplified_fictional_prompt, str(fictional_image_path))

    # ========================================
    # Background 3D generation via Vast.ai
    # ========================================
    saved_user_id = g.user_id
    saved_data_folder = g.data_folder

    def generate_3d_models():
        """Background thread: send images to Vast.ai GPU worker."""
        nonlocal event, journey

        if user_id:
            real_3d_folder = get_user_path(user_id, "real_3d", data_folder=saved_data_folder)
            fictional_3d_folder = get_user_path(user_id, "fictional_3d", data_folder=saved_data_folder)
            cutouts_folder = get_user_path(user_id, "cutouts", data_folder=saved_data_folder)
            real_3d_output = real_3d_folder / f"event_{event_index + 1}.glb"
            fictional_3d_output = fictional_3d_folder / f"event_{event_index + 1}.glb"
            photo_cutout_output = cutouts_folder / f"photo_event_{event_index + 1}.png"
            fictional_cutout_output = cutouts_folder / f"fictional_event_{event_index + 1}.png"
        else:
            real_3d_output = RESULT_FOLDER / f"{journey_id}_photo_{event_index}.glb"
            fictional_3d_output = RESULT_FOLDER / f"{journey_id}_fictional_{event_index}.glb"
            photo_cutout_output = None
            fictional_cutout_output = None

        # --- Parallel 3D generation: Photo + Fictional run simultaneously ---
        def _generate_photo_3d():
            """Thread: generate 3D model from user's real photo."""
            if not event.get("photo_item"):
                return
            photo_job_id = f"{journey_id}_photo_{event_index}"
            simplified_prompt = simplify_prompt_for_sam3(event["photo_item"])
            log("3D_GEN", f"[PHOTO] Sending to GPU worker: {simplified_prompt}")
            update_job_status(photo_job_id, "processing", "Sending to GPU worker", 10)

            def _photo_progress(step, progress):
                # Remap GPU worker progress (0-100) to our range (10-90)
                mapped = 10 + int(progress * 0.8)
                update_job_status(photo_job_id, "processing", step, mapped)

            ok, err = run_remote_3d_pipeline(
                job_id=photo_job_id,
                image_path=str(photo_path),
                prompt=simplified_prompt,
                glb_output_path=str(real_3d_output),
                cutout_output_path=str(photo_cutout_output) if photo_cutout_output else None,
                progress_callback=_photo_progress,
            )

            if ok:
                update_job_status(photo_job_id, "completed", "Complete", 100, files={"glb": str(real_3d_output)})
                if user_id:
                    event["photo_3d_url"] = f"/user/{user_id}/real_3d/event_{event_index + 1}.glb"
                    event["photo_cutout_url"] = f"/user/{user_id}/cutouts/photo_event_{event_index + 1}.png"
            else:
                log("3D_GEN", f"[PHOTO] Failed: {err}")
                create_placeholder_glb(str(real_3d_output))
                update_job_status(photo_job_id, "failed", "GPU failed", 100, error=err, files={"glb": str(real_3d_output)})
                if user_id:
                    event["photo_3d_url"] = f"/user/{user_id}/real_3d/event_{event_index + 1}.glb"

        def _generate_fictional_3d():
            """Thread: generate 3D model from AI-generated fictional image."""
            if not (fictional_image_path and event.get("item_or_character")):
                return
            fictional_job_id = f"{journey_id}_fictional_{event_index}"
            fi_path = Path(fictional_image_path)

            if not fi_path.exists():
                return

            simplified_prompt = simplify_prompt_for_sam3(event["item_or_character"])
            log("3D_GEN", f"[FICTIONAL] Sending to GPU worker: {simplified_prompt}")
            update_job_status(fictional_job_id, "processing", "Sending to GPU worker", 10)

            def _fictional_progress(step, progress):
                mapped = 10 + int(progress * 0.8)
                update_job_status(fictional_job_id, "processing", step, mapped)

            ok, err = run_remote_3d_pipeline(
                job_id=fictional_job_id,
                image_path=str(fi_path),
                prompt=simplified_prompt,
                glb_output_path=str(fictional_3d_output),
                cutout_output_path=str(fictional_cutout_output) if fictional_cutout_output else None,
                progress_callback=_fictional_progress,
            )

            if ok:
                update_job_status(fictional_job_id, "completed", "Complete", 100, files={"glb": str(fictional_3d_output)})
                if user_id:
                    event["fictional_3d_url"] = f"/user/{user_id}/fictional_3d/event_{event_index + 1}.glb"
                    event["fictional_cutout_url"] = f"/user/{user_id}/cutouts/fictional_event_{event_index + 1}.png"
            else:
                log("3D_GEN", f"[FICTIONAL] Failed: {err}")
                create_placeholder_glb(str(fictional_3d_output))
                update_job_status(fictional_job_id, "failed", "GPU failed", 100, error=err, files={"glb": str(fictional_3d_output)})
                if user_id:
                    event["fictional_3d_url"] = f"/user/{user_id}/fictional_3d/event_{event_index + 1}.glb"

        # Launch both 3D jobs in parallel threads
        photo_thread = threading.Thread(target=_generate_photo_3d, daemon=True)
        fictional_thread = threading.Thread(target=_generate_fictional_3d, daemon=True)

        photo_thread.start()
        fictional_thread.start()

        # Wait for both to finish before saving journey
        photo_thread.join()
        fictional_thread.join()

        smart_save_journey(user_id or saved_user_id, journey_id, journey, data_folder=saved_data_folder)
        log("3D_GEN", f"3D models generated for event {event_index}")

    thread = threading.Thread(target=generate_3d_models, daemon=True)
    thread.start()

    if len(journey["events"]) >= journey.get("total_events", 3):
        journey["status"] = "completed"

    if "user_id" in session and not session.get("is_guest"):
        try:
            update_story_progress(
                journey_id=journey_id,
                progress=len(journey["events"]),
                title=journey.get("titles", [None])[0],
                story_background=journey.get("story_background")
            )
        except Exception as e:
            log("PHOTO_EVENT", f"Failed to update story progress: {e}")

    smart_save_journey(user_id or g.user_id, journey_id, journey)
    return jsonify(event)


# ==========================================
# 3D API: Process Image (manual direct submission)
# ==========================================
@app.route("/api/process", methods=["POST"])
def api_process():
    """
    Submit image for 3D model generation (direct, non-journey flow).

    Form Data:
        image: file
        prompt: string
    """
    if 'image' not in request.files:
        return jsonify(error="No image file provided"), 400

    image = request.files['image']
    prompt = request.form.get('prompt', 'object')

    if not image.filename:
        return jsonify(error="Empty filename"), 400

    if not allowed_file(image.filename):
        return jsonify(error=f"File type not allowed. Use: {ALLOWED_EXTENSIONS}"), 400

    job_id = generate_job_id()
    filename = secure_filename(image.filename)
    image_path = UPLOAD_FOLDER / f"{job_id}_{filename}"
    image.save(str(image_path))

    simplified_prompt = simplify_prompt_for_sam3(prompt)
    create_job(job_id, simplified_prompt, str(image_path))

    glb_output_path = RESULT_FOLDER / f"{job_id}.glb"
    cutout_output_path = RESULT_FOLDER / f"{job_id}_cutout.png"

    log("PROCESS", f"New job {job_id}: prompt='{simplified_prompt}'")

    def _run():
        update_job_status(job_id, "processing", "Sending to GPU worker", 10)

        def _progress(step, progress):
            mapped = 10 + int(progress * 0.8)
            update_job_status(job_id, "processing", step, mapped)

        ok, err = run_remote_3d_pipeline(
            job_id=job_id,
            image_path=str(image_path),
            prompt=simplified_prompt,
            glb_output_path=str(glb_output_path),
            cutout_output_path=str(cutout_output_path),
            progress_callback=_progress,
        )
        if ok:
            update_job_status(job_id, "completed", "Complete", 100, files={"glb": str(glb_output_path)})
        else:
            log("PROCESS", f"GPU worker failed: {err}")
            create_placeholder_glb(str(glb_output_path))
            update_job_status(job_id, "failed", "GPU failed", 100, error=err, files={"glb": str(glb_output_path)})

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"job_id": job_id})


# ==========================================
# 3D API: Check Status (polls local jobs.json)
# ==========================================
@app.get("/api/status/<job_id>")
def api_status(job_id):
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
        glb_path = job['files']['glb']
        matched = False
        for data_marker in ["/data_test/", "/data/"]:
            if data_marker in glb_path:
                relative_path = glb_path.split(data_marker)[-1]
                response["glb_url"] = f"/user/{relative_path}"
                matched = True
                break
        if not matched:
            response["glb_url"] = f"/results/{Path(glb_path).name}"

    if job.get("error"):
        response["error"] = job["error"]

    return jsonify(response)


@app.get("/api/download/<job_id>")
def api_download(job_id):
    jobs = load_jobs()
    if job_id not in jobs:
        return jsonify(error="Job not found"), 404
    job = jobs[job_id]
    if job.get("status") != "completed":
        return jsonify(error="Job not completed"), 400
    glb_path = job.get("files", {}).get("glb")
    if not glb_path or not Path(glb_path).exists():
        return jsonify(error="GLB file not found"), 404
    return send_file(glb_path, mimetype='model/gltf-binary', as_attachment=True, download_name=f"{job_id}.glb")


# ==========================================
# Main Entry Point
# ==========================================
if __name__ == "__main__":
    init_db()

    print("")
    print("=" * 60)
    print("  🌟 Imaginary World - Hostinger Backend")
    print("=" * 60)
    print(f"  Frontend:     {FRONTEND_FOLDER}")
    print(f"  Data:         {DATA_FOLDER}")
    print(f"  AI Provider:  {'OpenAI ✅' if OPENAI_AVAILABLE else 'Not configured ❌'}")
    print(f"  GPU Worker:   {get_gpu_url() or '(will auto-discover)'}")
    print(f"  Database:     SQLite ✅")
    print(f"  Port:         {SERVER_PORT}")
    print("=" * 60)

    print("  📄 Loading Template...")
    reload_system_prompt()
    template_status = "Loaded ✅" if ai_service.SYSTEM_PROMPT_TEMPLATE else "Not found"
    print(f"  Template:     {template_status}")
    print("=" * 60)
    print(f"  🌐 URL: http://localhost:{SERVER_PORT}")
    print("=" * 60)
    print("")

    app.run(host="0.0.0.0", port=SERVER_PORT, debug=DEBUG_MODE)
