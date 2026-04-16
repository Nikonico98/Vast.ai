"""
Imaginary World - GLB Skeleton Parser
=======================================
Extracts skeleton/rig information from RigAnything-rigged GLB files.
Used by animation_service to build GPT prompts.

Usage:
    from skeleton_parser import parse_glb_skeleton
"""

import json
import struct
from pathlib import Path


def parse_glb_skeleton(glb_path: str) -> dict:
    """
    Parse a GLB file and extract skeleton information.

    Returns dict with:
        has_skeleton: bool
        joint_count: int
        joints: list of {index, name, parent, translation, rotation, scale, children}
        hierarchy_text: str (indented tree for GPT prompt)
        raw_gltf: the full glTF JSON (for debugging)
    """
    glb_path = Path(glb_path)
    if not glb_path.exists():
        return {"has_skeleton": False, "error": f"File not found: {glb_path}"}

    try:
        with open(glb_path, "rb") as f:
            # Read GLB header
            magic, version, length = struct.unpack("<4sII", f.read(12))
            if magic != b"glTF":
                return {"has_skeleton": False, "error": "Not a valid GLB file"}

            # Read JSON chunk
            chunk_length = struct.unpack("<I", f.read(4))[0]
            chunk_type = struct.unpack("<I", f.read(4))[0]
            gltf_json = json.loads(f.read(chunk_length))

        nodes = gltf_json.get("nodes", [])
        skins = gltf_json.get("skins", [])

        if not skins:
            return {
                "has_skeleton": False,
                "joint_count": 0,
                "joints": [],
                "hierarchy_text": "(no skeleton found)",
                "raw_gltf": gltf_json,
            }

        # Use first skin
        skin = skins[0]
        joint_indices = skin.get("joints", [])
        root_joint = skin.get("skeleton", joint_indices[0] if joint_indices else None)

        # Build parent map
        parent_map = {}
        for ni, node in enumerate(nodes):
            for child_idx in node.get("children", []):
                parent_map[child_idx] = ni

        # Extract joint info
        joints = []
        for ji in joint_indices:
            node = nodes[ji]
            parent_idx = parent_map.get(ji)
            parent_name = None
            if parent_idx is not None and parent_idx in joint_indices:
                parent_name = nodes[parent_idx].get("name", f"node_{parent_idx}")

            joints.append({
                "index": ji,
                "name": node.get("name", f"Bone_{ji}"),
                "parent": parent_name,
                "translation": node.get("translation", [0, 0, 0]),
                "rotation": node.get("rotation", [0, 0, 0, 1]),
                "scale": node.get("scale", [1, 1, 1]),
                "children": [
                    nodes[c].get("name", f"node_{c}")
                    for c in node.get("children", [])
                    if c in joint_indices
                ],
            })

        # Build hierarchy text (indented tree for GPT)
        hierarchy_text = _build_hierarchy_text(joints, root_joint, nodes, joint_indices)

        return {
            "has_skeleton": True,
            "joint_count": len(joint_indices),
            "joints": joints,
            "hierarchy_text": hierarchy_text,
            "root_joint": nodes[root_joint].get("name", f"node_{root_joint}") if root_joint is not None else None,
            "raw_gltf": gltf_json,
        }

    except Exception as e:
        return {"has_skeleton": False, "error": str(e)}


def _build_hierarchy_text(joints, root_joint, nodes, joint_indices):
    """Build indented tree text showing bone hierarchy."""
    joint_set = set(j["index"] for j in joints)
    joint_by_idx = {j["index"]: j for j in joints}

    # Find children for each joint
    children_map = {}
    for j in joints:
        children_map[j["index"]] = [
            jj["index"] for jj in joints
            if jj["parent"] == j["name"]
        ]

    lines = []

    def _walk(idx, depth=0):
        j = joint_by_idx.get(idx)
        if j is None:
            return
        t = j["translation"]
        r = j["rotation"]
        pos_str = f"pos({t[0]:.3f}, {t[1]:.3f}, {t[2]:.3f})"
        rot_str = f"rot({r[0]:.3f}, {r[1]:.3f}, {r[2]:.3f}, {r[3]:.3f})"
        prefix = "  " * depth
        lines.append(f"{prefix}{j['name']}  {pos_str}  {rot_str}")
        for child_idx in children_map.get(idx, []):
            _walk(child_idx, depth + 1)

    # Start from root
    if root_joint is not None and root_joint in joint_set:
        _walk(root_joint)
    else:
        # No clear root, walk all joints that have no parent
        for j in joints:
            if j["parent"] is None:
                _walk(j["index"])

    return "\n".join(lines) if lines else "(could not build hierarchy)"


def skeleton_to_prompt_context(skeleton_info: dict) -> str:
    """Format skeleton info for inclusion in a GPT prompt."""
    if not skeleton_info.get("has_skeleton"):
        return "This model has NO skeleton/rig. Only root-level transform animations are possible."

    return (
        f"Skeleton: {skeleton_info['joint_count']} joints\n"
        f"Root: {skeleton_info.get('root_joint', 'unknown')}\n"
        f"Bone hierarchy (name, local position, local rotation quaternion):\n"
        f"{skeleton_info['hierarchy_text']}"
    )
