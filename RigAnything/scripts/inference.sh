#!/bin/bash
set -e

# Usage: ./inference.sh <mesh_path> <mesh_simplify (true/false)> <simplify_count>

# Resolve the project root (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check if an argument is provided
if [ $# -lt 3 ]; then
    echo "Error: Please provide mesh_simplify and simplify_count as arguments"
    echo "Usage: $0 <mesh_path> <mesh_simplify (0/1)> <simplify_count>"
    exit 1
fi

# Store the mesh path argument and convert to absolute paths
DATA_PATH="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
MESH_SIMPLIFY="$2"
MESH_SIMPLIFY_COUNT="$3"
DATA_NAME="${1##*/}"

# Ensure we run from project root so relative imports work
cd "$PROJECT_ROOT"

# Helper: run a Python script via Blender so that bpy is available,
# while also keeping access to venv site-packages.
SITE_PACKAGES="$(python -c 'import site; print(site.getsitepackages()[0])')"
run_with_bpy() {
    blender --background --python-expr "
import sys, os
sys.path.insert(0, '/usr/lib/python3.12/lib-dynload')
sys.path.append('$SITE_PACKAGES')
sys.path.insert(0, '$PROJECT_ROOT')
os.chdir('$PROJECT_ROOT')
sys.argv = sys.argv[sys.argv.index('--')+1:]
exec(open(sys.argv[0]).read())
" -- "$@"
}

# Step 0: Create output directory (use absolute path)
OUTPUT_DIR="$PROJECT_ROOT/outputs/${DATA_NAME%.glb}/"
mkdir -p "$OUTPUT_DIR"
INFERENCE_LOG="$OUTPUT_DIR/inference.log"
touch "$INFERENCE_LOG"

# Step 1: Run mesh simplification if specified
echo "---------------------------Step 1: Mesh Simplification---------------------------"
echo "Executing: python inference_utils/mesh_simplify.py --data_path $DATA_PATH --mesh_simplify $MESH_SIMPLIFY --simplify_count $MESH_SIMPLIFY_COUNT --output_path $OUTPUT_DIR   "
echo " "
run_with_bpy inference_utils/mesh_simplify.py \
    --data_path "$DATA_PATH" \
    --mesh_simplify "$MESH_SIMPLIFY" \
    --simplify_count "$MESH_SIMPLIFY_COUNT" \
    --output_path "$OUTPUT_DIR" >> "$INFERENCE_LOG" 2>&1

MESH_SIMPLIFIED_PATH="$OUTPUT_DIR/${DATA_NAME%.glb}_simplified.glb"


# Step 2: Run RigAnything inference
echo "--------------------------Step 2: RigAnything Inference---------------------------"
echo "Executing: python inference.py --config config.yaml --load ckpt/riganything_ckpt.pt -s inference true -s inference_out_dir outputs --mesh_path $MESH_SIMPLIFIED_PATH"
echo " "
run_with_bpy inference.py \
    --config "$PROJECT_ROOT/config.yaml" \
    --load "$PROJECT_ROOT/ckpt/riganything_ckpt.pt" \
    -s inference true \
    -s inference_out_dir "$OUTPUT_DIR" \
    -s training.checkpoint_dir "$PROJECT_ROOT/ckpt/riganything_ckpt.pt" \
    -s training.resume_ckpt "$PROJECT_ROOT/ckpt/riganything_ckpt.pt" \
    --mesh_path "$MESH_SIMPLIFIED_PATH" >> "$INFERENCE_LOG" 2>&1

INFERENCE_OUTPUT_NPZ_PATH="$OUTPUT_DIR/${DATA_NAME%.glb}_simplified.npz"

# # Step 3: Run visualization
echo "---------------------------Step 3: Visualization----------------------------------"
echo "Executing: python inference_utils/vis_skel.py --data_path $INFERENCE_OUTPUT_NPZ_PATH --save_path $OUTPUT_DIR --mesh_path $MESH_SIMPLIFIED_PATH"
echo "---------------------------------------------------------------------------------"
echo " "
run_with_bpy inference_utils/vis_skel.py \
    --data_path "$INFERENCE_OUTPUT_NPZ_PATH" \
    --save_path "$OUTPUT_DIR" \
    --mesh_path "$MESH_SIMPLIFIED_PATH" >> "$INFERENCE_LOG" 2>&1

RESULTS_PATH="${INFERENCE_OUTPUT_NPZ_PATH%.npz}_rig.glb"

echo "---------------------------------------------------------------------------------"
echo "Finished! Results saved to $RESULTS_PATH, import with Blender to view the rigged mesh."