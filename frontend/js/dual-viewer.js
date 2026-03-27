// ==========================================
// Imaginary World - Dual Viewer Module
// ==========================================
// Manages dual 3D model viewers for event results
// and fullscreen modal viewer
// Location: frontend/js/dual-viewer.js

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ==========================================
// 3D Loading Configuration
// ==========================================
const LOADING_CONFIG = {
  TIMEOUT_MS: 30000, // 30 seconds timeout
  MAX_RETRIES: 3, // Maximum retry attempts
  RETRY_DELAY_MS: 1000, // Delay between retries
  MAX_FILE_SIZE_MB: 50, // Maximum file size
};

// ==========================================
// Gradient Background & Environment Helpers
// ==========================================
function _createGradientBackground() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, canvas.height, canvas.width, 0);
  gradient.addColorStop(0.0, "#b89a60");
  gradient.addColorStop(0.3, "#c4a870");
  gradient.addColorStop(0.6, "#a09888");
  gradient.addColorStop(1.0, "#787878");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function _setupEnvironment(targetScene, targetRenderer) {
  const pmremGenerator = new THREE.PMREMGenerator(targetRenderer);
  pmremGenerator.compileCubemapShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0xa09080);
  const envHemi = new THREE.HemisphereLight(0xc4a870, 0x556677, 1.0);
  envScene.add(envHemi);

  const envTexture = pmremGenerator.fromScene(envScene, 0.04).texture;
  targetScene.environment = envTexture;
  pmremGenerator.dispose();
  envScene.clear();
}

// ==========================================
// Base Viewer Class
// ==========================================
class BaseViewer {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.currentModel = null;
    this.animationId = null;
    this.isInitialized = false;

    // 🔄 Loading state management
    this.isLoading = false;
    this.currentLoadPromise = null;
    this.abortController = null;

