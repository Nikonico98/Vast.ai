"""
Imaginary World - Animation Service
=====================================
Generates keyframe animations for rigged GLB models using GPT.
Handles: skeleton analysis → GPT prompt → keyframe generation → GLB injection.

Usage:
    from animation_service import generate_animation
"""

import json
import math
import struct
import copy
from pathlib import Path
from typing import Dict, Optional

from config import AI_MODEL, AI_TEMPERATURE, OPENAI_API_KEY
from skeleton_parser import parse_glb_skeleton, skeleton_to_prompt_context

# ==========================================
# OpenAI Client (lazy init)
# ==========================================
_client = None


def _get_client():
    global _client
    if _client is None:
        import openai
        _client = openai.OpenAI(api_key=OPENAI_API_KEY)
    return _client


# ==========================================
# Animation System Prompt
# ==========================================
ANIMATION_SYSTEM_PROMPT = """You are a professional 3D animator. Given a rigged 3D model's bone hierarchy and an action description, generate keyframe animation data.

RULES:
1. Output ONLY valid JSON, no markdown fences, no explanation.
2. Use the exact bone names from the skeleton.
3. Rotations are in DEGREES (Euler XYZ). They will be converted to quaternions.
4. Translations are in local space (meters), relative to the bone's rest position.
5. Time is in seconds. Keep animations between 0.5 and 4 seconds.
6. Use enough keyframes for smooth motion (at least 3 per bone that moves).
7. Not every bone needs to move — only animate the bones relevant to the action.
8. Start at time 0 with the rest pose (rotation 0,0,0 and translation 0,0,0).
9. For models with generic bone names (Bone_0, Bone_1...), infer their purpose from their position in the hierarchy and spatial coordinates.

OUTPUT FORMAT:
{
  "duration": 2.0,
  "loop": false,
  "keyframes": {
    "BoneName": {
      "times": [0, 0.5, 1.0, 1.5, 2.0],
      "rotations": [[0,0,0], [10,0,0], [30,0,0], [10,0,0], [0,0,0]],
      "translations": [[0,0,0], [0,0.1,0], [0,0.2,0], [0,0.1,0], [0,0,0]]
    }
  }
}

EXAMPLES:

Action: "rotate 360 degrees"
→ Animate the root bone: rotations [[0,0,0],[0,90,0],[0,180,0],[0,270,0],[0,360,0]] over 2s

Action: "nod up and down"
→ Animate the top bone: rotations [[0,0,0],[-15,0,0],[15,0,0],[-15,0,0],[0,0,0]] over 1.5s

Action: "open like a book"
→ Animate cover/page bones outward: rotations from [0,0,0] to [0,-90,0] for left, [0,90,0] for right"""


def generate_animation(
    glb_path: str,
    prompt: str,
    item_name: str = "",
) -> Dict:
    """
    Generate animation for a rigged GLB model.

    Args:
        glb_path: Path to the rigged GLB file
        prompt: Action description (e.g. "turn the chair and lift the seat edge")
        item_name: Optional item name for context (e.g. "upholstered chair")

    Returns:
        dict with: success, animated_glb_path, skeleton_info, keyframe_data, prompt_sent, gpt_response, error
    """
    result = {
        "success": False,
        "animated_glb_path": None,
        "skeleton_info": None,
        "keyframe_data": None,
        "prompt_sent": None,
        "gpt_response": None,
        "error": None,
    }

    # Step 1: Parse skeleton
    skeleton = parse_glb_skeleton(glb_path)
    result["skeleton_info"] = {
        "has_skeleton": skeleton.get("has_skeleton"),
        "joint_count": skeleton.get("joint_count", 0),
        "hierarchy_text": skeleton.get("hierarchy_text", ""),
        "joints": skeleton.get("joints", []),
    }

    if not skeleton.get("has_skeleton"):
        result["error"] = f"Model has no skeleton: {skeleton.get('error', 'no skins found')}"
        return result

    # Step 2: Build GPT prompt
    skeleton_context = skeleton_to_prompt_context(skeleton)
    item_context = f"Object: {item_name}\n" if item_name else ""

    user_prompt = (
        f"{item_context}"
        f"{skeleton_context}\n\n"
        f"Action: \"{prompt}\"\n\n"
        f"Generate the keyframe animation JSON."
    )
    result["prompt_sent"] = user_prompt

    # Step 3: Call GPT
    try:
        client = _get_client()
        response = client.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": ANIMATION_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_completion_tokens=2000,
            temperature=0.7,
        )
        gpt_text = response.choices[0].message.content.strip()
        result["gpt_response"] = gpt_text
    except Exception as e:
        result["error"] = f"GPT call failed: {e}"
        return result

    # Step 4: Parse keyframe JSON
    try:
        # Strip markdown fences if GPT includes them
        cleaned = gpt_text
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        cleaned = cleaned.strip()

        keyframe_data = json.loads(cleaned)
        result["keyframe_data"] = keyframe_data
    except json.JSONDecodeError as e:
        result["error"] = f"Failed to parse GPT response as JSON: {e}\nResponse: {gpt_text[:500]}"
        return result

    # Step 5: Validate keyframes
    validation_error = _validate_keyframes(keyframe_data, skeleton)
    if validation_error:
        result["error"] = f"Keyframe validation failed: {validation_error}"
        return result

    # Step 6: Inject animation into GLB
    try:
        output_path = _get_output_path(glb_path)
        inject_animation(glb_path, keyframe_data, str(output_path))
        result["animated_glb_path"] = str(output_path)
        result["success"] = True
    except Exception as e:
        result["error"] = f"GLB injection failed: {e}"

    return result


