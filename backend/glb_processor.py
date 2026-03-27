"""
Imaginary World - GLB Model Post-Processing
=============================================
Functions for processing GLB (3D model) files:
- Recentering origin for AR placement
- Adding default PBR material for proper lighting/reflections
- Creating placeholder GLB files

Usage:
    from glb_processor import recenter_glb_origin_to_bottom, add_default_pbr_material, create_placeholder_glb
"""

import json
import struct
import numpy as np


def recenter_glb_origin_to_bottom(glb_path: str, job_id: str = "GLB") -> bool:
    """
    Adjust GLB model origin to bottom center for proper AR placement.
    
    Problem: SAM3D generates models with origin at geometric center,
             causing models to appear "floating" or "sunk" in AR.
    
    Solution: Move all vertices so that:
              - X/Z: centered (origin at horizontal center)
              - Y: origin at the bottom of the model
    
    Args:
        glb_path: Path to the GLB file to modify
        job_id: Job ID for logging
    
    Returns:
        True if successful, False otherwise
    """
    try:
        import trimesh
        
        # Load the GLB file
        scene = trimesh.load(glb_path)
        
        # Handle both single mesh and scene with multiple meshes
        if isinstance(scene, trimesh.Scene):
            # Get all meshes from the scene
            meshes = list(scene.geometry.values())
            if not meshes:
                print(f"[{job_id}] ⚠️ No meshes found in GLB")
                return False
            
            # Calculate combined bounding box
            all_bounds = []
            for mesh in meshes:
                if hasattr(mesh, 'bounds') and mesh.bounds is not None:
                    all_bounds.append(mesh.bounds)
            
            if not all_bounds:
                print(f"[{job_id}] ⚠️ No valid bounds found")
                return False
            
            # Find overall min/max
            all_bounds = np.array(all_bounds)
            min_bound = all_bounds[:, 0, :].min(axis=0)
            max_bound = all_bounds[:, 1, :].max(axis=0)
            
            # Calculate offset: center X/Z, move Y to bottom
            offset = np.array([
                -(min_bound[0] + max_bound[0]) / 2,  # X: center
                -min_bound[1],                        # Y: bottom to zero
                -(min_bound[2] + max_bound[2]) / 2   # Z: center
            ])
            
            # Apply offset to all meshes
            for name, mesh in scene.geometry.items():
                if hasattr(mesh, 'apply_translation'):
                    mesh.apply_translation(offset)
            
            # Export back to GLB
            scene.export(glb_path)
            
        else:
            # Single mesh
            mesh = scene
            
            if not hasattr(mesh, 'bounds') or mesh.bounds is None:
                print(f"[{job_id}] ⚠️ Mesh has no bounds")
                return False
            
            bounds = mesh.bounds
            
            # Calculate offset: center X/Z, move Y to bottom
            offset = np.array([
                -(bounds[0][0] + bounds[1][0]) / 2,  # X: center
                -bounds[0][1],                        # Y: bottom to zero
                -(bounds[0][2] + bounds[1][2]) / 2   # Z: center
            ])
            
            # Apply offset
            mesh.apply_translation(offset)
            
            # Export back to GLB
            mesh.export(glb_path)
        
        print(f"[{job_id}] ✅ Origin recentered to bottom (offset: {offset})")
        return True
        
    except ImportError:
        print(f"[{job_id}] ⚠️ trimesh not installed, skipping origin adjustment")
        print(f"[{job_id}] 💡 Install with: pip install trimesh")
        return False
    except Exception as e:
        print(f"[{job_id}] ❌ Origin adjustment failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def add_default_pbr_material(glb_path: str, job_id: str = "GLB",
                             metalness: float = 0.1, roughness: float = 0.8) -> bool:
    """
    Add a default PBR material to a GLB that has no materials.

    SAM3D outputs meshes with only POSITION + COLOR_0 (vertex colors)
    and zero materials. Without a material, Three.js/A-Frame falls back
    to MeshBasicMaterial which ignores all lighting, shadows, and reflections.

    This function injects a minimal pbrMetallicRoughness material so the
    model responds to scene lighting and environment reflections.

    Args:
        glb_path: Path to the GLB file to modify (in-place)
        job_id: Job ID for logging
        metalness: PBR metallic factor (0=dielectric, 1=metal). Default 0.1
        roughness: PBR roughness factor (0=mirror, 1=matte). Default 0.8

    Returns:
        True if material was added, False if skipped or failed
    """
    try:
        with open(glb_path, 'rb') as f:
            # GLB header: magic(4) + version(4) + totalLength(4)
            header = f.read(12)
            if len(header) < 12:
                print(f"[{job_id}] ⚠️ GLB too small, skipping PBR")
                return False
            magic, version, total_len = struct.unpack('<III', header)
            if magic != 0x46546C67:  # 'glTF'
                print(f"[{job_id}] ⚠️ Not a valid GLB file")
                return False

            # Chunk 0: JSON
            chunk0_header = f.read(8)
            json_len, chunk_type = struct.unpack('<II', chunk0_header)
            if chunk_type != 0x4E4F534A:  # 'JSON'
                print(f"[{job_id}] ⚠️ First chunk is not JSON")
                return False
            json_bytes = f.read(json_len)

            # Remaining data (binary chunk)
            rest = f.read()

        gltf = json.loads(json_bytes.decode('utf-8'))

        # Check if materials already exist
        materials = gltf.get('materials', [])
        if materials:
            print(f"[{job_id}] ℹ️ GLB already has {len(materials)} material(s), skipping PBR injection")
            return False

        # Add PBR material
        gltf['materials'] = [{
            'pbrMetallicRoughness': {
                'baseColorFactor': [1.0, 1.0, 1.0, 1.0],
                'metallicFactor': metalness,
                'roughnessFactor': roughness,
            },
            'doubleSided': True,
        }]

        # Assign material index 0 to all primitives that lack one
        assigned = 0
        for mesh in gltf.get('meshes', []):
            for prim in mesh.get('primitives', []):
                if 'material' not in prim:
                    prim['material'] = 0
                    assigned += 1

        # Re-encode JSON chunk (must be 4-byte aligned, padded with spaces)
        new_json = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
        while len(new_json) % 4 != 0:
            new_json += b' '

        # Rebuild GLB
        new_total = 12 + 8 + len(new_json) + len(rest)
        with open(glb_path, 'wb') as f:
            f.write(struct.pack('<III', magic, version, new_total))
            f.write(struct.pack('<II', len(new_json), 0x4E4F534A))
            f.write(new_json)
            f.write(rest)

        print(f"[{job_id}] ✅ PBR material added (metalness={metalness}, roughness={roughness}, {assigned} primitive(s) assigned)")
        return True

    except Exception as e:
        print(f"[{job_id}] ❌ PBR material injection failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def create_placeholder_glb(filepath: str):
    """Create a minimal placeholder GLB file (a simple cube)."""
    glb_magic = 0x46546C67
    glb_version = 2
    
    json_content = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 8, "type": "VEC3",
             "max": [1, 1, 1], "min": [-1, -1, -1]},
            {"bufferView": 1, "componentType": 5123, "count": 36, "type": "SCALAR"}
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": 96},
            {"buffer": 0, "byteOffset": 96, "byteLength": 72}
        ],
        "buffers": [{"byteLength": 168}]
    }
    
    json_str = json.dumps(json_content)
    json_bytes = json_str.encode('utf-8')
    while len(json_bytes) % 4 != 0:
        json_bytes += b' '
    
    vertices = [
        -1, -1, -1,  1, -1, -1,  1,  1, -1, -1,  1, -1,
        -1, -1,  1,  1, -1,  1,  1,  1,  1, -1,  1,  1
    ]
    indices = [
        0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
        0, 4, 5, 0, 5, 1, 2, 6, 7, 2, 7, 3,
        0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2
    ]
    
    bin_data = struct.pack(f'{len(vertices)}f', *vertices)
    bin_data += struct.pack(f'{len(indices)}H', *indices)
    while len(bin_data) % 4 != 0:
        bin_data += b'\x00'
    
    json_chunk_length = len(json_bytes)
    bin_chunk_length = len(bin_data)
    total_length = 12 + 8 + json_chunk_length + 8 + bin_chunk_length
    
    with open(filepath, 'wb') as f:
        f.write(struct.pack('<III', glb_magic, glb_version, total_length))
        f.write(struct.pack('<II', json_chunk_length, 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack('<II', bin_chunk_length, 0x004E4942))
        f.write(bin_data)
