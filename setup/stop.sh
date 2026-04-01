#!/bin/bash
# ==========================================
# ImaginaryWorld Vastai - GPU Service 停止脚本
# ==========================================

echo ""
echo "🛑 Stopping GPU Service..."
echo ""

# 停止 GPU Service
pkill -9 -f "python.*gpu_app.py" 2>/dev/null && echo "   ✅ GPU Service stopped" || echo "   ⚪ GPU Service was not running"

# 释放端口
fuser -k 5555/tcp 2>/dev/null || true

echo ""
echo "🎉 GPU Service stopped"
echo ""
