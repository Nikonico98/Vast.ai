"""
Wrapper to run Python scripts within Blender's Python environment.
This ensures bpy is available alongside torch and other packages.

Usage: blender --background --python blender_run.py -- <script.py> [args...]
"""
import sys
import os

# Fix sys.path: remove ALL venv paths (stdlib, lib-dynload, site-packages)
# to avoid ABI conflicts between conda Python and Blender's bundled Python.
# We'll manually add back only the conda site-packages.
clean_path = []
for p in sys.path:
    if 'venv' not in p:
        clean_path.append(p)

# Detect active conda env site-packages (must be Python 3.12 compatible)
conda_prefix = os.environ.get('CONDA_PREFIX', '')
if not conda_prefix:
    conda_prefix = '/venv/main'

conda_site = os.path.join(conda_prefix, 'lib', 'python3.12', 'site-packages')

# Add system stdlib FIRST (compatible with Blender's Python 3.12.3),
# then conda site-packages for third-party packages (torch, open3d, etc.)
extra_paths = []
for p in ['/usr/lib/python3.12',
          '/usr/lib/python3.12/lib-dynload',
          '/usr/local/lib/python3.12/dist-packages',
          '/usr/lib/python3/dist-packages']:
    if os.path.isdir(p) and p not in clean_path:
        extra_paths.append(p)
if os.path.isdir(conda_site) and conda_site not in clean_path:
    extra_paths.append(conda_site)

sys.path = extra_paths + clean_path

# Parse args after '--'
argv = sys.argv
if '--' in argv:
    idx = argv.index('--')
    script_args = argv[idx + 1:]
else:
    print("Usage: blender --background --python blender_run.py -- <script.py> [args...]")
    sys.exit(1)

if not script_args:
    print("Error: No script specified")
    sys.exit(1)

target_script = os.path.abspath(script_args[0])
sys.argv = script_args

# Change to the script's directory's parent (project root)
script_dir = os.path.dirname(target_script)
project_root = os.path.dirname(script_dir) if os.path.basename(script_dir) != '' else script_dir
# If the script is at project root level, use its directory
if os.path.exists(os.path.join(os.path.dirname(target_script), 'config.yaml')):
    project_root = os.path.dirname(target_script)
elif os.path.exists(os.path.join(os.path.dirname(os.path.dirname(target_script)), 'config.yaml')):
    project_root = os.path.dirname(os.path.dirname(target_script))

os.chdir(project_root)
sys.path.insert(0, project_root)

# Execute the target script
with open(target_script) as f:
    code = compile(f.read(), target_script, 'exec')
    exec(code, {'__name__': '__main__', '__file__': target_script})
