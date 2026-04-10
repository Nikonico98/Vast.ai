#!/bin/bash
set -e

cd /workspace/RigAnything
echo "=== Working directory: $(pwd)"
echo "=== Checkpoint exists:"
ls -lh /workspace/RigAnything/ckpt/riganything_ckpt.pt

echo "=== Cleaning old outputs..."
rm -rf /workspace/RigAnything/outputs/spyro_the_dragon

echo "=== Step 1: Mesh Simplification ==="
mkdir -p /workspace/RigAnything/outputs/spyro_the_dragon
python inference_utils/mesh_simplify.py \
    --data_path /workspace/RigAnything/data_examples/spyro_the_dragon.glb \
    --mesh_simplify 1 \
    --simplify_count 8192 \
    --output_path /workspace/RigAnything/outputs/spyro_the_dragon/ 2>&1 | tail -5
echo "Step 1 done"

echo "=== Step 2: RigAnything Inference ==="
python inference.py \
    --config /workspace/RigAnything/config.yaml \
    --load /workspace/RigAnything/ckpt/riganything_ckpt.pt \
    -s inference true \
    -s inference_out_dir /workspace/RigAnything/outputs/spyro_the_dragon/ \
    -s training.checkpoint_dir /workspace/RigAnything/ckpt/riganything_ckpt.pt \
    -s training.resume_ckpt /workspace/RigAnything/ckpt/riganything_ckpt.pt \
    --mesh_path /workspace/RigAnything/outputs/spyro_the_dragon/spyro_the_dragon_simplified.glb 2>&1 | tail -20
echo "Step 2 done"

echo "=== Step 3: Visualization ==="
python inference_utils/vis_skel.py \
    --data_path /workspace/RigAnything/outputs/spyro_the_dragon/spyro_the_dragon_simplified.npz \
    --save_path /workspace/RigAnything/outputs/spyro_the_dragon/ \
    --mesh_path /workspace/RigAnything/outputs/spyro_the_dragon/spyro_the_dragon_simplified.glb 2>&1 | tail -5
echo "Step 3 done"

echo "=== Results ==="
ls -lh /workspace/RigAnything/outputs/spyro_the_dragon/
echo "=== ALL DONE ==="
