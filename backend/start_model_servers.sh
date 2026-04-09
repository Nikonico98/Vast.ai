#!/bin/bash
# ==========================================
# Start SAM3 + SAM3D Persistent Model Servers
# ==========================================
# Architecture: SAM3 persistent + SAM3D persistent (both in VRAM)
#   GPU 0: SAM3 (port 5561) + SAM3D (port 5562) → real/photo items
#   GPU 1: SAM3 (port 5571) + SAM3D (port 5572) → fictional items
#
# VRAM budget per GPU (24GB RTX A5000):
#   SAM3 ~4GB + SAM3D ~13GB idle / ~14GB peak (1024px cap) = ~18GB
#   Headroom: ~6GB
#
# Usage:
#   bash start_model_servers.sh        # Start all servers
#   bash start_model_servers.sh gpu0   # Start GPU 0 (SAM3+SAM3D)
#   bash start_model_servers.sh gpu1   # Start GPU 1 (SAM3+SAM3D)
#   bash start_model_servers.sh stop   # Stop all servers
#
# Logs:
#   /workspace/IW/logs/sam3_gpu{0,1}_server.log
#   /workspace/IW/logs/sam3d_gpu{0,1}_server.log
# ==========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="/workspace/IW/logs"
mkdir -p "$LOG_DIR"

# Load environment
if [ -f "$SCRIPT_DIR/.env" ]; then
    while IFS= read -r raw_line || [ -n "$raw_line" ]; do
        line="${raw_line%%#*}"
        if [[ ! "$line" =~ = ]]; then
            continue
        fi

        key="${line%%=*}"
        value="${line#*=}"

        key="$(printf '%s' "$key" | xargs)"
        value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

        if [ -z "$key" ]; then
            continue
        fi

        if [[ "$value" =~ ^\".*\"$ ]]; then
            value="${value:1:${#value}-2}"
        elif [[ "$value" =~ ^\'.*\'$ ]]; then
            value="${value:1:${#value}-2}"
        fi

        export "$key=$value"
    done < "$SCRIPT_DIR/.env"
fi

CONDA_BASE=$(conda info --base 2>/dev/null || echo "/opt/conda")

# Port configuration — SAM3 + SAM3D persistent servers
SAM3_PORT_GPU0="${SAM3_SERVER_PORT_GPU0:-5561}"
SAM3_PORT_GPU1="${SAM3_SERVER_PORT_GPU1:-5571}"
SAM3D_PORT_GPU0="${SAM3D_SERVER_PORT_GPU0:-5562}"
SAM3D_PORT_GPU1="${SAM3D_SERVER_PORT_GPU1:-5572}"

ALL_PORTS="$SAM3_PORT_GPU0 $SAM3_PORT_GPU1 $SAM3D_PORT_GPU0 $SAM3D_PORT_GPU1"

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
    local sam3_ok=$?
    wait_for_server "$SAM3D_PORT_GPU0" "SAM3D@GPU0" 180
    local sam3d_ok=$?
    [ $sam3_ok -eq 0 ] && [ $sam3d_ok -eq 0 ]
    return $?
}

wait_gpu1() {
    wait_for_server "$SAM3_PORT_GPU1" "SAM3@GPU1" 120
    local sam3_ok=$?
    wait_for_server "$SAM3D_PORT_GPU1" "SAM3D@GPU1" 180
    local sam3d_ok=$?
    [ $sam3_ok -eq 0 ] && [ $sam3d_ok -eq 0 ]
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
        echo "  Starting SAM3 + SAM3D Persistent Servers"
        echo "  GPU 0: SAM3 (:$SAM3_PORT_GPU0) + SAM3D (:$SAM3D_PORT_GPU0)"
        echo "  GPU 1: SAM3 (:$SAM3_PORT_GPU1) + SAM3D (:$SAM3D_PORT_GPU1)"
        echo "=========================================="

        # Stop existing servers first
        stop_servers 2>/dev/null || true
        sleep 1

        # Start all servers (SAM3 + SAM3D on each GPU)
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
            echo "  ✅ All servers are ready!"
            echo "  GPU 0: SAM3 + SAM3D → real/photo"
            echo "  GPU 1: SAM3 + SAM3D → fictional"
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
