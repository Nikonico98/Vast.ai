"""
export_glb.py — 將修改後的 NPZ rig data + 原始 mesh GLB 匯出為帶骨骼的 rigged GLB。
使用 Blender bpy 模組，必須透過 Blender Python 環境執行。
"""

import os
import sys
import subprocess
import tempfile
import numpy as np

# Blender python wrapper script path
BLENDER_EXPORT_SCRIPT = os.path.join(os.path.dirname(__file__), "_blender_export.py")


def export_rigged_glb(npz_path: str, mesh_glb_path: str, output_glb_path: str) -> str:
    """
    呼叫 Blender 後台執行，將 NPZ + mesh GLB 合併匯出為 rigged GLB。

    Args:
        npz_path: 修改後的 NPZ 檔案路徑（含 joints, parents, skinning_weights）
        mesh_glb_path: 原始 mesh GLB 檔案路徑
        output_glb_path: 輸出的 rigged GLB 路徑

    Returns:
        output_glb_path if success
    """
    # Find blender executable
    blender_bin = _find_blender()

    # Get site-packages path for current env
    import site
    site_packages = site.getsitepackages()[0]

    project_root = os.path.dirname(os.path.abspath(__file__))

    cmd = [
        blender_bin, "--background", "--python-expr",
        f"""
import sys, os
sys.path.insert(0, '/usr/lib/python3.12/lib-dynload')
sys.path.append('{site_packages}')
sys.path.insert(0, '{project_root}')
sys.argv = sys.argv[sys.argv.index('--')+1:]
exec(open(sys.argv[0]).read())
""",
        "--",
        BLENDER_EXPORT_SCRIPT,
        "--npz_path", npz_path,
        "--mesh_path", mesh_glb_path,
        "--output_path", output_glb_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"Blender export failed:\n{result.stderr[-2000:]}")

    if not os.path.exists(output_glb_path):
        raise RuntimeError(f"Export completed but output file not found: {output_glb_path}")

    return output_glb_path


def _find_blender() -> str:
    """找到 Blender 執行檔"""
    import shutil
    blender = shutil.which("blender")
    if blender:
        return blender
    # Common paths
    for path in ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender"]:
        if os.path.exists(path):
            return path
    raise FileNotFoundError("Blender not found. Please install Blender or add it to PATH.")


def export_from_modified_data(rig_data: dict, mesh_glb_path: str, output_glb_path: str) -> str:
    """
    從記憶體中的 rig_data dict 匯出 rigged GLB。
    先存為臨時 NPZ，再呼叫 Blender 匯出。

    Args:
        rig_data: dict with joints, parents, skinning_weights, pointcloud, mesh_list
        mesh_glb_path: 原始 mesh GLB 路徑
        output_glb_path: 輸出路徑

    Returns:
        output_glb_path
    """
    with tempfile.NamedTemporaryFile(suffix=".npz", delete=False) as f:
        tmp_npz = f.name
        np.savez(f, **rig_data)

    try:
        return export_rigged_glb(tmp_npz, mesh_glb_path, output_glb_path)
    finally:
        os.unlink(tmp_npz)
