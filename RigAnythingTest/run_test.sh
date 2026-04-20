#!/bin/bash
# RigAnything Test — 啟動伺服器
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 檢查依賴
echo "=== RigAnything Test Server ==="
echo "Checking dependencies..."

python -c "import flask" 2>/dev/null || { echo "Installing Flask..."; pip install flask; }
python -c "import openai" 2>/dev/null || { echo "Installing OpenAI..."; pip install openai; }
python -c "import trimesh" 2>/dev/null || { echo "Installing trimesh..."; pip install trimesh; }
python -c "import dotenv" 2>/dev/null || { echo "Installing python-dotenv..."; pip install python-dotenv; }

# 檢查 Blender
which blender >/dev/null 2>&1 || echo "WARNING: Blender not found. GLB export will not work."

# 檢查 OPENAI_API_KEY
if [ -z "$OPENAI_API_KEY" ]; then
    echo "WARNING: OPENAI_API_KEY not set. Chat features will be disabled."
    echo "  Export it: export OPENAI_API_KEY=sk-..."
fi

# 建立必要目錄
mkdir -p uploads outputs static

echo ""
echo "Starting server on port ${RIG_TEST_PORT:-7860}..."
echo "Open: http://localhost:${RIG_TEST_PORT:-7860}"
echo ""

python server.py
