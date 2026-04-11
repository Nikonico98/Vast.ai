"""
Wrapper to run Python scripts within Blender's Python environment.
This ensures bpy is available alongside torch and other packages.

Usage: blender --background --python blender_run.py -- <script.py> [args...]
"""
import sys
import os

# Fix sys.path: completely remove venv paths to avoid ABI conflicts
# between Blender's Python 3.12.3 and venv's Python 3.12.13
# Keep blender's own paths, add system lib-dynload and dist-packages
clean_path = []
for p in sys.path:
    if 'venv' not in p:
        clean_path.append(p)

# Insert system paths at the beginning (before blender's own paths)
sys.path = [
    '/usr/lib/python3.12/lib-dynload',
    '/usr/local/lib/python3.12/dist-packages',
    '/usr/lib/python3/dist-packages',
] + clean_path

# Also fix the prefix to avoid venv contamination  
sys.prefix = '/usr'
sys.exec_prefix = '/usr'

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
