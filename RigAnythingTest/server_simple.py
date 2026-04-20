"""
server_simple.py — RigAnything Simplified Backend
Pure upload → inference → preview → export flow, no Chat/AI features.
"""

import os
import uuid
import subprocess
import traceback

import numpy as np
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

from config import (
    BASE_DIR, UPLOAD_DIR, OUTPUT_DIR, SERVER_PORT,
    RIGANYTHING_DIR, RIGANYTHING_EXAMPLES,
)
from export_glb import export_from_modified_data

app = Flask(__name__, static_folder="static_simple", static_url_path="/static")
CORS(app)

# In-memory sessions: session_id -> { mesh_path, npz_data, output_dir }
sessions = {}

ALLOWED_EXTENSIONS = {"glb", "gltf", "obj", "fbx"}


# ==========================================
# Pages
# ==========================================

@app.route("/")
def index():
    return send_from_directory("static_simple", "index.html")


# ==========================================
# Upload
# ==========================================

@app.route("/api/upload", methods=["POST"])
def upload_mesh():
    file = request.files.get("file")
    if not file:
        example_name = request.form.get("example")
        if example_name:
            safe_name = secure_filename(example_name)
            example_path = RIGANYTHING_EXAMPLES / safe_name
            if not example_path.exists():
                return jsonify({"error": f"Example not found: {safe_name}"}), 404
            session_id = uuid.uuid4().hex[:12]
            out_dir = str(OUTPUT_DIR / session_id)
            os.makedirs(out_dir, exist_ok=True)
            sessions[session_id] = {
                "mesh_path": str(example_path),
                "npz_data": None,
                "output_dir": out_dir,
            }
            return jsonify({
                "session_id": session_id,
                "mesh_url": f"/api/mesh/{session_id}/original",
                "message": "Example loaded. Ready for rigging.",
            })
        return jsonify({"error": "No file provided"}), 400

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": "Unsupported file format"}), 400

    session_id = uuid.uuid4().hex[:12]
    out_dir = str(OUTPUT_DIR / session_id)
    os.makedirs(out_dir, exist_ok=True)

    filename = secure_filename(file.filename)
    save_path = str(UPLOAD_DIR / f"{session_id}_{filename}")
    file.save(save_path)

    sessions[session_id] = {
        "mesh_path": save_path,
        "npz_data": None,
        "output_dir": out_dir,
    }

    return jsonify({
        "session_id": session_id,
        "mesh_url": f"/api/mesh/{session_id}/original",
        "message": "File uploaded successfully. Ready for rigging.",
    })


@app.route("/api/examples", methods=["GET"])
def list_examples():
    examples = []
    if RIGANYTHING_EXAMPLES.exists():
        for f in sorted(RIGANYTHING_EXAMPLES.iterdir()):
            if f.suffix.lower() in (".glb", ".gltf", ".obj"):
                examples.append({"name": f.stem, "filename": f.name})
    return jsonify(examples)


# ==========================================
# Original Mesh
# ==========================================

@app.route("/api/mesh/<session_id>/original", methods=["GET"])
def get_original_mesh(session_id):
    """Serve the original mesh GLB for Three.js"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404
    mesh_path = sessions[session_id]["mesh_path"]
    if not os.path.exists(mesh_path):
        return jsonify({"error": "Mesh file not found"}), 404
    return send_file(mesh_path, mimetype="model/gltf-binary")


# ==========================================
# Rigging Inference
# ==========================================

@app.route("/api/rig/<session_id>", methods=["POST"])
def run_rig(session_id):
    """Run RigAnything inference, return skeleton data"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404

    sess = sessions[session_id]
    mesh_path = sess["mesh_path"]

    try:
        npz_path = _run_inference(mesh_path, sess["output_dir"])

        npz_data = dict(np.load(npz_path, allow_pickle=True))
        sess["npz_data"] = npz_data

        joints = npz_data["joints"][..., :3].tolist()
        parents = npz_data["parents"].tolist()
        num_joints = len(joints)
        num_vertices = len(npz_data.get("pointcloud", npz_data.get("skinning_weights", [])))

        return jsonify({
            "joints": joints,
            "parents": parents,
            "joint_count": num_joints,
            "vertex_count": num_vertices,
            "message": f"Rigging complete. Generated {num_joints} joints.",
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def _run_inference(mesh_path: str, output_dir: str) -> str:
    """Run the RigAnything inference script"""
    script = str(RIGANYTHING_DIR / "scripts" / "inference.sh")
    cmd = ["bash", script, mesh_path, "1", "80000"]
    env = os.environ.copy()

    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=300,
        cwd=str(RIGANYTHING_DIR), env=env,
    )

    if result.returncode != 0:
        raise RuntimeError(f"RigAnything inference failed:\n{result.stderr[-1000:]}")

    basename = os.path.splitext(os.path.basename(mesh_path))[0]
    npz_candidates = [
        os.path.join(str(RIGANYTHING_DIR), "outputs", basename, f"{basename}_simplified.npz"),
        os.path.join(str(RIGANYTHING_DIR), "outputs", basename, f"{basename}.npz"),
    ]
    for npz_path in npz_candidates:
        if os.path.exists(npz_path):
            import shutil
            dest = os.path.join(output_dir, os.path.basename(npz_path))
            shutil.copy2(npz_path, dest)
            return dest

    raise FileNotFoundError(f"NPZ output not found. Searched: {npz_candidates}")


# ==========================================
# Weight Paint Data
# ==========================================

@app.route("/api/weights/<session_id>", methods=["GET"])
def get_weights(session_id):
    """Get skinning weights for a specific joint"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404

    sess = sessions[session_id]
    if sess["npz_data"] is None:
        return jsonify({"error": "Rigging not yet performed"}), 400

    joint_idx = request.args.get("joint", type=int, default=0)
    weights = sess["npz_data"]["skinning_weights"]
    if joint_idx < 0 or joint_idx >= weights.shape[1]:
        return jsonify({"error": "Invalid joint index"}), 400

    return jsonify({
        "joint": joint_idx,
        "weights": weights[:, joint_idx].tolist(),
    })


# ==========================================
# Export GLB
# ==========================================

@app.route("/api/export/<session_id>", methods=["POST"])
def export_glb(session_id):
    """Export rigged GLB with skeleton"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404

    sess = sessions[session_id]
    if sess["npz_data"] is None:
        return jsonify({"error": "Rigging not yet performed"}), 400

    output_path = os.path.join(sess["output_dir"], "rigged_output.glb")

    try:
        export_from_modified_data(sess["npz_data"], sess["mesh_path"], output_path)
        return jsonify({
            "download_url": f"/api/download/{session_id}/rigged_output.glb",
            "message": "GLB exported successfully.",
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ==========================================
# Download
# ==========================================

@app.route("/api/download/<session_id>/<filename>", methods=["GET"])
def download_file(session_id, filename):
    """Download exported file"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404

    filename = secure_filename(filename)
    file_path = os.path.join(sessions[session_id]["output_dir"], filename)
    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404
    return send_file(file_path, as_attachment=True)


# ==========================================
# Start
# ==========================================

if __name__ == "__main__":
    print(f"RigAnything Simple Server on port {SERVER_PORT}")
    print(f"Upload dir: {UPLOAD_DIR}")
    print(f"Output dir: {OUTPUT_DIR}")
    print(f"Examples: {RIGANYTHING_EXAMPLES}")
    app.run(host="0.0.0.0", port=SERVER_PORT, debug=True)
