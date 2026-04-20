#!/bin/bash
# ==========================================
# ImaginaryWorld Vastai - 完整停止脚本
# Stops GPU Service + SAM3 model servers
# ==========================================

echo ""
echo "🛑 Stopping all ImaginaryWorld services..."
echo ""

# ==========================================
# 停止 SAM3 持久化模型服务器
# ==========================================
echo "🧠 Stopping SAM3 model servers..."

# SAM3 on GPU 0 (port 5561)
fuser -k 5561/tcp 2>/dev/null && echo "   ✅ SAM3@GPU0 (port 5561) stopped" || echo "   ⚪ SAM3@GPU0 was not running"

# SAM3 on GPU 1 (port 5571)
fuser -k 5571/tcp 2>/dev/null && echo "   ✅ SAM3@GPU1 (port 5571) stopped" || echo "   ⚪ SAM3@GPU1 was not running"

# Kill any remaining sam3_server.py processes
pkill -9 -f "python.*sam3_server.py" 2>/dev/null && echo "   ✅ Killed remaining SAM3 server processes" || true

# Kill any remaining sam3d_server.py processes (on-demand, but just in case)
pkill -9 -f "python.*sam3d_server.py" 2>/dev/null && echo "   ✅ Killed remaining SAM3D server processes" || true

# ==========================================
# 停止 GPU Service (gpu_app.py)
# ==========================================
echo ""
echo "🖥️ Stopping GPU Service..."

pkill -9 -f "python.*gpu_app.py" 2>/dev/null && echo "   ✅ GPU Service stopped" || echo "   ⚪ GPU Service was not running"

# 释放 GPU Service 端口
fuser -k 5555/tcp 2>/dev/null || true

# ==========================================
# 停止 Socat 端口转发
# ==========================================
echo ""
echo "🚪 Stopping socat port forwarding..."
pkill -f "socat TCP-LISTEN:1111" 2>/dev/null && echo "   ✅ Socat (1111→5555) stopped" || echo "   ⚪ Socat was not running"

echo ""
echo "🎉 All services stopped"
echo ""