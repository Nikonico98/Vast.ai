#!/bin/bash
# ==========================================
# Start SAM3 Persistent Model Servers
# ==========================================
# Architecture: SAM3 persistent + SAM3D on-demand
#   GPU 0: SAM3 (port 5561) → handles real/photo items
#   GPU 1: SAM3 (port 5571) → handles fictional items
#   SAM3D: runs as on-demand subprocess per job (no persistent server)
#
# This keeps ~4GB VRAM per GPU for SAM3, leaving ~20GB free for SAM3D
# subprocess jobs, eliminating CUDA OOM errors.
#
# Usage:
#   bash start_model_servers.sh        # Start both SAM3 servers
#   bash start_model_servers.sh gpu0   # Start GPU 0 SAM3 only
#   bash start_model_servers.sh gpu1   # Start GPU 1 SAM3 only
#   bash start_model_servers.sh stop   # Stop all servers
#
# Logs:
#   /workspace/IW/logs/sam3_gpu0_server.log
#   /workspace/IW/logs/sam3_gpu1_server.log
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

# Port configuration — SAM3 only (SAM3D runs as on-demand subprocess)
SAM3_PORT_GPU0="${SAM3_SERVER_PORT_GPU0:-5561}"
SAM3_PORT_GPU1="${SAM3_SERVER_PORT_GPU1:-5571}"

ALL_PORTS="$SAM3_PORT_GPU0 $SAM3_PORT_GPU1"

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

# NOTE: SAM3D no longer runs as persistent server.
# It runs as on-demand subprocess via pipeline_3d.py to avoid VRAM pressure.

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
}

start_gpu1() {
    start_sam3_on_gpu 1 "$SAM3_PORT_GPU1"
}

wait_gpu0() {
    wait_for_server "$SAM3_PORT_GPU0" "SAM3@GPU0" 120
    return $?
}

wait_gpu1() {
    wait_for_server "$SAM3_PORT_GPU1" "SAM3@GPU1" 120
    return $?
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
        echo "  Starting SAM3 Persistent Model Servers"
        echo "  GPU 0: SAM3 (:$SAM3_PORT_GPU0) → real/photo"
        echo "  GPU 1: SAM3 (:$SAM3_PORT_GPU1) → fictional"
        echo "  SAM3D: on-demand subprocess (no persistent server)"
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
            echo "  ✅ Both SAM3 servers are ready!"
            echo "  GPU 0: SAM3 → real/photo segmentation"
            echo "  GPU 1: SAM3 → fictional segmentation"
            echo "  SAM3D: on-demand subprocess (VRAM-safe)"
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