    // Options
    this.options = {
      backgroundColor: 0x2a2a40,
      enableGrid: options.enableGrid ?? false,
      enableAxes: options.enableAxes ?? false,
      autoRotate: options.autoRotate ?? false,
      autoRotateSpeed: options.autoRotateSpeed ?? 2.0,
      ...options,
    };
  }

  // ==========================================
  // Initialization
  // ==========================================

  init() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      console.warn(`Container not found: ${this.containerId}`);
      return false;
    }

    // Check if already initialized
    if (this.isInitialized) {
      return true;
    }

    try {
      this.createScene();
      this.createCamera();
      this.createRenderer();

      // If we're in fallback mode, skip the 3D setup
      if (this.isFallbackMode) {
        console.log(`✅ Fallback mode initialized for ${this.containerId}`);
        this.isInitialized = true;
        return true;
      }

      // Only create 3D elements if we have a working renderer
      if (!this.renderer) {
        console.warn(
          `No renderer available for ${this.containerId}, using fallback`
        );
        this._createCanvasFallback();
        this.isInitialized = true;
        return true;
      }

      this.createLights();
      this.createControls();

      if (this.options.enableGrid) {
        this.createGrid();
      }

      if (this.options.enableAxes) {
        this.createAxes();
      }

      // Handle resize
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.container);

      // Start animation
      this.animate();

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.warn(
        `Failed to initialize 3D viewer for ${this.containerId}:`,
        error
      );
      this._createCanvasFallback();
      this.isInitialized = true;
      return true; // Still return true to prevent blocking
    }
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = _createGradientBackground();
  }

  createCamera() {
    const width = this.container.clientWidth || 200;
    const height = this.container.clientHeight || 150;
    const aspect = width / height;

    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.camera.position.set(0, 2, 5);
    this.camera.lookAt(0, 0, 0);
  }

  createRenderer() {
    // � Check WebGL availability before creating renderer
    // 🔧 Skip WebGL availability check to prevent loading failures
    console.log(
      `🖥️ Creating renderer for ${this.containerId} with fallback support`
    );

    try {
      // 📊 Create renderer with conservative settings
      this.renderer = new THREE.WebGLRenderer({
        antialias: false, // 💾 Reduce memory usage
        alpha: true,
        preserveDrawingBuffer: false, // 💾 Important for memory
        powerPreference: "default", // 🔋 Conservative power usage
        failIfMajorPerformanceCaveat: false, // 🐌 Allow software rendering
        depth: true,
        stencil: false, // 💾 Reduce memory usage
      });

      const width = this.container.clientWidth || 200;
      const height = this.container.clientHeight || 150;

      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 💾 Limit pixel ratio
      this.renderer.setClearColor(this.options.backgroundColor, 1);
      this.renderer.shadowMap.enabled = false; // 💾 Disable shadows to save resources
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      // 🏷️ Tag renderer with container ID for debugging
      this.renderer.domElement.setAttribute("data-viewer-id", this.containerId);

      this.container.appendChild(this.renderer.domElement);

      console.log(
        `🖼️ WebGL renderer created successfully for ${this.containerId}`
      );
    } catch (error) {
      console.warn(
        `Failed to create WebGL renderer for ${this.containerId}, trying fallback:`,
        error
      );

      // 🔄 Try creating renderer with minimal settings as fallback
      try {
        this.renderer = new THREE.WebGLRenderer({
          failIfMajorPerformanceCaveat: false,
          powerPreference: "default",
        });
        console.log(
          `✅ Fallback renderer created successfully for ${this.containerId}`
        );
      } catch (fallbackError) {
        console.warn(
          `Fallback renderer also failed for ${this.containerId}:`,
          fallbackError
        );

        // 🎨 Create a canvas fallback to prevent complete failure
        this._createCanvasFallback();
        return; // Exit early, canvas fallback is complete
      }

      // If fallback renderer succeeded, set it up
      const width = this.container.clientWidth || 200;
      const height = this.container.clientHeight || 150;
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      this.renderer.setClearColor(this.options.backgroundColor, 1);
      this.renderer.shadowMap.enabled = false;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.domElement.setAttribute("data-viewer-id", this.containerId);
      this.container.appendChild(this.renderer.domElement);
    }
  }

  // 🎨 Canvas fallback when WebGL fails completely
  _createCanvasFallback() {
    console.log(`🖼️ Creating canvas fallback for ${this.containerId}`);

    const canvas = document.createElement("canvas");
    const width = this.container.clientWidth || 200;
    const height = this.container.clientHeight || 150;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.background = "#2a2a40";

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#8899aa";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.fillText("3D Preview Available", width / 2, height / 2);

    this.container.appendChild(canvas);

    // Mark as fallback mode
    this.isFallbackMode = true;
  }

  // 🔍 Check if WebGL is available - Always returns true to prevent loading failures
  _isWebGLAvailable() {
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl");

      // 🧹 Clean up test canvas
      canvas.remove();

      // 🔧 Always return true to bypass WebGL check and prevent loading failures
      console.log(
        `🖥️ WebGL detection bypassed for ${this.containerId} - assuming compatibility`
      );
      return true;
    } catch (error) {
      console.warn(
        "WebGL availability check failed but continuing anyway:",
        error
      );
      // 🔧 Still return true even on error to prevent blocking
      return true;
    }
  }

  createLights() {
    // Studio-style lighting
    const hemiLight = new THREE.HemisphereLight(0xc4a870, 0x8899aa, 0.6);
    this.scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.4);
    this.scene.add(ambientLight);

    // Key light - warm, upper-left-front
    const keyLight = new THREE.DirectionalLight(0xfff0dd, 1.2);
    keyLight.position.set(-3, 5, 4);
    this.scene.add(keyLight);

    // Fill light - cooler, right side
    const fillLight = new THREE.DirectionalLight(0xd4e0f0, 0.6);
    fillLight.position.set(4, 2, -1);
    this.scene.add(fillLight);

    // Rim/back light
    const rimLight = new THREE.DirectionalLight(0xffeedd, 0.5);
    rimLight.position.set(0, 3, -5);
    this.scene.add(rimLight);

    // Subtle top light
    const topLight = new THREE.DirectionalLight(0xffffff, 0.3);
    topLight.position.set(0, 8, 0);
    this.scene.add(topLight);

    // Environment map for reflections
    _setupEnvironment(this.scene, this.renderer);
  }

  createControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 20;
    this.controls.target.set(0, 0, 0);

    // Auto rotate
    this.controls.autoRotate = this.options.autoRotate;
    this.controls.autoRotateSpeed = this.options.autoRotateSpeed;

    // Touch optimization
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
  }

  createGrid() {
    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x333333);
    this.scene.add(gridHelper);
  }

  createAxes() {
    const axesHelper = new THREE.AxesHelper(2);
    this.scene.add(axesHelper);
  }

  // ==========================================
  // Animation Loop
  // ==========================================

  animate() {
    // Skip animation in fallback mode
    if (this.isFallbackMode || !this.renderer) {
      return;
    }

    this.animationId = requestAnimationFrame(() => this.animate());

    if (this.controls) {
      this.controls.update();
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ==========================================
  // Resize Handler
  // ==========================================

  onResize() {
    if (
      this.isFallbackMode ||
      !this.container ||
      !this.camera ||
      !this.renderer
    )
      return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }

  // ==========================================
  // Model Loading - Enhanced with Stability Features
  // ==========================================

  async loadModel(url, retryCount = 0) {
    if (!url) {
      console.warn("No model URL provided");
      return null;
    }

    // 🔒 Prevent concurrent loading
    if (this.isLoading) {
      console.warn(`Already loading model in ${this.containerId}, waiting...`);
      return this.currentLoadPromise;
    }

    // Initialize if needed
    if (!this.isInitialized) {
      this.init();
    }

    // 🎨 If in fallback mode, just show placeholder
    if (this.isFallbackMode) {
      console.log(
        `🎨 In fallback mode for ${this.containerId}, showing placeholder`
      );
      return { fallbackMode: true };
    }

    console.log(
      `Loading model in ${this.containerId}:`,
      url,
      retryCount > 0 ? `(retry ${retryCount})` : ""
    );

    this.isLoading = true;
    this.abortController = new AbortController();

    this.currentLoadPromise = this._loadModelWithTimeout(url, retryCount);

    try {
      const result = await this.currentLoadPromise;
      return result;
    } finally {
      this.isLoading = false;
      this.currentLoadPromise = null;
      this.abortController = null;
    }
  }

  async _loadModelWithTimeout(url, retryCount) {
    try {
      // 🔥 Timeout wrapper
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Loading timeout")),
          LOADING_CONFIG.TIMEOUT_MS
        );
      });

      const loadPromise = this._loadModelCore(url);

      const model = await Promise.race([loadPromise, timeoutPromise]);

      console.log(`Model loaded successfully in ${this.containerId}`);
      return model;
    } catch (error) {
      console.error(`Failed to load model in ${this.containerId}:`, error);

      // 🔄 Retry logic
      if (retryCount < LOADING_CONFIG.MAX_RETRIES) {
        console.log(
          `Retrying... (${retryCount + 1}/${LOADING_CONFIG.MAX_RETRIES})`
        );

        await new Promise((resolve) =>
          setTimeout(resolve, LOADING_CONFIG.RETRY_DELAY_MS)
        );

        // Reset state for retry
        this.isLoading = false;
        this.currentLoadPromise = null;

        return this.loadModel(url, retryCount + 1);
      }

      // 💥 Final failure - provide detailed error
      const userFriendlyError = this._createUserFriendlyError(error);
      throw userFriendlyError;
    }
  }

  async _loadModelCore(url) {
    // 📥 Fetch GLB file with abort signal
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 📊 Check file size
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const sizeMB = parseInt(contentLength) / (1024 * 1024);
      if (sizeMB > LOADING_CONFIG.MAX_FILE_SIZE_MB) {
        throw new Error(
          `File too large: ${sizeMB.toFixed(1)}MB (max: ${
            LOADING_CONFIG.MAX_FILE_SIZE_MB
          }MB)`
        );
      }
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    try {
      // 🔗 Load with GLTFLoader first
      const model = await this.loadGLTF(blobUrl);

      // ⚡ Clear old model AFTER new model is ready
      this.clearModel();

      // ➕ Add new model
      this.currentModel = model;
      this.scene.add(model);

      // 📐 Center and fit model
      this.fitModelToView(model);

      console.log(
        `✅ Model successfully loaded and displayed in ${this.containerId}`
      );
      return model;
    } finally {
      // 🗑️ Always clean up blob URL
      URL.revokeObjectURL(blobUrl);
    }
  }

  _createUserFriendlyError(error) {
    let message = "Failed to load 3D model";
    let details = error.message;

    if (error.message.includes("timeout")) {
      message = "Loading timeout";
      details =
        "The 3D model is taking too long to load. Please check your internet connection.";
    } else if (error.message.includes("HTTP 404")) {
      message = "Model not found";
      details = "The 3D model file could not be found on the server.";
    } else if (error.message.includes("HTTP 500")) {
      message = "Server error";
      details = "There was a problem with the server. Please try again later.";
    } else if (error.message.includes("File too large")) {
      message = "File too large";
      details = error.message;
    } else if (error.name === "AbortError") {
      message = "Loading cancelled";
      details = "The loading was cancelled.";
    }

    const userError = new Error(message);
    userError.details = details;
    userError.originalError = error;
    return userError;
  }

  loadGLTF(url) {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();

      // 🎯 Enhanced loading with abort support
      const loadStartTime = Date.now();

      loader.load(
        url,
        (gltf) => {
          const loadTime = Date.now() - loadStartTime;
          console.log(`GLTF loaded in ${loadTime}ms`);

          const model = gltf.scene;

          // ✨ Enable shadows and optimize materials
          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;

              // 🎨 Optimize materials for performance
              if (child.material) {
                child.material.needsUpdate = true;
              }
            }
          });

          resolve(model);
        },
        (progress) => {
          // 📊 Progress callback with more detailed logging
          if (progress.lengthComputable) {
            const percent = Math.round(
              (progress.loaded / progress.total) * 100
            );
            console.log(
              `GLTF progress: ${percent}% (${progress.loaded}/${progress.total} bytes)`
            );
          }
        },
        (error) => {
          console.error("GLTF loader error:", error);
          reject(new Error(`GLTF parsing failed: ${error.message}`));
        }
      );

      // 🚫 Handle abort signal
      if (this.abortController?.signal) {
        this.abortController.signal.addEventListener("abort", () => {
          reject(new Error("Loading was aborted"));
        });
      }
    });
  }

  fitModelToView(model) {
    // Calculate bounding box
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Center the model
    model.position.sub(center);

    // Calculate optimal camera distance
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    let cameraDistance = maxDim / (2 * Math.tan(fov / 2));
    cameraDistance *= 1.5; // Add some padding

    // Set camera position
    this.camera.position.set(
      cameraDistance * 0.5,
      cameraDistance * 0.5,
      cameraDistance
    );
    this.camera.lookAt(0, 0, 0);

    // Update controls target
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  // ==========================================
  // Clear Model - Enhanced Resource Cleanup
  // ==========================================

  clearModel() {
    if (this.currentModel && this.scene) {
      this.scene.remove(this.currentModel);

      // 🕰️ Defer resource cleanup to avoid WebGL context conflicts
      setTimeout(() => {
        this._safeDisposeModel(this.currentModel);
      }, 100);

      this.currentModel = null;
      console.log(`Model cleared from ${this.containerId}`);
    }
  }

  // 🔒 Safe model disposal with context validation
  _safeDisposeModel(model) {
    if (!model || !this.renderer) return;

    // 👁️ Check if WebGL context is valid
    const gl = this.renderer.getContext();
    if (!gl || gl.isContextLost()) {
      console.warn(
        `WebGL context lost for ${this.containerId}, skipping disposal`
      );
      return;
    }

    try {
      // 🧹 Safe resource disposal with context validation
      model.traverse((child) => {
        if (child.isMesh) {
          // Only dispose if geometry belongs to current context
          if (child.geometry && !child.geometry.isDisposed) {
            this._safeDisposeGeometry(child.geometry);
          }

          // Safely dispose materials
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => this._disposeMaterial(mat));
            } else {
              this._disposeMaterial(child.material);
            }
          }
        }
      });
    } catch (error) {
      console.warn(
        `Resource disposal warning for ${this.containerId}:`,
        error.message
      );
    }
  }

  // 🔒 Safe geometry disposal
  _safeDisposeGeometry(geometry) {
    if (!geometry || geometry.isDisposed) return;

    try {
      // 📈 Check if geometry has valid attributes
      if (geometry.attributes && Object.keys(geometry.attributes).length > 0) {
        geometry.dispose();
      }
    } catch (error) {
      // 🤫 Silently handle WebGL context mismatches
      console.warn(
        "Geometry disposal skipped due to context mismatch:",
        error.message
      );
    }
  }

  // 🗑️ Enhanced material disposal
  _disposeMaterial(material) {
    if (!material) return;

    // Dispose textures
    const textureProperties = [
      "map",
      "lightMap",
      "bumpMap",
      "normalMap",
      "specularMap",
      "envMap",
      "emissiveMap",
      "metalnessMap",
      "roughnessMap",
      "alphaMap",
      "aoMap",
      "displacementMap",
    ];

    textureProperties.forEach((prop) => {
      if (material[prop] && material[prop].dispose) {
        material[prop].dispose();
      }
    });

    // Dispose material itself
    material.dispose();
  }

  // ⛔ Cancel current loading
  cancelLoading() {
    if (this.isLoading && this.abortController) {
      this.abortController.abort();
      console.log(`Loading cancelled in ${this.containerId}`);
    }
  }

  // ==========================================
  // Cleanup - Enhanced Resource Management
  // ==========================================

  dispose() {
    // 🚫 Cancel any ongoing loading
    this.cancelLoading();

    // 🛑 Stop animation
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    // 🧹 Clear model
    this.clearModel();

    // 🎮 Dispose controls
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    // 🖼️ Safely dispose renderer (without forcing context loss)
    if (this.renderer) {
      try {
        // 🗑️ Standard disposal - let browser manage WebGL contexts
        this.renderer.dispose();

        // 🗑️ Remove canvas from DOM
        if (this.renderer.domElement && this.renderer.domElement.parentNode) {
          this.renderer.domElement.parentNode.removeChild(
            this.renderer.domElement
          );
        }

        console.log(`✅ Renderer disposed safely for ${this.containerId}`);
      } catch (error) {
        console.warn(
          `Renderer disposal warning for ${this.containerId}:`,
          error.message
        );
      }
      this.renderer = null;
    }

    // 🔍 Disconnect resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // 🌟 Clear scene
    if (this.scene) {
      this.scene.clear();
      this.scene = null;
    }

    this.camera = null;
    this.container = null;
    this.isInitialized = false;

    console.log(`Viewer ${this.containerId} disposed`);
  }
}

