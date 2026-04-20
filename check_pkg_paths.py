import subprocess
# Check where packages are installed
for pkg in ['open3d', 'torch', 'trimesh', 'numpy']:
    r = subprocess.run(['python3', '-c', f'import {pkg}; print({pkg}.__file__)'],
                       capture_output=True, text=True)
    if r.returncode == 0:
        print(f"{pkg}: {r.stdout.strip()}")
    else:
        print(f"{pkg}: NOT FOUND in current env")

# Check system python
for pkg in ['open3d', 'torch', 'trimesh']:
    r = subprocess.run(['/usr/bin/python3', '-c', f'import {pkg}; print({pkg}.__file__)'],
                       capture_output=True, text=True)
    if r.returncode == 0:
        print(f"  system: {r.stdout.strip()}")
    else:
        print(f"  system: NOT FOUND")

# Check /venv/main
import os
for d in ['/venv/main/lib', '/usr/local/lib/python3.12/dist-packages', '/opt/miniforge3/envs']:
    if os.path.exists(d):
        print(f"\n{d} exists")
    else:
        print(f"\n{d} MISSING")
