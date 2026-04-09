#!/bin/bash
# ==========================================
# Caddy GPU API Proxy — Persistent Setup
# ==========================================
# Injects a :8080 → localhost:5555 reverse proxy block into Caddy
# for the GPU API, surviving Caddy restarts by hooking into the
# Vast.ai supervisor script.
#
# Vast.ai's Caddy supervisor (caddy.sh) regenerates /etc/Caddyfile
# on every restart via caddy_config_manager.py. Manual edits are lost.
#
# This script:
#   1. Writes the GPU API block to /etc/caddy_gpu_api.conf
#   2. Patches /opt/supervisor-scripts/caddy.sh to append our block
#      after every config regeneration (idempotent — safe to re-run)
#   3. Injects into the current Caddyfile immediately
#   4. Reloads Caddy via the admin API
#
# Port 8080 is safe to use because:
#   - Jupyter actually listens on 127.0.0.1:18080 (not 8080)
#   - Vast.ai's caddy_config_manager does NOT generate a :8080 block
#   - External port 8080 is mapped but currently unused
#
# Usage:
#   bash caddy_gpu_proxy.sh          # Setup + inject
#   bash caddy_gpu_proxy.sh remove   # Remove our block + unpatch
# ==========================================

set -e

GPU_API_PORT="${GPU_SERVICE_PORT:-5555}"
CADDY_CONF="/etc/caddy_gpu_api.conf"
CADDY_SH="/opt/supervisor-scripts/caddy.sh"
CADDYFILE="/etc/Caddyfile"
MARKER="# === IW_GPU_API_PROXY ==="

# ==========================================
# GPU API Caddy block
# ==========================================
write_gpu_conf() {
    cat > "$CADDY_CONF" << CONF
$MARKER
:8080 {
	encode zstd gzip

	@cors_preflight method OPTIONS
	handle @cors_preflight {
		header Access-Control-Allow-Origin "*"
		header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
		header Access-Control-Allow-Headers "Content-Type, X-GPU-API-Key, X-API-Secret, Authorization"
		header Access-Control-Max-Age "86400"
		respond 204
	}

	handle {
		header Access-Control-Allow-Origin "*"
		header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
		header Access-Control-Allow-Headers "Content-Type, X-GPU-API-Key, X-API-Secret, Authorization"

		reverse_proxy localhost:${GPU_API_PORT} {
			header_up X-Real-IP {remote_host}
			header_up X-Forwarded-Proto {scheme}
			flush_interval -1
		}
	}
}
$MARKER
CONF
    echo "  ✅ Wrote GPU API Caddy config to $CADDY_CONF"
}

# ==========================================
# Patch caddy.sh to auto-append our block
# ==========================================
patch_caddy_sh() {
    if ! [ -f "$CADDY_SH" ]; then
        echo "  ⚠️  $CADDY_SH not found — skipping patch"
        return 1
    fi

    if grep -q "caddy_gpu_api.conf" "$CADDY_SH"; then
        echo "  ✅ caddy.sh already patched"
        return 0
    fi

    # Insert our append line right after caddy_config_manager.py runs,
    # before the Caddyfile existence check.
    sed -i '/\/opt\/portal-aio\/venv\/bin\/python caddy_config_manager.py/a\
\
# --- IW GPU API proxy (auto-appended) ---\
if [ -f /etc/caddy_gpu_api.conf ] && [ -f /etc/Caddyfile ]; then\
    if ! grep -q "IW_GPU_API_PROXY" /etc/Caddyfile 2>/dev/null; then\
        cat /etc/caddy_gpu_api.conf >> /etc/Caddyfile\
    fi\
fi\
# --- end IW GPU API proxy ---' "$CADDY_SH"

    echo "  ✅ Patched caddy.sh to auto-append GPU API block"
}

# ==========================================
# Inject into current Caddyfile immediately
# ==========================================
inject_now() {
    if ! [ -f "$CADDYFILE" ]; then
        echo "  ⚠️  $CADDYFILE not found — skipping injection"
        return 1
    fi

    if grep -q "IW_GPU_API_PROXY" "$CADDYFILE"; then
        echo "  ✅ GPU API block already in Caddyfile"
        return 0
    fi

    cat "$CADDY_CONF" >> "$CADDYFILE"
    echo "  ✅ Injected GPU API block into Caddyfile"

    # Format
    /opt/portal-aio/caddy_manager/caddy fmt --overwrite "$CADDYFILE" 2>/dev/null || true
}

# ==========================================
# Reload Caddy
# ==========================================
reload_caddy() {
    # Use Caddy admin API to reload without downtime
    local result
    result=$(curl -s localhost:2019/load \
        -X POST \
        -H "Content-Type: text/caddyfile" \
        --data-binary @"$CADDYFILE" 2>&1)

    if echo "$result" | grep -qi "error"; then
        echo "  ⚠️  Caddy reload returned: $result"
        echo "  Trying caddy reload command..."
        /opt/portal-aio/caddy_manager/caddy reload --config "$CADDYFILE" 2>/dev/null || true
    else
        echo "  ✅ Caddy reloaded successfully"
    fi
}

# ==========================================
# Remove our changes
# ==========================================
remove_gpu_proxy() {
    echo "Removing GPU API proxy..."

    # Remove from Caddyfile
    if [ -f "$CADDYFILE" ]; then
        sed -i "/$MARKER/,/$MARKER/d" "$CADDYFILE"
        echo "  Removed block from Caddyfile"
    fi

    # Unpatch caddy.sh
    if [ -f "$CADDY_SH" ]; then
        sed -i '/--- IW GPU API proxy/,/--- end IW GPU API proxy ---/d' "$CADDY_SH"
        echo "  Unpatched caddy.sh"
    fi

    # Remove conf file
    rm -f "$CADDY_CONF"
    echo "  Removed $CADDY_CONF"

    reload_caddy
    echo "  ✅ GPU API proxy removed"
}

# ==========================================
# Main
# ==========================================
case "${1:-setup}" in
    remove|clean)
        remove_gpu_proxy
        ;;
    setup|"")
        echo "🔧 Setting up Caddy GPU API proxy (:8080 → localhost:${GPU_API_PORT})..."
        write_gpu_conf
        patch_caddy_sh
        inject_now
        reload_caddy
        echo "  🎯 External access: http://<PUBLIC_IP>:<MAPPED_8080_PORT>/api/gpu/health"
        ;;
    *)
        echo "Usage: $0 [setup|remove]"
        exit 1
        ;;
esac