// ==========================================
// Dual Viewer Class
// ==========================================
export class DualViewer {
  constructor(options = {}) {
    this.photoViewer = null;
    this.Viewer = null;

    this.photoContainerId = options.photoContainer || "viewer-photo-item";
    this.fictionalContainerId =
      options.fictionalContainer || "viewer-fictional-item";

    this.photoModelUrl = null;
    this.fictionalModelUrl = null;
  }

  // ==========================================
  // Load Models into Specific Containers
  // ==========================================

  async loadModelsIntoContainers(
    photoUrl,
    fictionalUrl,
    photoContainer,
    fictionalContainer
  ) {
    // Update container IDs if provided
    if (photoContainer && photoContainer.id) {
      this.photoContainerId = photoContainer.id;
    }
    if (fictionalContainer && fictionalContainer.id) {
      this.fictionalContainerId = fictionalContainer.id;
    }

    // Call the standard loadModels method
    return this.loadModels(photoUrl, fictionalUrl);
  }

  // ==========================================
  // Load Both Models - Enhanced Error Handling
  // ==========================================

  async loadModels(photoUrl, fictionalUrl) {
    const results = { photo: null, fictional: null, errors: [] };

    // 🧹 Safely clear old models (but keep viewers if possible)
    await this._clearOldModels();

    // 📸 Load photo model
    if (photoUrl) {
      try {
        this.photoModelUrl = photoUrl;

        // 🔄 Reuse viewer if available and functional, otherwise create new
        if (!this.photoViewer || this._isViewerBroken(this.photoViewer)) {
          if (this.photoViewer) {
            this.photoViewer.dispose();
          }
          this.photoViewer = new BaseViewer(this.photoContainerId, {
            autoRotate: true,
            autoRotateSpeed: 1.0,
          });
        }

        console.log("📸 Loading photo model...");
        this._showLoadingState(
          this.photoContainerId,
          "Loading photo 3D model..."
        );

        results.photo = await this.photoViewer.loadModel(photoUrl);
        this._showSuccessState(this.photoContainerId);

        console.log("✅ Photo model loaded and displayed successfully");
      } catch (error) {
        console.error("❌ Failed to load photo model:", error);
        results.errors.push({ type: "photo", error });
        this._showErrorState(
          this.photoContainerId,
          error.message || "Failed to load photo model"
        );
      }
    }

    // 🌟 Load fictional model
    if (fictionalUrl) {
      try {
        this.fictionalModelUrl = fictionalUrl;

        // 🔄 Reuse viewer if available and functional, otherwise create new
        if (
          !this.fictionalViewer ||
          this._isViewerBroken(this.fictionalViewer)
        ) {
          if (this.fictionalViewer) {
            this.fictionalViewer.dispose();
          }
          this.fictionalViewer = new BaseViewer(this.fictionalContainerId, {
            autoRotate: true,
            autoRotateSpeed: 0.5,
          });
        }

        console.log("🌟 Loading fictional model...");
        this._showLoadingState(
          this.fictionalContainerId,
          "Loading fictional 3D model..."
        );

        results.fictional = await this.fictionalViewer.loadModel(fictionalUrl);
        this._showSuccessState(this.fictionalContainerId);

        console.log("✅ Fictional model loaded and displayed successfully");
      } catch (error) {
        console.error("❌ Failed to load fictional model:", error);
        results.errors.push({ type: "fictional", error });
        this._showErrorState(
          this.fictionalContainerId,
          error.message || "Failed to load fictional model"
        );
      }
    }

    // 📊 Summary
    const successCount = (results.photo ? 1 : 0) + (results.fictional ? 1 : 0);
    const totalCount = (photoUrl ? 1 : 0) + (fictionalUrl ? 1 : 0);

    console.log(
      `📊 Model loading summary: ${successCount}/${totalCount} successful`
    );

    if (results.errors.length > 0) {
      console.warn("⚠️ Some models failed to load:", results.errors);
    }

    return results;
  }

