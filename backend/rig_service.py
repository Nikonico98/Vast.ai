"""
RigAnything Service
====================
Proxy layer between RigAnythingTest frontend and GPU worker.
The Flask backend stores uploaded GLBs and forwards rig/export
requests to the GPU worker running RigAnything inference.
"""

import os
import uuid
import requests
from pathlib import Path
from typing import Optional
from job_manager import log
from config import TEMP_FOLDER
from gpu_client import _headers, _get_gpu_url_with_failover

# ==========================================
# Session storage: session_id -> file info
# ==========================================
_sessions = {}

RIG_UPLOAD_FOLDER = TEMP_FOLDER / "rig_uploads"
RIG_UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)

# Example models directory (optional)
RIG_EXAMPLES_FOLDER = TEMP_FOLDER / "rig_examples"
RIG_EXAMPLES_FOLDER.mkdir(parents=True, exist_ok=True)


def create_session(glb_path: str, original_name: str) -> dict:
    """Register a new rigging session."""
    session_id = uuid.uuid4().hex[:12]
    _sessions[session_id] = {
        "glb_path": glb_path,
        "original_name": original_name,
        "rigged": False,
        "remote_job_id": None,
        "rigged_glb_path": None,
    }
    log("RIG", f"Session {session_id} created: {original_name}")
    return {"session_id": session_id}


def get_session(session_id: str) -> Optional[dict]:
    return _sessions.get(session_id)


def upload_model(file_storage) -> dict:
    """
    Save uploaded GLB file and create a session.
    Returns: {"session_id": str, "mesh_url": str}
    """
    filename = file_storage.filename or "model.glb"
    session_id = uuid.uuid4().hex[:12]
    safe_name = f"{session_id}_{filename}"
    save_path = RIG_UPLOAD_FOLDER / safe_name
    file_storage.save(str(save_path))

    _sessions[session_id] = {
        "glb_path": str(save_path),
        "original_name": filename,
        "rigged": False,
        "remote_job_id": None,
        "rigged_glb_path": None,
    }
    log("RIG", f"Session {session_id}: uploaded {filename} ({save_path.stat().st_size:,} bytes)")
    return {
        "session_id": session_id,
        "mesh_url": f"/api/rig/mesh/{session_id}",
    }


def upload_example(example_filename: str) -> dict:
    """Load an example model from the examples folder."""
    example_path = RIG_EXAMPLES_FOLDER / example_filename
    if not example_path.exists():
        raise FileNotFoundError(f"Example not found: {example_filename}")

    session_id = uuid.uuid4().hex[:12]
    _sessions[session_id] = {
        "glb_path": str(example_path),
        "original_name": example_filename,
        "rigged": False,
        "remote_job_id": None,
        "rigged_glb_path": None,
    }
    log("RIG", f"Session {session_id}: loaded example {example_filename}")
    return {
        "session_id": session_id,
        "mesh_url": f"/api/rig/mesh/{session_id}",
    }


def list_examples() -> list:
    """List available example GLB files."""
    examples = []
    if RIG_EXAMPLES_FOLDER.exists():
        for f in sorted(RIG_EXAMPLES_FOLDER.glob("*.glb")):
            examples.append({
                "name": f.stem.replace("_", " ").title(),
                "filename": f.name,
            })
    return examples


def run_rig(session_id: str) -> dict:
    """
    Send GLB to GPU worker for RigAnything inference.
    Returns skeleton data: {"joints": [[x,y,z],...], "parents": [int,...]}
    """
    session = _sessions.get(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    gpu_url, backend = _get_gpu_url_with_failover()
    if not gpu_url:
        raise ConnectionError("No GPU worker available")

    glb_path = session["glb_path"]
    log("RIG", f"Session {session_id}: sending to GPU worker ({backend}) for rigging")

    with open(glb_path, "rb") as f:
        files = {"file": (os.path.basename(glb_path), f, "model/gltf-binary")}
        data = {"session_id": session_id}
        r = requests.post(
            f"{gpu_url}/api/rig/process",
            files=files,
            data=data,
            headers=_headers(),
            timeout=300,
        )

    if r.status_code != 200:
        raise RuntimeError(f"GPU worker error: HTTP {r.status_code} - {r.text[:200]}")

    result = r.json()
    if result.get("error"):
        raise RuntimeError(f"Rigging failed: {result['error']}")

    session["rigged"] = True
    session["remote_job_id"] = result.get("job_id", session_id)
    log("RIG", f"Session {session_id}: rigging complete, {len(result.get('joints', []))} joints")
    return result


def get_weights(session_id: str, joint_idx: int) -> dict:
    """Fetch weight paint data for a specific joint from GPU worker."""
    session = _sessions.get(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")
    if not session["rigged"]:
        raise ValueError("Model not rigged yet")

    gpu_url, backend = _get_gpu_url_with_failover()
    if not gpu_url:
        raise ConnectionError("No GPU worker available")

    r = requests.get(
        f"{gpu_url}/api/rig/weights/{session_id}",
        params={"joint": joint_idx},
        headers=_headers(),
        timeout=30,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Weight fetch failed: HTTP {r.status_code}")
    return r.json()


def export_rigged(session_id: str) -> dict:
    """
    Request GPU worker to export the rigged GLB.
    Downloads the result and returns local download URL.
    """
    session = _sessions.get(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")
    if not session["rigged"]:
        raise ValueError("Model not rigged yet")

    gpu_url, backend = _get_gpu_url_with_failover()
    if not gpu_url:
        raise ConnectionError("No GPU worker available")

    r = requests.post(
        f"{gpu_url}/api/rig/export/{session_id}",
        headers=_headers(),
        timeout=120,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Export failed: HTTP {r.status_code}")

    export_data = r.json()
    if export_data.get("error"):
        raise RuntimeError(f"Export error: {export_data['error']}")

    # Download the rigged GLB from GPU worker
    download_url = export_data.get("download_url")
    if download_url:
        output_path = RIG_UPLOAD_FOLDER / f"{session_id}_rigged.glb"
        r2 = requests.get(
            f"{gpu_url}{download_url}",
            headers=_headers(),
            timeout=120,
            stream=True,
        )
        if r2.status_code == 200:
            with open(output_path, "wb") as f:
                for chunk in r2.iter_content(chunk_size=8192):
                    f.write(chunk)
            session["rigged_glb_path"] = str(output_path)
            log("RIG", f"Session {session_id}: exported GLB ({output_path.stat().st_size:,} bytes)")
        else:
            raise RuntimeError(f"Download failed: HTTP {r2.status_code}")

    return {"download_url": f"/api/rig/download/{session_id}"}
