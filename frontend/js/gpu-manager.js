/**
 * GPU Manager Module
 * ==================
 * Manages GPU status detection and mode selection for multi-GPU parallel processing.
 *
 * Features:
 * - Real-time GPU status monitoring
 * - Mode switching (parallel/sequential)
 * - Dynamic UI updates
 */

class GPUManager {
  constructor() {
    this.gpus = [];
    this.mode = "parallel";
    this.totalGpus = 0;
    this.availableGpus = 0;
    this.refreshInterval = null;
    this.instanceStatus = "unknown";
    this.instanceConfigured = false;
  }

  /**
   * Initialize the GPU manager
   */
  async init() {
    console.log("🖥️ Initializing GPU Manager...");

    // Initial status fetch
    await Promise.all([
      this.refreshGPUStatus(),
      this.refreshInstanceStatus(),
      this.refreshServicesStatus(),
    ]);

    // Set up event listeners for mode selection
    this.setupEventListeners();

    // Start periodic refresh (every 10 seconds)
    this.refreshInterval = setInterval(() => {
      this.refreshGPUStatus();
      this.refreshInstanceStatus();
      this.refreshServicesStatus();
    }, 10000);

    console.log("✅ GPU Manager initialized");
  }

  /**
   * Set up event listeners for UI controls
   */
  setupEventListeners() {
    // GPU panel collapse toggle
    const toggleHeader = document.getElementById("gpu-panel-toggle");
    if (toggleHeader) {
      toggleHeader.addEventListener("click", () => {
        const panel = toggleHeader.closest(".gpu-panel");
        if (panel) panel.classList.toggle("collapsed");
      });
    }

    const parallelRadio = document.getElementById("gpu-mode-parallel");
    const sequentialRadio = document.getElementById("gpu-mode-sequential");

    if (parallelRadio) {
      parallelRadio.addEventListener("change", (e) => {
        if (e.target.checked) {
          this.setMode("parallel");
        }
      });
    }

    if (sequentialRadio) {
      sequentialRadio.addEventListener("change", (e) => {
        if (e.target.checked) {
          this.setMode("sequential");
        }
      });
    }

    // Instance control buttons
    const btnStart = document.getElementById("btn-instance-start");
    const btnStop = document.getElementById("btn-instance-stop");
    const btnRestart = document.getElementById("btn-services-restart");

    if (btnStart) {
      btnStart.addEventListener("click", () => this.startInstance());
    }
    if (btnStop) {
      btnStop.addEventListener("click", () => this.stopInstance());
    }
    if (btnRestart) {
      btnRestart.addEventListener("click", () => this.restartServices());
    }
  }

  /**
   * Fetch current GPU status from backend
   */
  async refreshGPUStatus() {
    try {
      const response = await fetch("/api/gpu/status");
      const data = await response.json();

      if (data.success) {
        this.gpus = data.gpus || [];
        this.mode = data.mode || "parallel";
        this.totalGpus = data.total_gpus || 0;
        this.availableGpus = data.available_gpus || 0;

        this.updateUI();
      } else {
        console.error("Failed to get GPU status:", data.error);
        this.showError("GPU status unavailable");
      }
    } catch (error) {
      console.error("Error fetching GPU status:", error);
      this.showError("Cannot connect to backend");
    }
  }