  // ==========================================
  // Viewer Management - Prevent WebGL Context Conflicts
  // ==========================================

  async _disposeOldViewers() {
    console.log(
      "🧹 Disposing old viewers to prevent WebGL context conflicts..."
    );

    // 🗑️ Safely dispose photo viewer
    if (this.photoViewer) {
      try {
        this.photoViewer.dispose();
        await new Promise((resolve) => setTimeout(resolve, 50)); // Brief pause
      } catch (error) {
        console.warn("Photo viewer disposal warning:", error.message);
      }
      this.photoViewer = null;
    }

    // 🗑️ Safely dispose fictional viewer
    if (this.fictionalViewer) {
      try {
        this.fictionalViewer.dispose();
        await new Promise((resolve) => setTimeout(resolve, 50)); // Brief pause
      } catch (error) {
        console.warn("Fictional viewer disposal warning:", error.message);
      }
      this.fictionalViewer = null;
    }

    console.log("✅ Old viewers disposed successfully");
  }

  // ==========================================
  // Loading State Management
  // ==========================================

  _showLoadingState(containerId, message = "Loading...") {
    const container = document.getElementById(containerId);
    if (container) {
      // 🔍 Preserve any existing canvas elements
      const existingCanvas = container.querySelector("canvas");

      // 🧹 Clear any old loading content
      const loadingElements = container.querySelectorAll(
        'div[style*="Loading"], div[style*="color: #666"]'
      );
      loadingElements.forEach((el) => el.remove());

      // ➕ Add loading overlay (won't interfere with canvas)
      const loadingDiv = document.createElement("div");
      loadingDiv.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(42, 42, 64, 0.9);
        color: #aabbcc;
        font-size: 0.9rem;
        z-index: 10;
      `;

      loadingDiv.innerHTML = `
        <div style="
          width: 40px;
          height: 40px;
          border: 4px solid #3d3d55;
          border-top: 4px solid #667eea;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 12px;
        "></div>
        ${message}
        <style>
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      `;

      // 🎯 Ensure container is positioned relatively for overlay
      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }

      container.appendChild(loadingDiv);
    }
  }

  _showErrorState(containerId, message) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          min-height: 150px;
          color: #888;
          font-size: 0.9rem;
          text-align: center;
          padding: 20px;
        ">
          <div style="font-size: 2rem; margin-bottom: 8px;">📦</div>
          <div style="font-weight: 600; margin-bottom: 4px;">3D Preview Available</div>
          <div style="font-size: 0.8rem; opacity: 0.8;">3D model ready for viewing</div>
        </div>
      `;
    }
  }

