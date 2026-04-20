#!/bin/bash
cd /workspace

# Configure git
git config user.email "niko@imaginaryworld.app"
git config user.name "Niko"

# Check remote
echo "=== Remote ==="
git remote -v

# Set remote if needed
if ! git remote | grep -q origin; then
    git remote add origin https://github.com/Nikonico98/Vast.ai.git
fi

# Check status
echo "=== Status ==="
git status --short

# Stage key files
echo "=== Staging ==="
git add IW/backend/pipeline_3d.py
git add IW/backend/glb_processor.py
git add IW/RigAnything/scripts/blender_run.py
git add IW/RigAnything/inference_utils/vis_skel.py
git add IW/backend/config.py

# Show what's staged
echo "=== Staged ==="
git diff --cached --stat

# Commit
echo "=== Committing ==="
git commit -m "RigAnything稳定部署

- Fix blender_run.py: add /venv/main site-packages for torch/open3d/trimesh
- Fix vis_skel.py: proper skin binding (parent mesh to armature, export_skins=True)
- Fix pipeline_3d.py: move recenter before rigging (trimesh strips skins data)
- Fix pipeline_3d.py: remove duplicate _run_riganything function & step
- Fix pipeline_3d.py: correct return value handling (bool not tuple)"

# Push
echo "=== Pushing ==="
git push origin HEAD

echo "=== Done ==="
