import subprocess, os

# Check blender
r = subprocess.run(["which", "blender"], capture_output=True, text=True)
print(f"blender path: {r.stdout.strip() or 'NOT FOUND'}")

if r.stdout.strip():
    r2 = subprocess.run(["blender", "--version"], capture_output=True, text=True)
    print(f"blender version: {r2.stdout.strip()[:50]}")

# Check RIGANYTHING_DIR
from pathlib import Path
rig_dir = Path("/workspace/IW/RigAnything")
print(f"\nRigAnything dir exists: {rig_dir.exists()}")
print(f"inference.sh exists: {(rig_dir / 'scripts' / 'inference.sh').exists()}")
print(f"ckpt exists: {(rig_dir / 'ckpt' / 'riganything_ckpt.pt').exists()}")
ckpt = rig_dir / 'ckpt' / 'riganything_ckpt.pt'
if ckpt.exists():
    real = ckpt.resolve()
    print(f"ckpt resolves to: {real}")
    print(f"ckpt size: {os.path.getsize(real):,} bytes")

# Simulate what pipeline does
stem = "test_rig_20260413_063532"
output_dir = rig_dir / "outputs" / stem
rigged_glb = output_dir / f"{stem}_simplified_rig.glb"
print(f"\nExpected rigged GLB path: {rigged_glb}")

# Also check what inference.sh would compute
# DATA_NAME = basename of glb = "test_rig_20260413_063532.glb"
# ${DATA_NAME%.glb} = "test_rig_20260413_063532"
# OUTPUT_DIR = "$PROJECT_ROOT/outputs/test_rig_20260413_063532/"
# vis_skel saves to OUTPUT_DIR, file = ${stem}_simplified_rig.glb
# So the actual path would be:
actual = rig_dir / "outputs" / stem / f"{stem}_simplified_rig.glb"
print(f"Actual rigged GLB path: {actual}")
print(f"Paths match: {rigged_glb == actual}")