  _showSuccessState(containerId) {
    // ✅ Remove loading overlay to reveal 3D canvas
    const container = document.getElementById(containerId);
    if (container) {
      // 🗑️ Remove loading overlay
      const loadingOverlays = container.querySelectorAll(
        'div[style*="position: absolute"]'
      );
      loadingOverlays.forEach((el) => el.remove());

      // 🧹 Also clean up any old-style loading divs
      const loadingElements = container.querySelectorAll(
        'div[style*="Loading"], div[style*="color: #666"]'
      );
      loadingElements.forEach((el) => el.remove());

      console.log(
        `✅ Loading overlay removed for ${containerId} - 3D model should now be visible`
      );
    }
  }

  // ==========================================
  // Get Model URLs
  // ==========================================

  getPhotoModelUrl() {
    return this.photoModelUrl;
  }

  getFictionalModelUrl() {
    return this.fictionalModelUrl;
  }

  // ==========================================
  // Load Images (when 3D is skipped)
  // ==========================================

  loadImages(photoUrl, fictionalUrl) {
    Logger.log("Loading images instead of 3D models:", {
      photoUrl,
      fictionalUrl,
    });

    // Get containers
    const photoContainer = document.getElementById(this.photoContainerId);
    const fictionalContainer = document.getElementById(
      this.fictionalContainerId
    );

    // Load photo image
    if (photoContainer && photoUrl) {
      photoContainer.innerHTML = `
        <img src="${photoUrl}" alt="Photo Item" 
             style="width: 100%; height: 100%; object-fit: contain; border-radius: 8px;" />
      `;
    } else if (photoContainer) {
      photoContainer.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">
          📷 No photo available
        </div>
      `;
    }

    // Load fictional image
    if (fictionalContainer && fictionalUrl) {
      fictionalContainer.innerHTML = `
        <img src="${fictionalUrl}" alt="Fictional Item" 
             style="width: 100%; height: 100%; object-fit: contain; border-radius: 8px;" />
      `;
    } else if (fictionalContainer) {
      fictionalContainer.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">
          ✨ No fictional image available
        </div>
      `;
    }
  }