def _get_output_path(glb_path: str) -> Path:
    """Generate output path for animated GLB."""
    p = Path(glb_path)
    return p.parent / f"{p.stem}_animated{p.suffix}"


def _validate_keyframes(keyframe_data: dict, skeleton: dict) -> Optional[str]:
    """Validate keyframe data structure. Returns error message or None."""
    if not isinstance(keyframe_data, dict):
        return "Keyframe data must be a dict"

    if "keyframes" not in keyframe_data:
        return "Missing 'keyframes' key"

    if "duration" not in keyframe_data:
        return "Missing 'duration' key"

    duration = keyframe_data["duration"]
    if not isinstance(duration, (int, float)) or duration <= 0 or duration > 30:
        return f"Invalid duration: {duration} (must be 0-30s)"

    bone_names = {j["name"] for j in skeleton.get("joints", [])}
    keyframes = keyframe_data["keyframes"]

    if not isinstance(keyframes, dict):
        return "keyframes must be a dict mapping bone names to animation data"

    for bone_name, data in keyframes.items():
        if bone_name not in bone_names:
            return f"Unknown bone name: '{bone_name}'. Valid: {sorted(bone_names)}"

        if "times" not in data:
            return f"Bone '{bone_name}' missing 'times'"

        times = data["times"]
        if not times or len(times) < 2:
            return f"Bone '{bone_name}' needs at least 2 time values"

        # Check rotations or translations exist
        has_rotations = "rotations" in data
        has_translations = "translations" in data
        if not has_rotations and not has_translations:
            return f"Bone '{bone_name}' has no rotations or translations"

        if has_rotations and len(data["rotations"]) != len(times):
            return f"Bone '{bone_name}' rotations count ({len(data['rotations'])}) != times count ({len(times)})"

        if has_translations and len(data["translations"]) != len(times):
            return f"Bone '{bone_name}' translations count ({len(data['translations'])}) != times count ({len(times)})"

    return None


# ==========================================
# GLB Animation Injection
# ==========================================

def _euler_to_quaternion(x_deg, y_deg, z_deg):
    """Convert Euler angles (degrees, XYZ order) to quaternion [x, y, z, w]."""
    x = math.radians(x_deg) / 2
    y = math.radians(y_deg) / 2
    z = math.radians(z_deg) / 2

    cx, sx = math.cos(x), math.sin(x)
    cy, sy = math.cos(y), math.sin(y)
    cz, sz = math.cos(z), math.sin(z)

    # XYZ rotation order
    qx = sx * cy * cz + cx * sy * sz
    qy = cx * sy * cz - sx * cy * sz
    qz = cx * cy * sz + sx * sy * cz
    qw = cx * cy * cz - sx * sy * sz
    return [qx, qy, qz, qw]


def _quat_multiply(a, b):
    """Multiply two quaternions [x, y, z, w]."""
    return [
        a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
        a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
        a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
        a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
    ]


