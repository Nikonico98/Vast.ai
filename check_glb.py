import os, json, struct

glb_path = "/workspace/gpu_data/temp/test_rig_20260413_063532/real_3d/test_rig_20260413_063532.glb"

size = os.path.getsize(glb_path)
print(f"GLB file: {glb_path}")
print(f"Size: {size:,} bytes ({size/1024:.1f} KB)")

with open(glb_path, 'rb') as f:
    magic = f.read(4)
    if magic != b'glTF':
        print("NOT a valid glTF binary file!")
    else:
        version = struct.unpack('<I', f.read(4))[0]
        total_len = struct.unpack('<I', f.read(4))[0]
        print(f"glTF version: {version}")
        
        # Read JSON chunk
        chunk_len = struct.unpack('<I', f.read(4))[0]
        chunk_type = f.read(4)
        json_data = f.read(chunk_len).decode('utf-8')
        
        gltf = json.loads(json_data)
        
        print(f"\nMeshes: {len(gltf.get('meshes', []))}")
        print(f"Nodes: {len(gltf.get('nodes', []))}")
        print(f"Materials: {len(gltf.get('materials', []))}")
        
        skins = gltf.get('skins', [])
        print(f"Skins: {len(skins)}")
        if skins:
            for i, skin in enumerate(skins):
                joints = skin.get('joints', [])
                print(f"  Skin {i}: {len(joints)} joints")
            print("\n✅ GLB contains rigging/skeleton data!")
        else:
            print("\n⚠️ No skins/rigging found in GLB")
        
        animations = gltf.get('animations', [])
        print(f"Animations: {len(animations)}")
        
        # Check if it's just a placeholder cube
        if len(gltf.get('meshes', [])) == 1:
            mesh = gltf['meshes'][0]
            name = mesh.get('name', '')
            print(f"\nMesh name: '{name}'")
            if 'cube' in name.lower() or 'placeholder' in name.lower():
                print("⚠️ This appears to be a PLACEHOLDER model")
