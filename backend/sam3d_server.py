#!/usr/bin/env python3
"""
SAM3D Persistent Model Server
================================
Keeps SAM3D model loaded in GPU memory for instant inference.
Run in the `sam3d-objects` conda environment.

Usage:
    cd /workspace/sam-3d-objects
    CUDA_VISIBLE_DEVICES=1 python /workspace/IW/backend/sam3d_server.py

Endpoints:
    POST /reconstruct  - Run 3D reconstruction (JSON with file paths)
    GET  /health       - Check if model is loaded
"""

import os
import sys
import gc
import json
import glob
import time
import shutil
import threading
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

import numpy as np
from PIL import Image

# ==========================================
# Configuration
# ==========================================
WORKSPACE = os.environ.get("WORKSPACE", "/workspace")
SAM3D_REPO = os.environ.get("SAM3D_REPO", os.path.join(WORKSPACE, "sam-3d-objects"))
SAM3D_CHECKPOINT = os.environ.get("SAM3D_CHECKPOINT", "hf")
PORT = int(os.environ.get("SAM3D_SERVER_PORT", "5562"))

os.environ["HF_HOME"] = os.path.join(WORKSPACE, ".hf_home")
os.environ["CUDA_HOME"] = os.environ.get("CONDA_PREFIX", "/opt/conda")
os.environ["LIDRA_SKIP_INIT"] = "true"

# Must be in SAM3D repo directory for relative checkpoint paths
os.chdir(SAM3D_REPO)
sys.path.insert(0, os.path.join(SAM3D_REPO, "notebook"))

# ==========================================
# Global Model State
# ==========================================
inference_model = None
model_loaded = False
inference_lock = threading.Lock()

# Torch imported after env setup
import torch


def load_model():
    """Load SAM3D Inference model into GPU memory (called once at startup)."""
    global inference_model, model_loaded

    config_path = os.path.join(SAM3D_REPO, f"checkpoints/{SAM3D_CHECKPOINT}/pipeline.yaml")
    if not os.path.exists(config_path):
        print(f"[SAM3D Server] ERROR: Missing config {config_path}")
        sys.exit(1)

    print(f"[SAM3D Server] Loading model from {config_path}...")
    print(f"[SAM3D Server] compile=False (avoiding warmup issues)")
    start = time.time()

    from inference import Inference
    inference_model = Inference(config_path, compile=False)
    model_loaded = True

    elapsed = time.time() - start
    print(f"[SAM3D Server] Model loaded in {elapsed:.1f}s")


def reconstruct(cutout_path, glb_path, job_id=""):
    """Run SAM3D 3D reconstruction using the pre-loaded model."""
    start = time.time()

    # Load RGBA cutout
    rgba = np.array(Image.open(cutout_path).convert("RGBA"))
    image = rgba[..., :3].copy()
    mask = (rgba[..., 3] > 0).astype(np.uint8)

    # Zero out background (critical for MoGe depth model)
    image[mask == 0] = 0

    mask_pct = (mask > 0).sum() / mask.size * 100
    print(f"[SAM3D] Input: {image.shape}, mask coverage: {mask_pct:.1f}%")

    # Per-job meshes directory to avoid race conditions
    default_meshes_dir = os.path.join(SAM3D_REPO, "notebook", "meshes")
    job_meshes_dir = os.path.join(SAM3D_REPO, "notebook", f"meshes_{job_id}")
    os.makedirs(job_meshes_dir, exist_ok=True)
    os.makedirs(default_meshes_dir, exist_ok=True)

    # Track existing GLB files before inference
    watch_dirs = [default_meshes_dir, job_meshes_dir]
    before = set()
    for wd in watch_dirs:
        before.update(glob.glob(os.path.join(wd, "**", "*.glb"), recursive=True))

    # Run inference
    print(f"[SAM3D] Running inference...")
    try:
        out = inference_model(image, mask, seed=42)
        print(f"[SAM3D] Inference completed, output type: {type(out)}")
    except Exception as e:
        print(f"[SAM3D] Inference FAILED: {e}")
        traceback.print_exc()
        return {"success": False, "error": str(e), "time": time.time() - start}

    # Try to export GLB from returned dict
    glb_saved = False

    try:
        if isinstance(out, dict) and "glb" in out:
            glb = out["glb"]
            if hasattr(glb, "export"):
                glb.export(glb_path)
                glb_saved = True
                print(f"[SAM3D] GLB exported via .export()")
            elif isinstance(glb, (bytes, bytearray)):
                with open(glb_path, "wb") as f:
                    f.write(glb)
                glb_saved = True
                print(f"[SAM3D] GLB written from bytes")
    except Exception as e:
        print(f"[SAM3D] GLB export failed: {e}")

    # Fallback: check for newly generated GLB files
    if not glb_saved:
        after = set()
        for wd in watch_dirs:
            after.update(glob.glob(os.path.join(wd, "**", "*.glb"), recursive=True))
        new_glb = list(after - before)
        if new_glb:
            try:
                src = max(new_glb, key=lambda p: os.path.getmtime(p))
                shutil.copy(src, glb_path)
                glb_saved = True
                print(f"[SAM3D] GLB copied from: {src}")
            except Exception as e:
                print(f"[SAM3D] GLB copy failed: {e}")

    # Cleanup
    try:
        if os.path.exists(job_meshes_dir):
            shutil.rmtree(job_meshes_dir, ignore_errors=True)
    except Exception:
        pass

    torch.cuda.empty_cache()
    gc.collect()

    elapsed = time.time() - start
    glb_size = os.path.getsize(glb_path) if os.path.exists(glb_path) else 0

    if glb_saved and glb_size > 5000:
        print(f"[SAM3D] Success! GLB: {glb_size:,} bytes in {elapsed:.1f}s")
        return {"success": True, "time": elapsed, "glb_size": glb_size}
    else:
        msg = f"GLB too small ({glb_size} bytes)" if glb_saved else "No GLB output"
        print(f"[SAM3D] Failed: {msg}")
        return {"success": False, "error": msg, "time": elapsed}


# ==========================================
# HTTP Server
# ==========================================
class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class SAM3DHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            resp = json.dumps({
                "status": "ok",
                "model_loaded": model_loaded,
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(resp.encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/reconstruct":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length))

            with inference_lock:
                try:
                    result = reconstruct(
                        body["cutout_path"],
                        body["glb_path"],
                        body.get("job_id", ""),
                    )
                except Exception as e:
                    traceback.print_exc()
                    result = {"success": False, "error": str(e), "time": 0}

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        print(f"[SAM3D Server] {format % args}")


if __name__ == "__main__":
    print("=" * 50)
    print("  SAM3D Persistent Model Server")
    print("=" * 50)
    load_model()
    server = ThreadedHTTPServer(("127.0.0.1", PORT), SAM3DHandler)
    print(f"[SAM3D Server] Listening on 127.0.0.1:{PORT}")
    print("=" * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[SAM3D Server] Shutting down...")
        server.shutdown()
