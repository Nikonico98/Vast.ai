#!/bin/bash
# ==========================================
# Imaginary World - Vast.ai GPU Worker Start
# ==========================================
set -e

echo "=========================================="
echo "  Starting GPU Worker on Vast.ai"
echo "=========================================="

# Note: SAM3 / SAM3D dependencies run in their own conda environments.
# This script only installs the lightweight gpu_worker Flask dependencies.

# Install pip deps for the Flask wrapper
pip install -r requirements.txt

# Copy .env if not present
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Copying from .env.example"
    cp .env.example .env
    echo "   Please edit .env and set GPU_API_SECRET and HF_TOKEN"
fi

# Create data directories
mkdir -p data/temp data/results data/uploads

# Verify GPU
echo ""
echo "GPU Check:"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "  ⚠️  No GPU detected via nvidia-smi"

# Verify conda environments
echo ""
echo "Conda Environment Check:"
conda env list 2>/dev/null | grep -E "sam3|sam3d" || echo "  ⚠️  SAM3/SAM3D conda envs not found"

echo ""
echo "Starting GPU Worker..."

PORT="${GPU_WORKER_PORT:-9090}"
exec gunicorn gpu_worker:app \
    --bind 0.0.0.0:$PORT \
    --workers 1 \
    --threads 4 \
    --timeout 600 \
    --access-logfile - \
    --error-logfile -