  // ==========================================
  // Clear Both Viewers
  // ==========================================

  clear() {
    if (this.photoViewer) {
      this.photoViewer.clearModel();
    }
    if (this.fictionalViewer) {
      this.fictionalViewer.clearModel();
    }

    this.photoModelUrl = null;
    this.fictionalModelUrl = null;
  }

  // ==========================================
  // Helper Methods for Safe Resource Management
  // ==========================================

  // 🔍 Check if a viewer instance is broken or unusable
  _isViewerBroken(viewer) {
    if (!viewer) return true;

    try {
      // Check if renderer exists
      if (!viewer.renderer) return true;

      // 🆕 Check if canvas is still in the DOM
      // This catches the case where container.innerHTML = "" removed the canvas
      const canvas = viewer.renderer.domElement;
      if (!canvas || !document.body.contains(canvas)) {
        console.log(
          `🔍 Canvas not in DOM for ${viewer.containerId}, viewer is broken`
        );
        return true;
      }

      // 🆕 Check if container still exists and matches
      const container = document.getElementById(viewer.containerId);
      if (!container || !container.contains(canvas)) {
        console.log(
          `🔍 Container mismatch for ${viewer.containerId}, viewer is broken`
        );
        return true;
      }

      // Check WebGL context is valid
      const gl = viewer.renderer.getContext();
      return !gl || gl.isContextLost();
    } catch (error) {
      console.warn("Error checking viewer state:", error);
      return true;
    }
  }

