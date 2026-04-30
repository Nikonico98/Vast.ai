#!/bin/bash
# ==========================================
# Socat 端口转发：1111 → 5555
# ==========================================
#
# 问题：GPU Service 监听在 5555，但 Vast.ai 没有把 5555 暴露到外网。
# 解决：用 socat 将 Vast.ai 已暴露的 1111 端口转发到本地 5555。
#
# Problem: GPU Service listens on port 5555, but Vast.ai doesn't expose 5555 externally.
# Solution: Use socat to forward the exposed port 1111 → localhost:5555.
#
# 用法 / Usage:
#   bash socat_port_forward.sh          # 启动转发 / Start forwarding
#   bash socat_port_forward.sh stop     # 停止转发 / Stop forwarding
#   bash socat_port_forward.sh status   # 检查状态 / Check status
# ==========================================

LISTEN_PORT="${SOCAT_LISTEN_PORT:-1111}"
TARGET_PORT="${SOCAT_TARGET_PORT:-5555}"

case "${1:-start}" in
    start)
        # 安装 socat（如果尚未安装）
        if ! command -v socat &>/dev/null; then
            echo "📦 Installing socat..."
            apt-get install -y socat 2>/dev/null
        fi

        # 停止已有的 socat 转发，强制释放端口
        pkill -f "socat TCP-LISTEN:${LISTEN_PORT}" 2>/dev/null
        # Force-release the port in case another process holds it
        fuser -k "${LISTEN_PORT}/tcp" 2>/dev/null || true
        sleep 1

        # 启动转发
        socat TCP-LISTEN:${LISTEN_PORT},fork,reuseaddr TCP:127.0.0.1:${TARGET_PORT} &
        SOCAT_PID=$!
        echo "✅ socat started: port ${LISTEN_PORT} → ${TARGET_PORT} (PID: ${SOCAT_PID})"
        ;;

    stop)
        pkill -f "socat TCP-LISTEN:${LISTEN_PORT}" 2>/dev/null
        echo "🛑 socat stopped (port ${LISTEN_PORT} forwarding)"
        ;;

    status)
        if pgrep -f "socat TCP-LISTEN:${LISTEN_PORT}" &>/dev/null; then
            PID=$(pgrep -f "socat TCP-LISTEN:${LISTEN_PORT}")
            echo "✅ socat is running (PID: ${PID}) — port ${LISTEN_PORT} → ${TARGET_PORT}"
        else
            echo "⚪ socat is NOT running"
        fi
        ;;

    *)
        echo "Usage: $0 {start|stop|status}"
        exit 1
        ;;
esac
