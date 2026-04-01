#!/bin/bash
# ==========================================
# Install trimesh in SAM3D environment
# ==========================================
# This script installs trimesh for GLB model post-processing
# (adjusting model origin to bottom center for AR)

echo "🔧 Installing trimesh in SAM3D environment..."

# Detect conda base
if [ -d "/opt/miniforge3" ]; then
    CONDA_BASE="/opt/miniforge3"
elif [ -d "/opt/conda" ]; then
    CONDA_BASE="/opt/conda"
else
    echo "❌ Conda not found!"
    exit 1
fi

echo "📦 Conda base: $CONDA_BASE"

# Activate SAM3D environment
source $CONDA_BASE/etc/profile.d/conda.sh
conda activate sam3d-objects

# Check if trimesh is already installed
python -c "import trimesh; print(f'✅ trimesh {trimesh.__version__} already installed')" 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ trimesh is already installed!"
    exit 0
fi

# Install trimesh
echo "📥 Installing trimesh..."
pip install trimesh

# Verify installation
python -c "import trimesh; print(f'✅ trimesh {trimesh.__version__} installed successfully')"

if [ $? -eq 0 ]; then
    echo "🎉 Installation complete!"
else
    echo "❌ Installation failed!"
    exit 1
fi