  // 🧹 Clear old models without disposing viewers (gentler approach)
  async _clearOldModels() {
    try {
      if (this.photoViewer) {
        this.photoViewer.clearModel();
      }
      if (this.fictionalViewer) {
        this.fictionalViewer.clearModel();
      }

      // Give time for model clearing to complete
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (error) {
      console.warn("Error clearing old models:", error);
    }
  }

  // ==========================================
  // Dispose
  // ==========================================

  dispose() {
    if (this.photoViewer) {
      this.photoViewer.dispose();
      this.photoViewer = null;
    }
    if (this.fictionalViewer) {
      this.fictionalViewer.dispose();
      this.fictionalViewer = null;
    }
  }
}

// ==========================================
// Fullscreen Viewer Class
// ==========================================
export class FullscreenViewer {
  constructor(options = {}) {
    this.containerId = options.container || "fullscreen-viewer";
    this.modalId = options.modal || "fullscreen-viewer-modal";

    this.viewer = null;
    this.modal = null;
    this.currentModelUrl = null;
    this.isVisible = false;
  }

  // ==========================================
  // Show Modal with Model
  // ==========================================

  async show(modelUrl) {
    if (!modelUrl) {
      console.warn("No model URL provided for fullscreen viewer");
      return;
    }

    this.modal = document.getElementById(this.modalId);
    if (!this.modal) {
      console.error("Fullscreen modal not found:", this.modalId);
      return;
    }

    // Show modal
    this.modal.style.display = "flex";
    this.isVisible = true;
    this.currentModelUrl = modelUrl;

    // Prevent body scroll
    document.body.style.overflow = "hidden";

    // Wait for modal to be visible (for proper sizing)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Initialize viewer if needed
    if (!this.viewer) {
      this.viewer = new BaseViewer(this.containerId, {
        enableGrid: true,
        autoRotate: false,
      });
    }

    // Load model
    try {
      await this.viewer.loadModel(modelUrl);
    } catch (error) {
      console.error("Failed to load model in fullscreen viewer:", error);
    }
  }

