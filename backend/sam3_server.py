#!/usr/bin/env python3
"""
SAM3 Persistent Model Server
==============================
Keeps SAM3 model loaded in GPU memory for instant inference.
Run in the `sam3` conda environment.

Usage:
    CUDA_VISIBLE_DEVICES=0 python sam3_server.py

Endpoints:
    POST /segment  - Run segmentation (JSON with file paths + prompt)
    GET  /health   - Check if model is loaded
"""

import os
import sys
import gc
import json
import time
import threading
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

import numpy as np
import torch
from PIL import Image, ImageOps

# ==========================================
# Configuration
# ==========================================
WORKSPACE = os.environ.get("WORKSPACE", "/workspace")
SAM3_REPO = os.environ.get("SAM3_REPO", os.path.join(WORKSPACE, "sam3"))
PORT = int(os.environ.get("SAM3_SERVER_PORT", "5561"))

os.environ["HF_HOME"] = os.path.join(WORKSPACE, ".hf_home")
sys.path.insert(0, SAM3_REPO)

# ==========================================
# Global Model State
# ==========================================
model = None
processor = None
device = None
model_loaded = False
inference_lock = threading.Lock()


def load_model():
    """Load SAM3 model into GPU memory (called once at startup)."""
    global model, processor, device, model_loaded

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[SAM3 Server] Loading model on {device}...")
    start = time.time()

    from sam3.model_builder import build_sam3_image_model
    from sam3.model.sam3_image_processor import Sam3Processor

    model = build_sam3_image_model().to(device).eval()
    processor = Sam3Processor(model, confidence_threshold=0.15)
    model_loaded = True

    elapsed = time.time() - start
    print(f"[SAM3 Server] Model loaded in {elapsed:.1f}s on {device}")


def segment(image_path, prompt, mask_path, cutout_path):
    """Run SAM3 segmentation using the pre-loaded model."""
    start = time.time()

    # Load and preprocess image
    image = Image.open(image_path)
    try:
        image = ImageOps.exif_transpose(image)
    except Exception:
        pass
    image = image.convert("RGB")

    # Resize large images (SAM3 squashes to 1008x1008 internally)
    MAX_DIM = 1500
    orig_w, orig_h = image.size
    if max(orig_w, orig_h) > MAX_DIM:
        scale = MAX_DIM / max(orig_w, orig_h)
        new_w = int(orig_w * scale)
        new_h = int(orig_h * scale)
        image = image.resize((new_w, new_h), Image.LANCZOS)
        print(f"[SAM3] Resized: {orig_w}x{orig_h} -> {new_w}x{new_h}")

    # Keep original for full-res cutout
    original_image = Image.open(image_path)
    try:
        original_image = ImageOps.exif_transpose(original_image)
    except Exception:
        pass
    original_image = original_image.convert("RGB")

    resized_w, resized_h = image.size

    # Run segmentation
    state = processor.set_image(image)
    mask2d = None
    mask_coverage = 0.0
    confidence = 0.0

    try:
        output = processor.set_text_prompt(state=state, prompt=prompt)
        masks, scores = output["masks"], output["scores"]

        if scores.numel() == 0 or masks.numel() == 0:
            print(f"[SAM3] No objects detected for '{prompt}', using full image mask")
            img_np = np.array(image)
            mask2d = np.ones((img_np.shape[0], img_np.shape[1]), dtype=bool)
        else:
            best = int(torch.argmax(scores).item())
            mask = masks[best].detach().cpu().numpy()
            confidence = scores[best].item()

            if mask.ndim == 3:
                mask2d = mask[0]
            else:
                mask2d = mask
            mask2d = mask2d.astype(bool)

            mask_coverage = mask2d.sum() / mask2d.size

            MIN_COVERAGE = 0.0001
            MIN_CONFIDENCE = 0.3

            if mask_coverage < MIN_COVERAGE or confidence < MIN_CONFIDENCE:
                print(f"[SAM3] Low quality mask (coverage={mask_coverage:.4f}, conf={confidence:.2f}), using full image")
                mask2d = np.ones_like(mask2d, dtype=bool)
                mask_coverage = 1.0
            else:
                print(f"[SAM3] Mask accepted: {mask_coverage*100:.2f}% coverage, {confidence:.2f} confidence")

    except Exception as e:
        print(f"[SAM3] Text prompt failed: {e}, using full image mask")
        img_np = np.array(image)
        mask2d = np.ones((img_np.shape[0], img_np.shape[1]), dtype=bool)
        mask_coverage = 1.0

    # Scale mask back to original image size
    orig_w, orig_h = original_image.size
    if (orig_w, orig_h) != (resized_w, resized_h):
        mask_img = Image.fromarray(mask2d.astype(np.uint8) * 255, mode="L")
        mask_img = mask_img.resize((orig_w, orig_h), Image.NEAREST)
        mask2d_full = np.array(mask_img).astype(bool)
    else:
        mask2d_full = mask2d

    # Save mask
    Image.fromarray((mask2d_full.astype(np.uint8) * 255), mode="L").save(mask_path)

    # Generate RGBA cutout with zeroed-out background
    img_np = np.array(original_image)
    img_np[~mask2d_full] = 0
    alpha = (mask2d_full * 255).astype(np.uint8)[..., None]
    rgba = np.concatenate([img_np, alpha], axis=2)
    Image.fromarray(rgba, "RGBA").save(cutout_path)

    # Cleanup
    torch.cuda.empty_cache()
    gc.collect()

    elapsed = time.time() - start
    print(f"[SAM3] Segmentation done in {elapsed:.1f}s")

    return {
        "success": True,
        "time": elapsed,
        "mask_coverage": float(mask_coverage),
        "confidence": float(confidence),
    }


# ==========================================
# HTTP Server
# ==========================================
class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class SAM3Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            resp = json.dumps({
                "status": "ok",
                "model_loaded": model_loaded,
                "device": str(device),
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(resp.encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/segment":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length))

            with inference_lock:
                try:
                    result = segment(
                        body["image_path"],
                        body["prompt"],
                        body["mask_path"],
                        body["cutout_path"],
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
        print(f"[SAM3 Server] {format % args}")


if __name__ == "__main__":
    print("=" * 50)
    print("  SAM3 Persistent Model Server")
    print("=" * 50)
    load_model()
    server = ThreadedHTTPServer(("127.0.0.1", PORT), SAM3Handler)
    print(f"[SAM3 Server] Listening on 127.0.0.1:{PORT}")
    print("=" * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[SAM3 Server] Shutting down...")
        server.shutdown()
