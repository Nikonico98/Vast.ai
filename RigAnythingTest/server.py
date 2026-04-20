"""
server.py — Flask 後端伺服器
提供 API 端點：上傳 GLB、執行 RigAnything 推論、ChatGPT 對話、骨骼預覽、GLB 下載。
"""

import os
import json
import uuid
import time
import subprocess
import traceback

import numpy as np
from flask import Flask, request, jsonify, send_file, send_from_directory
from werkzeug.utils import secure_filename

from config import (
    BASE_DIR, UPLOAD_DIR, OUTPUT_DIR, SERVER_PORT,
    RIGANYTHING_DIR, RIGANYTHING_EXAMPLES,
)
from rig_postprocess import load_npz, save_npz, get_skeleton_info, apply_instructions
from rig_advisor import RigAdvisor
from export_glb import export_from_modified_data

app = Flask(__name__, static_folder="static", static_url_path="/static")

# State
sessions = {}  # session_id -> { npz_data, mesh_path, npz_path, output_dir, history }

try:
    advisor = RigAdvisor()
except ValueError:
    advisor = None
    print("WARNING: OPENAI_API_KEY not set. Chat features disabled.")

ALLOWED_EXTENSIONS = {"glb", "gltf", "obj", "fbx"}


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# ==========================================
# Static files
# ==========================================

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# ==========================================
# Examples
# ==========================================

@app.route("/api/examples", methods=["GET"])
def list_examples():
    """列出 RigAnything 內建範例模型"""
    examples = []
    if RIGANYTHING_EXAMPLES.exists():
        for f in sorted(RIGANYTHING_EXAMPLES.iterdir()):
            if f.suffix.lower() in (".glb", ".gltf", ".obj"):
                examples.append({"name": f.stem, "filename": f.name})
    return jsonify(examples)


# ==========================================
# Upload & Inference
# ==========================================