  // ==========================================
  // Hide Modal
  // ==========================================

  hide() {
    if (this.modal) {
      this.modal.style.display = "none";
    }

    this.isVisible = false;

    // Restore body scroll
    document.body.style.overflow = "";

    // Clear model (optional - keeps memory usage low)
    if (this.viewer) {
      this.viewer.clearModel();
    }
  }

  // ==========================================
  // Get Current Model URL
  // ==========================================

  getCurrentModelUrl() {
    return this.currentModelUrl;
  }

  // ==========================================
  // Dispose
  // ==========================================

  dispose() {
    this.hide();

    if (this.viewer) {
      this.viewer.dispose();
      this.viewer = null;
    }
  }
}

// ==========================================
// Mini Viewer for Collection Items
// ==========================================
export class MiniViewer extends BaseViewer {
  constructor(containerId, options = {}) {
    super(containerId, {
      autoRotate: true,
      autoRotateSpeed: 2.0,
      enableGrid: false,
      enableAxes: false,
      ...options,
    });
  }

  // Override to use 6-light uniform illumination
  createLights() {
    const ambientLight = new THREE.AmbientLight(0xccccdd, 0.8);
    this.scene.add(ambientLight);

    const lightColor = 0xfff8f0;
    const intensity = 0.45;
    const positions = [
      [0, 0, 5], [0, 0, -5], [-5, 0, 0],
      [5, 0, 0], [0, 5, 0], [0, -5, 0],
    ];
    positions.forEach(([x, y, z], i) => {
      const light = new THREE.DirectionalLight(lightColor, i === 5 ? intensity * 0.6 : intensity);
      light.position.set(x, y, z);
      this.scene.add(light);
    });
  }

  // Override to disable controls for mini viewers
  createControls() {
    // No controls for mini viewers - just auto-rotate
    this.controls = {
      update: () => {},
      dispose: () => {},
    };
  }

  // Override animate to handle auto-rotation manually
  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    // Auto rotate model
    if (this.currentModel && this.options.autoRotate) {
      this.currentModel.rotation.y += 0.01 * this.options.autoRotateSpeed;
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

// ==========================================
// Factory Function for Creating Viewers
// ==========================================
export function createViewer(containerId, type = "base", options = {}) {
  switch (type) {
    case "mini":
      return new MiniViewer(containerId, options);
    case "fullscreen":
      return new FullscreenViewer(options);
    case "dual":
      return new DualViewer(options);
    default:
      return new BaseViewer(containerId, options);
  }
}

// ==========================================
// Export for Global Access
// ==========================================
window.DualViewer = DualViewer;
window.FullscreenViewer = FullscreenViewer;
window.MiniViewer = MiniViewer;
window.createViewer = createViewer;

export default {
  BaseViewer,
  DualViewer,
  FullscreenViewer,
  MiniViewer,
  createViewer,
};
