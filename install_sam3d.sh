#!/bin/bash
source /opt/miniforge3/etc/profile.d/conda.sh
conda activate sam3d-objects
cd /workspace/sam-3d-objects

# Set CUDA environment
export CUDA_HOME=$(python -c "import torch; print(torch.utils.cmake_prefix_path.replace('/share/cmake', ''))" 2>/dev/null || echo "/usr/local/cuda")
export TORCH_CUDA_ARCH_LIST="7.5;8.0;8.6;8.9;9.0"
export FORCE_CUDA=1
export SKIP_GSPLAT_BUILD=1

export PIP_EXTRA_INDEX_URL="https://pypi.ngc.nvidia.com https://download.pytorch.org/whl/cu121"
pip install -e ".[dev]" || true
pip install -e ".[p3d]" || true

export PIP_FIND_LINKS="https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.5.1_cu121.html"
pip install -e ".[inference]" || true

# Install gsplat
pip install gsplat --no-build-isolation || echo "gsplat skipped"

# Install additional dependencies
pip install seaborn || true
pip install kaolin -f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.5.1_cu121.html || true

# Install trimesh for GLB post-processing (origin adjustment for AR)
pip install trimesh || true

# Apply hydra patch
if [ -f "./patching/hydra" ]; then
    python ./patching/hydra || true
fi

pip install "huggingface-hub[cli]<1.0"

# Final verification
echo "========================================"
echo "Verifying SAM3D dependencies..."
echo "========================================"
python -c "import torch; print('torch:', torch.__version__, 'CUDA:', torch.cuda.is_available())"
python -c "import omegaconf; print('omegaconf: OK')" || echo "omegaconf: FAILED"
python -c "import utils3d; print('utils3d: OK')" || echo "utils3d: FAILED"
python -c "import seaborn; print('seaborn: OK')" || echo "seaborn: FAILED"
python -c "import pytorch3d; print('pytorch3d: OK')" || echo "pytorch3d: FAILED"
python -c "import kaolin; print('kaolin: OK')" || echo "kaolin: FAILED"
python -c "import gsplat; print('gsplat: OK')" || echo "gsplat: FAILED"
echo "========================================"
