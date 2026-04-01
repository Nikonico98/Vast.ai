#!/bin/bash
# ==========================================
# Start SAM3 + SAM3D Persistent Model Servers
# ==========================================
# Dual-GPU Architecture:
#   GPU 0: SAM3 (port 5561) + SAM3D (port 5562) → handles real/photo items
#   GPU 1: SAM3 (port 5571) + SAM3D (port 5572) → handles fictional items
#
# This enables true parallel processing: photo and fictional 3D generation
# run simultaneously on separate GPUs instead of competing for the same one.
#
# Usage:
#   bash start_model_servers.sh        # Start all 4 servers
#   bash start_model_servers.sh gpu0   # Start GPU 0 servers only
#   bash start_model_servers.sh gpu1   # Start GPU 1 servers only
#   bash start_model_servers.sh stop   # Stop all servers
#
# Logs:
#   /workspace/IW/logs/sam3_gpu0_server.log
#   /workspace/IW/logs/sam3d_gpu0_server.log
#   /workspace/IW/logs/sam3_gpu1_server.log
#   /workspace/IW/logs/sam3d_gpu1_server.log
# ==========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="/workspace/IW/logs"
mkdir -p "$LOG_DIR"

# Load environment
if [ -f "$SCRIPT_DIR/.env" ]; then
    export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
fi

CONDA_BASE=$(conda info --base 2>/dev/null || echo "/opt/conda")

# Port configuration — GPU 0 (real/photo) and GPU 1 (fictional)
SAM3_PORT_GPU0="${SAM3_SERVER_PORT_GPU0:-5561}"
SAM3D_PORT_GPU0="${SAM3D_SERVER_PORT_GPU0:-5562}"
SAM3_PORT_GPU1="${SAM3_SERVER_PORT_GPU1:-5571}"
SAM3D_PORT_GPU1="${SAM3D_SERVER_PORT_GPU1:-5572}"

ALL_PORTS="$SAM3_PORT_GPU0 $SAM3D_PORT_GPU0 $SAM3_PORT_GPU1 $SAM3D_PORT_GPU1"

stop_servers() {
    echo "Stopping all model servers..."
    for port in $ALL_PORTS; do
        fuser -k "$port/tcp" 2>/dev/null && echo "  Stopped server on port $port" || true
    done
}

start_sam3_on_gpu() {
    local gpu_id=$1
    local port=$2
    local log_file="$LOG_DIR/sam3_gpu${gpu_id}_server.log"

    echo "Starting SAM3 on GPU $gpu_id (port $port)..."
    SAM3_SERVER_PORT=$port CUDA_VISIBLE_DEVICES=$gpu_id bash -c "
        source $CONDA_BASE/etc/profile.d/conda.sh
        conda activate ${SAM3_ENV:-sam3}
        cd $SCRIPT_DIR
        exec python sam3_server.py
    " >> "$log_file" 2>&1 &
    echo "  SAM3@GPU$gpu_id PID: $!"
}

start_sam3d_on_gpu() {
    local gpu_id=$1
    local port=$2
    local log_file="$LOG_DIR/sam3d_gpu${gpu_id}_server.log"

    echo "Starting SAM3D on GPU $gpu_id (port $port)..."
    SAM3D_SERVER_PORT=$port CUDA_VISIBLE_DEVICES=$gpu_id bash -c "
        source $CONDA_BASE/etc/profile.d/conda.sh
        conda activate ${SAM3D_ENV:-sam3d-objects}
        cd ${SAM3D_REPO:-/workspace/sam-3d-objects}
        exec python $SCRIPT_DIR/sam3d_server.py
    " >> "$log_file" 2>&1 &
    echo "  SAM3D@GPU$gpu_id PID: $!"
}

wait_for_server() {
    local port=$1
    local name=$2
    local max_wait=${3:-120}
    local elapsed=0

    echo -n "  Waiting for $name (port $port)..."
    while [ $elapsed -lt $max_wait ]; do
        if curl -s "http://127.0.0.1:$port/health" 2>/dev/null | grep -q '"model_loaded": true'; then
            echo " ready! (${elapsed}s)"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        echo -n "."
    done
    echo " TIMEOUT after ${max_wait}s!"
    echo "  Check logs in $LOG_DIR/"
    return 1
}

start_gpu0() {
    start_sam3_on_gpu 0 "$SAM3_PORT_GPU0"
    start_sam3d_on_gpu 0 "$SAM3D_PORT_GPU0"
}

start_gpu1() {
    start_sam3_on_gpu 1 "$SAM3_PORT_GPU1"
    start_sam3d_on_gpu 1 "$SAM3D_PORT_GPU1"
}

wait_gpu0() {
    wait_for_server "$SAM3_PORT_GPU0" "SAM3@GPU0" 120
    local s3=$?
    wait_for_server "$SAM3D_PORT_GPU0" "SAM3D@GPU0" 180
    local s3d=$?
    return $(( s3 + s3d ))
}

wait_gpu1() {
    wait_for_server "$SAM3_PORT_GPU1" "SAM3@GPU1" 120
    local s3=$?
    wait_for_server "$SAM3D_PORT_GPU1" "SAM3D@GPU1" 180
    local s3d=$?
    return $(( s3 + s3d ))
}

case "${1:-all}" in
    stop)
        stop_servers
        ;;
    gpu0)
        start_gpu0
        echo ""
        wait_gpu0
        ;;
    gpu1)
        start_gpu1
        echo ""
        wait_gpu1
        ;;
    all|"")
        echo "=========================================="
        echo "  Starting Dual-GPU Model Servers"
        echo "  GPU 0: SAM3 (:$SAM3_PORT_GPU0) + SAM3D (:$SAM3D_PORT_GPU0) → real/photo"
        echo "  GPU 1: SAM3 (:$SAM3_PORT_GPU1) + SAM3D (:$SAM3D_PORT_GPU1) → fictional"
        echo "=========================================="

        # Stop existing servers first
        stop_servers 2>/dev/null || true
        sleep 1

        # Start all 4 servers
        start_gpu0
        start_gpu1

        echo ""
        echo "Waiting for models to load..."
        wait_gpu0
        GPU0_OK=$?
        wait_gpu1
        GPU1_OK=$?

        echo ""
        echo "=========================================="
        if [ $GPU0_OK -eq 0 ] && [ $GPU1_OK -eq 0 ]; then
            echo "  ✅ All 4 model servers are ready!"
            echo "  GPU 0: SAM3 + SAM3D → real/photo pipeline"
            echo "  GPU 1: SAM3 + SAM3D → fictional pipeline"
        else
            echo "  ⚠️ Some servers failed to start"
            echo "  Check logs in $LOG_DIR/"
        fi
        echo "=========================================="
        ;;
    *)
        echo "Usage: $0 [all|gpu0|gpu1|stop]"
        exit 1
        ;;
esac
