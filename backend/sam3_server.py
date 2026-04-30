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

    # Force float32 everywhere — prevent BFloat16 from checkpoint/autocast
    torch.set_default_dtype(torch.float32)

    # Monkey-patch perflib.fused.addmm_act: the upstream version forces bfloat16
    # which breaks on RTX A5000 (no native bf16 matmul) and causes dtype mismatches.
    import sam3.perflib.fused as _fused_mod

    def _addmm_act_float32(activation, linear, mat1):
        """addmm_act that stays in float32 instead of forcing bfloat16."""
        x = torch.nn.functional.linear(mat1, linear.weight, linear.bias)
        if activation in [torch.nn.functional.relu, torch.nn.ReLU]:
            return torch.nn.functional.relu(x)
        if activation in [torch.nn.functional.gelu, torch.nn.GELU]:
            return torch.nn.functional.gelu(x)
        raise ValueError(f"Unexpected activation {activation}")

    _fused_mod.addmm_act = _addmm_act_float32
    # Also patch it in vitdet which already imported the symbol
    import sam3.model.vitdet as _vitdet_mod
    _vitdet_mod.addmm_act = _addmm_act_float32
    print("[SAM3 Server] Patched addmm_act to float32 (disabled bfloat16 fused op)")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[SAM3 Server] Loading model on {device}...")
    start = time.time()

    from sam3.model_builder import build_sam3_image_model
    from sam3.model.sam3_image_processor import Sam3Processor

    model = build_sam3_image_model().float().to(device).eval()

    # Verify all params are float32
    bf16_params = [n for n, p in model.named_parameters() if p.dtype == torch.bfloat16]
    if bf16_params:
        print(f"[SAM3 Server] WARNING: {len(bf16_params)} params still bfloat16, forcing float32")
        for n, p in model.named_parameters():
            if p.dtype != torch.float32:
                p.data = p.data.float()
        for n, b in model.named_buffers():
            if b.is_floating_point() and b.dtype != torch.float32:
                b.data = b.data.float()

    processor = Sam3Processor(model, confidence_threshold=0.15)
    model_loaded = True

    elapsed = time.time() - start
    print(f"[SAM3 Server] Model loaded in {elapsed:.1f}s on {device}")


MIN_COVERAGE = 0.0005   # Mask must cover at least 0.05% of image
MAX_COVERAGE = 0.95     # Mask covering >95% is likely background-inverted / useless
MIN_CONFIDENCE = 0.15   # Below this, mask quality is suspect


def _extract_best_mask(masks, scores):
    """Extract best mask from SAM3 output. Returns (mask2d, coverage, confidence) or None."""
    if scores.numel() == 0 or masks.numel() == 0:
        return None

    best = int(torch.argmax(scores).item())
    mask = masks[best].detach().cpu().numpy()
    confidence = scores[best].item()

    mask2d = mask[0] if mask.ndim == 3 else mask
    mask2d = mask2d.astype(bool)
    coverage = mask2d.sum() / mask2d.size

    if coverage < MIN_COVERAGE or coverage > MAX_COVERAGE:
        print(f"[SAM3]   Rejected: coverage={coverage*100:.2f}% (out of range), conf={confidence:.2f}")
        return None
    if confidence < MIN_CONFIDENCE:
        print(f"[SAM3]   Rejected: conf={confidence:.2f} < {MIN_CONFIDENCE}, coverage={coverage*100:.2f}%")
        return None

    return mask2d, coverage, confidence


def segment(image_path, prompt, mask_path, cutout_path):
    """
    Run SAM3 segmentation with multi-tier fallback:
      1. Text grounding with user prompt
      2. Text grounding with simplified single-word prompts
      3. Geometric box prompt (center 80% of image)
      4. Full image fallback
    """
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

    # ============================================================
    # Multi-tier segmentation strategy
    # ============================================================
    mask2d = None
    mask_coverage = 0.0
    confidence = 0.0
    strategy_used = "none"

    # --- Strategy 1: Text grounding with user prompt ---
    try:
        print(f"[SAM3] Strategy 1: Text grounding with '{prompt}'")
        state = processor.set_image(image)
        output = processor.set_text_prompt(state=state, prompt=prompt)
        result = _extract_best_mask(output["masks"], output["scores"])
        if result:
            mask2d, mask_coverage, confidence = result
            strategy_used = "text_prompt"
            print(f"[SAM3] ✅ Strategy 1 succeeded: {mask_coverage*100:.2f}% coverage, {confidence:.2f} conf")
    except Exception as e:
        print(f"[SAM3] Strategy 1 failed: {e}")

    # --- Strategy 2: Text grounding with simpler prompts ---
    if mask2d is None:
        # Extract meaningful words from prompt, plus generic fallbacks
        words = [w for w in prompt.lower().split() if len(w) > 2 and w not in
                 ("the", "main", "this", "that", "with", "and", "for")]
        fallback_prompts = words + ["object", "item", "product", "foreground"]
        # Deduplicate while preserving order
        seen = set()
        fallback_prompts = [p for p in fallback_prompts if not (p in seen or seen.add(p))]

        for fp in fallback_prompts[:6]:
            try:
                print(f"[SAM3] Strategy 2: Text grounding with '{fp}'")
                state = processor.set_image(image)
                output = processor.set_text_prompt(state=state, prompt=fp)
                result = _extract_best_mask(output["masks"], output["scores"])
                if result:
                    mask2d, mask_coverage, confidence = result
                    strategy_used = f"text_fallback:{fp}"
                    print(f"[SAM3] ✅ Strategy 2 succeeded with '{fp}': {mask_coverage*100:.2f}% coverage, {confidence:.2f} conf")
                    break
            except Exception as e:
                print(f"[SAM3] Strategy 2 '{fp}' failed: {e}")

    # --- Strategy 3: Geometric box prompt (center of image) ---
    if mask2d is None:
        # Try progressively larger center boxes
        box_sizes = [
            ([0.5, 0.5, 0.6, 0.6], "center 60%"),
            ([0.5, 0.5, 0.8, 0.8], "center 80%"),
            ([0.5, 0.5, 0.95, 0.95], "center 95%"),
        ]
        for box, desc in box_sizes:
            try:
                print(f"[SAM3] Strategy 3: Box prompt ({desc})")
                state = processor.set_image(image)
                output = processor.add_geometric_prompt(box=box, label=True, state=state)
                result = _extract_best_mask(output["masks"], output["scores"])
                if result:
                    mask2d, mask_coverage, confidence = result
                    strategy_used = f"box:{desc}"
                    print(f"[SAM3] ✅ Strategy 3 succeeded with {desc}: {mask_coverage*100:.2f}% coverage, {confidence:.2f} conf")
                    break
            except Exception as e:
                print(f"[SAM3] Strategy 3 '{desc}' failed: {e}")

    # --- Strategy 4: Full image fallback ---
    if mask2d is None:
        print(f"[SAM3] ⚠️ All strategies failed — using full image mask")
        img_np = np.array(image)
        mask2d = np.ones((img_np.shape[0], img_np.shape[1]), dtype=bool)
        mask_coverage = 1.0
        confidence = 0.0
        strategy_used = "full_image_fallback"

    print(f"[SAM3] Strategy used: {strategy_used}")

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
        "strategy": strategy_used,
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
