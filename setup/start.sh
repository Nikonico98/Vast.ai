#!/bin/bash
# ==========================================
# ImaginaryWorld Vastai - GPU Service 启动脚本
# ==========================================

echo ""
echo "🚀 =========================================="
echo "   ImaginaryWorld GPU Service (Vast.ai)"
echo "==========================================="
echo ""

# ==========================================
# 配置区域
# ==========================================
GPU_PORT="5555"
SAM3_ENV="sam3"

# ==========================================
# 获取目录路径
# ==========================================
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/backend"
LOGS_DIR="$PROJECT_DIR/logs"

echo "📁 Project Directory: $PROJECT_DIR"
echo "📁 Backend Directory: $BACKEND_DIR"

mkdir -p "$LOGS_DIR"

# ==========================================
# 加载 .env 文件
# ==========================================
if [ -f "$BACKEND_DIR/.env" ]; then
    echo "📦 Loading .env file..."
    while IFS= read -r line || [ -n "$line" ]; do
        line=$(echo "$line" | tr -d '\r')
        [[ -z "$line" || "$line" =~ ^# ]] && continue
        if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
            name="${BASH_REMATCH[1]}"
            value="${BASH_REMATCH[2]}"
            value=$(echo "$value" | sed 's/^["'"'"']//;s/["'"'"']$//')
            export "$name=$value"
        fi
    done < "$BACKEND_DIR/.env"
    echo "   ✅ Environment loaded"
fi

# ==========================================
# 获取 conda 路径
# ==========================================
get_conda_base() {
    if command -v conda &> /dev/null; then
        conda info --base 2>/dev/null
    else
        for path in /opt/miniforge3 /opt/conda /root/miniconda3; do
            [ -d "$path" ] && echo "$path" && return
        done
        echo "/opt/conda"
    fi
}

CONDA_BASE=$(get_conda_base)
echo "📦 Conda: $CONDA_BASE"

# ==========================================
# 停止已有 GPU Service 进程
# ==========================================
echo ""
echo "🛑 Stopping existing GPU service..."

pkill -9 -f "python.*gpu_app.py" 2>/dev/null && echo "   ✅ Killed old GPU service" || echo "   ⚪ No GPU service to kill"
fuser -k $GPU_PORT/tcp 2>/dev/null || true

sleep 2

# ==========================================
# 启动 GPU Service
# ==========================================
echo ""
echo "🚀 Starting GPU Service on port $GPU_PORT..."

cd "$BACKEND_DIR"

source "$CONDA_BASE/etc/profile.d/conda.sh"
conda activate $SAM3_ENV
echo "   ✅ Activated conda environment: $SAM3_ENV"

export GPU_SERVICE_PORT=$GPU_PORT
export PYTHONPATH="$BACKEND_DIR:$PROJECT_DIR/RigAnything/scripts:$PROJECT_DIR/RigAnything:${PYTHONPATH}"

nohup python gpu_app.py > "$LOGS_DIR/gpu_service.log" 2>&1 &
GPU_PID=$!
echo "   GPU Service PID: $GPU_PID"

sleep 3

if curl -s "http://localhost:$GPU_PORT/api/gpu/health" > /dev/null 2>&1; then
    echo "   ✅ GPU Service started successfully!"
else
    echo "   ⚠️ GPU Service may still be starting..."
    echo "   Check logs: tail -f $LOGS_DIR/gpu_service.log"
fi

# ==========================================
# 配置 Caddy :8080 → GPU API 代理
# ==========================================
# Vast.ai 的 supervisor 会在每次 Caddy 重启时重新生成 Caddyfile，
# 手动修改会丢失。caddy_gpu_proxy.sh 通过 hook caddy.sh 使修改持久化。
CADDY_PROXY_SCRIPT="$SCRIPT_DIR/caddy_gpu_proxy.sh"
if [ -f "$CADDY_PROXY_SCRIPT" ]; then
    chmod +x "$CADDY_PROXY_SCRIPT"
    GPU_SERVICE_PORT=$GPU_PORT bash "$CADDY_PROXY_SCRIPT"
else
    echo "   ⚠️ caddy_gpu_proxy.sh not found, Caddy proxy not configured"
fi

# ==========================================
# 启动 Socat 端口转发 (1111 → 5555)
# ==========================================
echo ""
echo "🚪 Starting socat port forwarding (1111 → $GPU_PORT)..."
SOCAT_SCRIPT="$SCRIPT_DIR/socat_port_forward.sh"
if [ -f "$SOCAT_SCRIPT" ]; then
    chmod +x "$SOCAT_SCRIPT"
    SOCAT_TARGET_PORT=$GPU_PORT bash "$SOCAT_SCRIPT" start
else
    echo "   ⚠️ socat_port_forward.sh not found, skipping"
fi

# ==========================================
# 启动 SAM3/SAM3D 持久化模型服务器
# ==========================================
echo ""
echo "🧠 Starting SAM3/SAM3D persistent model servers..."

MODEL_SERVER_SCRIPT="$BACKEND_DIR/start_model_servers.sh"
if [ -f "$MODEL_SERVER_SCRIPT" ]; then
    sed -i 's/\r$//' "$MODEL_SERVER_SCRIPT"
    chmod +x "$MODEL_SERVER_SCRIPT"
    bash "$MODEL_SERVER_SCRIPT" all
    echo "   ✅ Model servers started"
else
    echo "   ⚠️ start_model_servers.sh not found, skipping"
fi

# ==========================================
# 打印状态
# ==========================================
echo ""
echo "==========================================="
echo "   ✅ GPU Service Started!"
echo "==========================================="
echo ""
echo "   🖥️  GPU Service: http://localhost:$GPU_PORT"
echo "   🏥 Health:      http://localhost:$GPU_PORT/api/gpu/health"
echo "   🧠 SAM3 Server: http://localhost:5561/health"
echo "   🧠 SAM3D Server: http://localhost:5562/health"
echo ""
echo "   📋 Logs: tail -f $LOGS_DIR/gpu_service.log"
echo "   📋       tail -f $LOGS_DIR/sam3_server.log"
echo "   📋       tail -f $LOGS_DIR/sam3d_server.log"
echo ""
echo "   🛑 To stop: bash $SCRIPT_DIR/stop.sh"
echo ""
echo "==========================================="