@app.route("/api/upload", methods=["POST"])
def upload_mesh():
    """上傳 GLB 並執行 RigAnything 推論"""
    # Check for example selection
    example_name = request.form.get("example")
    if example_name:
        mesh_path = str(RIGANYTHING_EXAMPLES / example_name)
        if not os.path.exists(mesh_path):
            return jsonify({"error": f"Example not found: {example_name}"}), 404
    elif "file" in request.files:
        file = request.files["file"]
        if not file or not allowed_file(file.filename):
            return jsonify({"error": "Invalid file type"}), 400
        filename = secure_filename(file.filename)
        mesh_path = str(UPLOAD_DIR / filename)
        file.save(mesh_path)
    else:
        return jsonify({"error": "No file or example provided"}), 400

    session_id = str(uuid.uuid4())[:8]
    session_dir = OUTPUT_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Run RigAnything inference
        npz_path = _run_inference(mesh_path, str(session_dir))

        # Load results
        npz_data = load_npz(npz_path)
        skeleton_info = get_skeleton_info(npz_data)

        sessions[session_id] = {
            "npz_data": npz_data,
            "npz_original": {k: v.copy() if isinstance(v, np.ndarray) else v for k, v in npz_data.items()},
            "mesh_path": mesh_path,
            "npz_path": npz_path,
            "output_dir": str(session_dir),
            "history": [],
        }

        # Start ChatGPT session
        if advisor:
            advisor.start_session(session_id, npz_data)

        return jsonify({
            "session_id": session_id,
            "skeleton": skeleton_info,
            "mesh_url": f"/api/mesh/{session_id}/original",
            "message": f"RigAnything 推論完成，生成 {skeleton_info['num_joints']} 個關節。",
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def _run_inference(mesh_path: str, output_dir: str) -> str:
    """執行 RigAnything 推論腳本"""
    script = str(RIGANYTHING_DIR / "scripts" / "inference.sh")
    cmd = ["bash", script, mesh_path, "1", "80000"]
    env = os.environ.copy()

    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=300,
        cwd=str(RIGANYTHING_DIR), env=env,
    )

    if result.returncode != 0:
        raise RuntimeError(f"RigAnything inference failed:\n{result.stderr[-1000:]}")

    # Find output NPZ
    basename = os.path.splitext(os.path.basename(mesh_path))[0]
    npz_candidates = [
        os.path.join(str(RIGANYTHING_DIR), "outputs", basename, f"{basename}_simplified.npz"),
        os.path.join(str(RIGANYTHING_DIR), "outputs", basename, f"{basename}.npz"),
    ]
    for npz_path in npz_candidates:
        if os.path.exists(npz_path):
            # Copy to session dir
            import shutil
            dest = os.path.join(output_dir, os.path.basename(npz_path))
            shutil.copy2(npz_path, dest)
            return dest

    raise FileNotFoundError(f"NPZ output not found. Searched: {npz_candidates}")


# ==========================================
# Skeleton Data
# ==========================================

@app.route("/api/skeleton/<session_id>", methods=["GET"])
def get_skeleton(session_id):
    """取得目前骨骼結構"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404
    npz_data = sessions[session_id]["npz_data"]
    skeleton_info = get_skeleton_info(npz_data)
    return jsonify(skeleton_info)


@app.route("/api/skeleton/<session_id>/joints", methods=["GET"])
def get_joints_data(session_id):
    """取得關節座標和父節點（供 Three.js 繪製）"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404
    npz_data = sessions[session_id]["npz_data"]
    joints = npz_data["joints"][..., :3].tolist()
    parents = npz_data["parents"].tolist()
    return jsonify({"joints": joints, "parents": parents})


@app.route("/api/skeleton/<session_id>/weights", methods=["GET"])
def get_weights_preview(session_id):
    """取得指定關節的 skinning weight（供頂點著色預覽）"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404
    joint_idx = request.args.get("joint", type=int, default=0)
    npz_data = sessions[session_id]["npz_data"]
    weights = npz_data["skinning_weights"]
    if joint_idx < 0 or joint_idx >= weights.shape[1]:
        return jsonify({"error": "Invalid joint index"}), 400
    return jsonify({"joint": joint_idx, "weights": weights[:, joint_idx].tolist()})


# ==========================================
# Chat (ChatGPT Integration)
# ==========================================

@app.route("/api/chat/<session_id>", methods=["POST"])
def chat(session_id):
    """與 ChatGPT 對話，取得骨骼調整建議"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404
    if not advisor:
        return jsonify({"error": "ChatGPT not available (OPENAI_API_KEY not set)"}), 503

    data = request.get_json()
    user_message = data.get("message", "").strip()
    auto_apply = data.get("auto_apply", False)

    if not user_message:
        return jsonify({"error": "Empty message"}), 400

    try:
        result = advisor.chat(session_id, user_message)
        sessions[session_id]["history"].append({
            "role": "user", "content": user_message, "time": time.time()
        })
        sessions[session_id]["history"].append({
            "role": "assistant", "content": result["message"], "time": time.time()
        })

        response = {
            "message": result["message"],
            "instructions": result["instructions"],
            "applied": False,
        }

        # Auto-apply if requested and instructions available
        if auto_apply and result["instructions"]:
            npz_data = sessions[session_id]["npz_data"]
            mesh_path = sessions[session_id]["mesh_path"]
            try:
                import trimesh
                mesh = trimesh.load(mesh_path, force="mesh")
            except Exception:
                mesh = None
            apply_instructions(npz_data, result["instructions"], mesh)
            advisor.update_model_info(session_id, npz_data)
            response["applied"] = True
            response["skeleton"] = get_skeleton_info(npz_data)

        return jsonify(response)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/chat/<session_id>/auto-analyze", methods=["POST"])
def auto_analyze(session_id):
    """一鍵自動分析骨骼結構"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404
    if not advisor:
        return jsonify({"error": "ChatGPT not available"}), 503

    try:
        npz_data = sessions[session_id]["npz_data"]
        result = advisor.analyze_auto(npz_data)
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ==========================================
# Apply Instructions
# ==========================================

@app.route("/api/apply/<session_id>", methods=["POST"])
def apply_changes(session_id):
    """手動套用調整指令"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404

    instructions = request.get_json()
    if not instructions:
        return jsonify({"error": "No instructions provided"}), 400

    npz_data = sessions[session_id]["npz_data"]
    mesh_path = sessions[session_id]["mesh_path"]

    try:
        import trimesh
        mesh = trimesh.load(mesh_path, force="mesh")
    except Exception:
        mesh = None

    try:
        apply_instructions(npz_data, instructions, mesh)
        if advisor:
            advisor.update_model_info(session_id, npz_data)
        skeleton_info = get_skeleton_info(npz_data)
        return jsonify({"skeleton": skeleton_info, "message": "調整已套用。"})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/reset/<session_id>", methods=["POST"])
def reset_skeleton(session_id):
    """重置為原始骨骼"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404

    original = sessions[session_id]["npz_original"]
    sessions[session_id]["npz_data"] = {
        k: v.copy() if isinstance(v, np.ndarray) else v for k, v in original.items()
    }
    npz_data = sessions[session_id]["npz_data"]
    if advisor:
        advisor.update_model_info(session_id, npz_data)
    skeleton_info = get_skeleton_info(npz_data)
    return jsonify({"skeleton": skeleton_info, "message": "已重置為原始骨骼。"})


# ==========================================
# Export / Download
# ==========================================

@app.route("/api/export/<session_id>", methods=["POST"])
def export_glb(session_id):
    """匯出修改後的 rigged GLB"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404

    sess = sessions[session_id]
    output_path = os.path.join(sess["output_dir"], "rigged_output.glb")

    try:
        export_from_modified_data(sess["npz_data"], sess["mesh_path"], output_path)
        return jsonify({
            "download_url": f"/api/download/{session_id}/rigged_output.glb",
            "message": "GLB 匯出成功。",
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/download/<session_id>/<filename>", methods=["GET"])
def download_file(session_id, filename):
    """下載檔案"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404

    # Validate filename to prevent path traversal
    filename = secure_filename(filename)
    file_path = os.path.join(sessions[session_id]["output_dir"], filename)
    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404
    return send_file(file_path, as_attachment=True)


@app.route("/api/mesh/<session_id>/original", methods=["GET"])
def get_original_mesh(session_id):
    """取得原始 mesh GLB"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404
    mesh_path = sessions[session_id]["mesh_path"]
    if not os.path.exists(mesh_path):
        return jsonify({"error": "Mesh file not found"}), 404
    return send_file(mesh_path, mimetype="model/gltf-binary")


# ==========================================
# Save/Load NPZ
# ==========================================

@app.route("/api/save-npz/<session_id>", methods=["POST"])
def save_session_npz(session_id):
    """儲存修改後的 NPZ"""
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404

    output_path = os.path.join(sessions[session_id]["output_dir"], "modified.npz")
    save_npz(output_path, sessions[session_id]["npz_data"])
    return jsonify({
        "download_url": f"/api/download/{session_id}/modified.npz",
        "message": "NPZ 已儲存。",
    })


if __name__ == "__main__":
    print(f"RigAnything Test Server starting on port {SERVER_PORT}")
    print(f"Upload dir: {UPLOAD_DIR}")
    print(f"Output dir: {OUTPUT_DIR}")
    print(f"Examples dir: {RIGANYTHING_EXAMPLES}")
    print(f"ChatGPT: {'enabled' if advisor else 'disabled'}")
    app.run(host="0.0.0.0", port=SERVER_PORT, debug=True)
