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
  }

  /**
   * Initialize the GPU manager
   */
  async init() {
    console.log("🖥️ Initializing GPU Manager...");

    // Initial status fetch
    await this.refreshGPUStatus();

    // Set up event listeners for mode selection
    this.setupEventListeners();

    // Start periodic refresh (every 10 seconds)
    this.refreshInterval = setInterval(() => {
      this.refreshGPUStatus();
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
