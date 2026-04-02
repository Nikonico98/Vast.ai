#!/bin/bash
# ==========================================
# Export conda environments for migration
# 导出 conda 环境用于迁移到新 GPU 实例
# ==========================================
# Run this BEFORE destroying the old instance!
# 在销毁旧实例之前运行！
#
# Usage: bash export_envs.sh
# ==========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENVS_DIR="$SCRIPT_DIR/envs"
mkdir -p "$ENVS_DIR"

# Detect conda
CONDA_BASE=""
for path in /opt/miniforge3 /opt/conda /root/miniconda3; do
    if [ -d "$path" ]; then
        CONDA_BASE="$path"
        break
    fi
done

if [ -z "$CONDA_BASE" ]; then
    echo "❌ Conda not found!"
    exit 1
fi

source "$CONDA_BASE/etc/profile.d/conda.sh"
echo "📦 Conda base: $CONDA_BASE"
echo "📁 Export dir: $ENVS_DIR"
echo ""

# Export each environment
for ENV_NAME in sam3 sam3d-objects; do
    echo "=========================================="
    echo "  Exporting: $ENV_NAME"
    echo "=========================================="

    if ! conda env list | grep -qw "$ENV_NAME"; then
        echo "  ⚠️  Environment '$ENV_NAME' not found, skipping"
        continue
    fi

    # Full conda export (includes conda + pip packages)
    YML_FILE="$ENVS_DIR/${ENV_NAME}_frozen.yml"
    conda env export -n "$ENV_NAME" > "$YML_FILE" 2>/dev/null
    echo "  ✅ Exported → $YML_FILE ($(wc -l < "$YML_FILE") lines)"

    # Pip freeze (fallback in case yml restore fails)
    PIP_FILE="$ENVS_DIR/${ENV_NAME}_pip_freeze.txt"
    conda run -n "$ENV_NAME" pip freeze > "$PIP_FILE" 2>/dev/null
    echo "  ✅ Exported → $PIP_FILE ($(wc -l < "$PIP_FILE") lines)"

    echo ""
done

echo "=========================================="
echo "  ✅ All environments exported!"
echo "=========================================="
echo ""
echo "  Files saved to: $ENVS_DIR/"
ls -lh "$ENVS_DIR/"
echo ""
echo "  📋 Next steps:"
echo "     1. Commit these files to git (cd $SCRIPT_DIR && git add envs/)"
echo "     2. On the new instance: python setup.py --from-frozen"
echo ""