  /**
   * Set GPU operation mode
   * @param {string} mode - 'parallel' or 'sequential'
   */
  async setMode(mode) {
    try {
      const response = await fetch("/api/gpu/mode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode }),
      });

      const data = await response.json();

      if (data.success) {
        this.mode = data.mode;
        console.log(`✅ GPU mode set to: ${this.mode}`);
        this.updateUI();
      } else {
        console.error("Failed to set GPU mode:", data.error);
        // Revert radio button
        this.updateModeRadios();
      }
    } catch (error) {
      console.error("Error setting GPU mode:", error);
      this.updateModeRadios();
    }
  }

  /**
   * Update the UI with current GPU status
   */
  updateUI() {
    this.updateModeRadios();
    this.updateGPUGrid();
    this.updateStatusSummary();
  }

  /**
   * Update mode radio buttons
   */
  updateModeRadios() {
    const parallelRadio = document.getElementById("gpu-mode-parallel");
    const sequentialRadio = document.getElementById("gpu-mode-sequential");

    if (parallelRadio && sequentialRadio) {
      parallelRadio.checked = this.mode === "parallel";
      sequentialRadio.checked = this.mode === "sequential";
    }
  }

  /**
   * Update GPU grid display
   */
  updateGPUGrid() {
    const gpuGrid = document.getElementById("gpu-grid");
    if (!gpuGrid) return;

    if (this.gpus.length === 0) {
      gpuGrid.innerHTML = `
                <div class="gpu-card gpu-unavailable">
                    <div class="gpu-icon">⚠️</div>
                    <div class="gpu-name">No GPUs Detected</div>
                    <div class="gpu-status">Check nvidia-smi</div>
                </div>
            `;
      return;
    }

    gpuGrid.innerHTML = this.gpus
      .map(
        (gpu) => `
            <div class="gpu-card gpu-${gpu.status}">
                <div class="gpu-icon">${
                  gpu.status === "idle" ? "🟢" : "🔴"
                }</div>
                <div class="gpu-id">GPU ${gpu.id}</div>
                <div class="gpu-name">${gpu.name}</div>
                <div class="gpu-memory">
                    ${Math.round(gpu.free_memory_mb / 1024)}GB / ${Math.round(
          gpu.total_memory_mb / 1024
        )}GB
                </div>
                <div class="gpu-utilization">
                    <div class="gpu-util-bar" style="width: ${
                      gpu.utilization
                    }%"></div>
                    <span>${gpu.utilization}%</span>
                </div>
            </div>
        `
      )
      .join("");
  }

  /**
   * Update status summary text
   */
  updateStatusSummary() {
    const summaryEl = document.getElementById("gpu-status-summary");
    if (!summaryEl) return;

    if (this.totalGpus === 0) {
      summaryEl.textContent = "No GPUs available";
      summaryEl.className = "gpu-status-summary status-error";
    } else {
      summaryEl.textContent = `${this.availableGpus}/${this.totalGpus} GPUs available`;
      summaryEl.className = `gpu-status-summary ${
        this.availableGpus > 0 ? "status-ok" : "status-busy"
      }`;
    }
  }

  /**
   * Show error state in UI
   * @param {string} message - Error message
   */
  showError(message) {
    const gpuGrid = document.getElementById("gpu-grid");
    if (gpuGrid) {
      gpuGrid.innerHTML = `
                <div class="gpu-card gpu-error">
                    <div class="gpu-icon">❌</div>
                    <div class="gpu-name">Error</div>
                    <div class="gpu-status">${message}</div>
                </div>
            `;
    }

    const summaryEl = document.getElementById("gpu-status-summary");
    if (summaryEl) {
      summaryEl.textContent = message;
      summaryEl.className = "gpu-status-summary status-error";
    }
  }

  // ==========================================
  // Vast.ai Instance Management
  // ==========================================

  /**
   * Fetch Vast.ai instance status
   */
  async refreshInstanceStatus() {
    try {
      const response = await fetch("/api/gpu/instance/status");
      const data = await response.json();

      this.instanceConfigured = data.configured || false;
      this.instanceProvider = data.provider || "unknown";

      if (!data.configured) {
        this.instanceStatus = "not-configured";
        this.updateInstanceUI();
        return;
      }

      if (data.success) {
        this.instanceStatus = data.status || "unknown";
        this.instanceGpuName = data.gpu_name || "";
        this.instanceNumGpus = data.num_gpus || 0;
        this.instanceCost = data.dph_total || 0;
        this.instanceDisk = data.disk_space || 0;
        this.instanceDiskUsage = data.disk_usage || 0;
        this.updateInstanceUI();
      } else {
        this.instanceStatus = "error";
        this.showInstanceError(data.error || "Failed to get status");
      }
    } catch (error) {
      console.error("Error fetching instance status:", error);
      this.instanceStatus = "error";
      this.updateInstanceUI();
    }
  }

  /**
   * Fetch SAM3/SAM3D service status
   */
  async refreshServicesStatus() {
    try {
      const response = await fetch("/api/gpu/services/status");
      const data = await response.json();

      const sam3El = document.getElementById("sam3-status");
      const sam3dEl = document.getElementById("sam3d-status");

      if (data.worker_reachable) {
        const sam3Ready = data.sam3?.ready || data.sam3?.loaded;
        const sam3dReady = data.sam3d?.ready || data.sam3d?.loaded;

        if (sam3El) {
          sam3El.className = `service-status-dot ${sam3Ready ? "status-ready" : "status-loading"}`;
          sam3El.title = sam3Ready ? "Ready" : "Loading/Not ready";
        }
        if (sam3dEl) {
          sam3dEl.className = `service-status-dot ${sam3dReady ? "status-ready" : "status-loading"}`;
          sam3dEl.title = sam3dReady ? "Ready" : "Loading/Not ready";
        }
      } else {
        if (sam3El) {
          sam3El.className = "service-status-dot status-offline";
          sam3El.title = "Worker unreachable";
        }
        if (sam3dEl) {
          sam3dEl.className = "service-status-dot status-offline";
          sam3dEl.title = "Worker unreachable";
        }
      }
    } catch (error) {
      console.error("Error fetching services status:", error);
    }
  }

  /**
   * Update instance control UI
   */
  updateInstanceUI() {
    const badge = document.getElementById("instance-status-badge");
    const gpuName = document.getElementById("instance-gpu-name");
    const cost = document.getElementById("instance-cost");
    const btnStart = document.getElementById("btn-instance-start");
    const btnStop = document.getElementById("btn-instance-stop");
    const btnRestart = document.getElementById("btn-services-restart");

    if (!badge) return;

    // Update panel title with provider name
    const titleEl = document.querySelector(".instance-section .instance-title, .instance-header .instance-title");
    if (titleEl) {
      const providerName = this.instanceProvider === "runpod" ? "RunPod" : this.instanceProvider === "vastai" ? "Vast.ai" : "GPU";
      titleEl.textContent = `${providerName} Instance`;
    }

    if (!this.instanceConfigured) {
      badge.textContent = "Not Configured";
      badge.className = "instance-status-badge status-unknown";
      if (gpuName) gpuName.textContent = "Set GPU credentials in .env (RunPod or Vast.ai)";
      if (cost) cost.textContent = "";
      if (btnStart) btnStart.disabled = true;
      if (btnStop) btnStop.disabled = true;
      if (btnRestart) btnRestart.disabled = true;
      return;
    }

    // Map status to badge class
    const statusClass = {
      running: "status-running",
      stopped: "status-stopped",
      loading: "status-loading",
      exited: "status-stopped",
    }[this.instanceStatus] || "status-unknown";

    badge.textContent = this.instanceStatus;
    badge.className = `instance-status-badge ${statusClass}`;

    if (gpuName) gpuName.textContent = this.instanceGpuName
      ? `${this.instanceGpuName} × ${this.instanceNumGpus || 1}`
      : "--";
    if (cost) cost.textContent = this.instanceCost
      ? `$${this.instanceCost.toFixed(3)}/hr | Disk: ${Math.round(this.instanceDiskUsage || 0)}/${Math.round(this.instanceDisk || 0)} GB`
      : "--";

    // Enable/disable buttons based on state
    const isRunning = this.instanceStatus === "running";
    const isStopped = this.instanceStatus === "stopped" || this.instanceStatus === "exited";

    if (btnStart) btnStart.disabled = !isStopped;
    if (btnStop) btnStop.disabled = !isRunning;
    if (btnRestart) btnRestart.disabled = !isRunning;
  }

  /**
   * Start Vast.ai instance
   */
  async startInstance() {
    const btn = document.getElementById("btn-instance-start");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Starting..."; }
    this.hideInstanceError();

    try {
      const response = await fetch("/api/gpu/instance/start", { method: "POST" });
      const data = await response.json();

      if (data.success) {
        this.instanceStatus = "loading";
        this.updateInstanceUI();
        // Poll more frequently while starting
        setTimeout(() => this.refreshInstanceStatus(), 5000);
      } else {
        this.showInstanceError(data.error || "Failed to start");
      }
    } catch (error) {
      this.showInstanceError("Network error: " + error.message);
    } finally {
      if (btn) btn.textContent = "▶ Start Instance";
    }
  }

  /**
   * Stop Vast.ai instance
   */
  async stopInstance() {
    if (!confirm("Stop the GPU instance? This will interrupt any running 3D jobs.")) return;

    const btn = document.getElementById("btn-instance-stop");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Stopping..."; }
    this.hideInstanceError();

    try {
      const response = await fetch("/api/gpu/instance/stop", { method: "POST" });
      const data = await response.json();

      if (data.success) {
        this.instanceStatus = "stopped";
        this.updateInstanceUI();
      } else {
        this.showInstanceError(data.error || "Failed to stop");
      }
    } catch (error) {
      this.showInstanceError("Network error: " + error.message);
    } finally {
      if (btn) btn.textContent = "⏹ Stop Instance";
    }
  }

  /**
   * Restart SAM3/SAM3D services
   */
  async restartServices() {
    const btn = document.getElementById("btn-services-restart");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Restarting..."; }
    this.hideInstanceError();

    try {
      const response = await fetch("/api/gpu/services/restart", { method: "POST" });
      const data = await response.json();

      if (data.success) {
        // Refresh after a short delay
        setTimeout(() => this.refreshServicesStatus(), 3000);
      } else {
        this.showInstanceError(data.error || "Failed to restart services");
      }
    } catch (error) {
      this.showInstanceError("Network error: " + error.message);
    } finally {
      if (btn) btn.textContent = "🔄 Restart SAM3/3D";
    }
  }

  showInstanceError(msg) {
    const el = document.getElementById("instance-error");
    if (el) { el.textContent = msg; el.classList.remove("hidden"); }
  }

  hideInstanceError() {
    const el = document.getElementById("instance-error");
    if (el) el.classList.add("hidden");
  }

  /**
   * Clean up (stop refresh interval)
   */
  destroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

// Create global instance
const gpuManager = new GPUManager();

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  gpuManager.init();
});

// Export for module usage
if (typeof module !== "undefined" && module.exports) {
  module.exports = { GPUManager, gpuManager };
}
