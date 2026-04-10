#!/bin/bash
echo "=== BLENDER ==="
type blender 2>&1 || echo "BLENDER NOT FOUND"
echo ""
echo "=== PYTHON ==="
python3 --version 2>&1
echo ""
echo "=== CUDA ==="
python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU count: {torch.cuda.device_count()}'); [print(f'GPU {i}: {torch.cuda.get_device_name(i)}') for i in range(torch.cuda.device_count())]" 2>&1
echo ""
echo "=== CHECKPOINT ==="
ls -lh /workspace/RigAnything/ckpt/*.pt 2>&1 || echo "NO CHECKPOINT"
echo ""
echo "=== BPY ==="
python3 -c "import bpy; print('bpy OK')" 2>&1
echo ""
echo "=== TRIMESH ==="
python3 -c "import trimesh; print('trimesh OK')" 2>&1
echo ""
echo "=== OPEN3D ==="
python3 -c "import open3d; print('open3d OK')" 2>&1
echo ""
echo "=== PYMESHLAB ==="
python3 -c "import pymeshlab; print('pymeshlab OK')" 2>&1
echo ""
echo "=== EINOPS ==="
python3 -c "import einops; print('einops OK')" 2>&1
echo ""
echo "=== EASYDICT ==="
python3 -c "import easydict; print('easydict OK')" 2>&1
echo ""
echo "=== TRANSFORMERS ==="
python3 -c "import transformers; print('transformers OK')" 2>&1
echo ""
echo "=== SCIPY ==="
python3 -c "import scipy; print('scipy OK')" 2>&1
echo ""
echo "=== LPIPS ==="
python3 -c "import lpips; print('lpips OK')" 2>&1
echo ""
echo "=== PYTHON LIB-DYNLOAD ==="
ls /usr/lib/python3.12/lib-dynload/ 2>&1 | head -5 || echo "NO python3.12 lib-dynload"
ls /usr/lib/python3.11/lib-dynload/ 2>&1 | head -5 || echo "NO python3.11 lib-dynload"
echo ""
echo "=== DONE ==="