def inject_animation(input_glb: str, keyframe_data: dict, output_glb: str):
    """
    Inject keyframe animation into a rigged GLB file.

    Reads the GLB binary, modifies the glTF JSON to add animation
    accessors/samplers/channels, appends float data to the binary buffer,
    and writes a new GLB.
    """
    with open(input_glb, "rb") as f:
        header = f.read(12)
        magic, version, total_length = struct.unpack("<4sII", header)

        # JSON chunk
        json_chunk_len = struct.unpack("<I", f.read(4))[0]
        json_chunk_type = struct.unpack("<I", f.read(4))[0]
        json_data = f.read(json_chunk_len)
        gltf = json.loads(json_data)

        # Binary chunk
        bin_chunk_len = struct.unpack("<I", f.read(4))[0]
        bin_chunk_type = struct.unpack("<I", f.read(4))[0]
        bin_data = bytearray(f.read(bin_chunk_len))

    nodes = gltf.get("nodes", [])
    skins = gltf.get("skins", [])

    if not skins:
        raise ValueError("No skins in GLB — cannot inject bone animation")

    skin = skins[0]
    joint_indices = skin.get("joints", [])

    # Build node name → index map
    name_to_node = {}
    for ji in joint_indices:
        name = nodes[ji].get("name", f"Bone_{ji}")
        name_to_node[name] = ji

    # Get initial rotations for composing delta
    initial_rotations = {}
    for ji in joint_indices:
        node = nodes[ji]
        name = node.get("name", f"Bone_{ji}")
        initial_rotations[name] = node.get("rotation", [0, 0, 0, 1])

    # Prepare animation data
    duration = keyframe_data["duration"]
    keyframes = keyframe_data["keyframes"]
    loop = keyframe_data.get("loop", False)

    # Ensure buffers/accessors/bufferViews exist
    if "accessors" not in gltf:
        gltf["accessors"] = []
    if "bufferViews" not in gltf:
        gltf["bufferViews"] = []
    if "animations" not in gltf:
        gltf["animations"] = []

    buffer_idx = 0  # First buffer
    samplers = []
    channels = []

    for bone_name, data in keyframes.items():
        node_idx = name_to_node.get(bone_name)
        if node_idx is None:
            continue

        times = data["times"]
        has_rotations = "rotations" in data
        has_translations = "translations" in data

        # --- Time accessor (shared per bone) ---
        time_floats = struct.pack(f"<{len(times)}f", *times)
        time_offset = len(bin_data)
        # Pad to 4-byte boundary
        while len(bin_data) % 4 != 0:
            bin_data.append(0)
        time_offset = len(bin_data)
        bin_data.extend(time_floats)

        time_bv_idx = len(gltf["bufferViews"])
        gltf["bufferViews"].append({
            "buffer": buffer_idx,
            "byteOffset": time_offset,
            "byteLength": len(time_floats),
        })

        time_acc_idx = len(gltf["accessors"])
        gltf["accessors"].append({
            "bufferView": time_bv_idx,
            "componentType": 5126,  # FLOAT
            "count": len(times),
            "type": "SCALAR",
            "min": [min(times)],
            "max": [max(times)],
        })

        # --- Rotation data ---
        if has_rotations:
            rot_quats = []
            init_rot = initial_rotations.get(bone_name, [0, 0, 0, 1])
            for euler in data["rotations"]:
                delta_q = _euler_to_quaternion(euler[0], euler[1], euler[2])
                # Compose: initial * delta
                final_q = _quat_multiply(init_rot, delta_q)
                rot_quats.extend(final_q)

            rot_bytes = struct.pack(f"<{len(rot_quats)}f", *rot_quats)
            while len(bin_data) % 4 != 0:
                bin_data.append(0)
            rot_offset = len(bin_data)
            bin_data.extend(rot_bytes)

            rot_bv_idx = len(gltf["bufferViews"])
            gltf["bufferViews"].append({
                "buffer": buffer_idx,
                "byteOffset": rot_offset,
                "byteLength": len(rot_bytes),
            })

            rot_acc_idx = len(gltf["accessors"])
            gltf["accessors"].append({
                "bufferView": rot_bv_idx,
                "componentType": 5126,
                "count": len(data["rotations"]),
                "type": "VEC4",
            })

            sampler_idx = len(samplers)
            samplers.append({
                "input": time_acc_idx,
                "output": rot_acc_idx,
                "interpolation": "LINEAR",
            })
            channels.append({
                "sampler": sampler_idx,
                "target": {"node": node_idx, "path": "rotation"},
            })

        # --- Translation data ---
        if has_translations:
            trans_flat = []
            for t in data["translations"]:
                trans_flat.extend(t)

            trans_bytes = struct.pack(f"<{len(trans_flat)}f", *trans_flat)
            while len(bin_data) % 4 != 0:
                bin_data.append(0)
            trans_offset = len(bin_data)
            bin_data.extend(trans_bytes)

            trans_bv_idx = len(gltf["bufferViews"])
            gltf["bufferViews"].append({
                "buffer": buffer_idx,
                "byteOffset": trans_offset,
                "byteLength": len(trans_bytes),
            })

            trans_acc_idx = len(gltf["accessors"])
            gltf["accessors"].append({
                "bufferView": trans_bv_idx,
                "componentType": 5126,
                "count": len(data["translations"]),
                "type": "VEC3",
            })

            sampler_idx = len(samplers)
            samplers.append({
                "input": time_acc_idx,
                "output": trans_acc_idx,
                "interpolation": "LINEAR",
            })
            channels.append({
                "sampler": sampler_idx,
                "target": {"node": node_idx, "path": "translation"},
            })

    if not channels:
        raise ValueError("No valid animation channels generated")

    # Add animation to glTF
    gltf["animations"].append({
        "name": "generated_animation",
        "samplers": samplers,
        "channels": channels,
    })

    # Update buffer byte length
    gltf["buffers"][0]["byteLength"] = len(bin_data)

    # Write output GLB
    _write_glb(gltf, bin_data, output_glb)


def _write_glb(gltf: dict, bin_data: bytearray, output_path: str):
    """Write a glTF JSON + binary buffer to a GLB file."""
    json_str = json.dumps(gltf, separators=(",", ":"))
    json_bytes = json_str.encode("utf-8")
    # Pad JSON to 4-byte boundary with spaces
    while len(json_bytes) % 4 != 0:
        json_bytes += b" "
    # Pad binary to 4-byte boundary with zeros
    while len(bin_data) % 4 != 0:
        bin_data.append(0)

    total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_data)

    with open(output_path, "wb") as f:
        # GLB header
        f.write(struct.pack("<4sII", b"glTF", 2, total_length))
        # JSON chunk
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        # Binary chunk
        f.write(struct.pack("<II", len(bin_data), 0x004E4942))
        f.write(bytes(bin_data))

    return output_path
