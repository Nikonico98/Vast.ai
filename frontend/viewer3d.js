// ==========================================
// Three.js 3D Viewer Module - iOS Direct Version
// ==========================================
// 简化版本：同源请求，不需要认证

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ==========================================
// Loading Configuration
// ==========================================
const LOADING_CONFIG = {
  TIMEOUT_MS: 30000, // 30 seconds timeout
  MAX_RETRIES: 3, // Maximum retry attempts
  RETRY_DELAY_MS: 1000, // Delay between retries
  MAX_FILE_SIZE_MB: 50, // Maximum file size
};

// ==========================================
// Scene Components
// ==========================================
let scene, camera, renderer, controls;
let currentModel = null;
let container = null;
let isLoading = false;
let abortController = null;

// ==========================================
// Initialize Scene
// ==========================================
function initScene() {
  container = document.getElementById("viewer3d");

  // Check if container exists
  if (!container) {
    console.warn(
      "[Viewer3D] Container #viewer3d not found, skipping initialization"
    );
    return false;
  }

  // Create Scene
  scene = new THREE.Scene();
  scene.background = _createGradientBackground();

  // Create Camera
  const aspect = container.clientWidth / container.clientHeight || 1;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);

  // Create Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // Studio-style lighting setup
  // Hemisphere light: warm ground, cool sky - matches gradient background
  const hemiLight = new THREE.HemisphereLight(0xc4a870, 0x8899aa, 0.6);
  scene.add(hemiLight);

  // Soft ambient fill
  const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.4);
  scene.add(ambientLight);

  // Key light - warm, upper-left-front (main illumination)
  const keyLight = new THREE.DirectionalLight(0xfff0dd, 1.2);
  keyLight.position.set(-3, 5, 4);
  scene.add(keyLight);

  // Fill light - cooler, right side (softer)
  const fillLight = new THREE.DirectionalLight(0xd4e0f0, 0.6);
  fillLight.position.set(4, 2, -1);
  scene.add(fillLight);

  // Rim/back light - defines edges
  const rimLight = new THREE.DirectionalLight(0xffeedd, 0.5);
  rimLight.position.set(0, 3, -5);
  scene.add(rimLight);

  // Subtle top light
  const topLight = new THREE.DirectionalLight(0xffffff, 0.3);
  topLight.position.set(0, 8, 0);
  scene.add(topLight);

  // Generate environment map for reflections
  _setupEnvironment(scene, renderer);

  // Add Controls (优化触屏操作)
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 2;
  controls.maxDistance = 50;
  controls.target.set(0, 0, 0);

  // 触屏优化
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  // Handle Window Resize
  window.addEventListener("resize", onWindowResize);

  // Start Animation Loop
  animate();

  console.log("✅ Three.js scene initialized (iOS Direct)");
}

// ==========================================
// Gradient Background - warm golden to cool gray (studio style)
// ==========================================
function _createGradientBackground() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // Diagonal gradient: warm bottom-left to cool top-right
  const gradient = ctx.createLinearGradient(0, canvas.height, canvas.width, 0);
  gradient.addColorStop(0.0, "#b89a60");   // warm golden
  gradient.addColorStop(0.3, "#c4a870");   // lighter gold
  gradient.addColorStop(0.6, "#a09888");   // warm gray
  gradient.addColorStop(1.0, "#787878");   // cool gray

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ==========================================
// Environment Map - for PBR material reflections
// ==========================================
function _setupEnvironment(targetScene, targetRenderer) {
  const pmremGenerator = new THREE.PMREMGenerator(targetRenderer);
  pmremGenerator.compileCubemapShader();

  // Create a simple warm environment scene
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0xa09080);

  // Warm hemisphere to tint reflections
  const envHemi = new THREE.HemisphereLight(0xc4a870, 0x556677, 1.0);
  envScene.add(envHemi);

  const envTexture = pmremGenerator.fromScene(envScene, 0.04).texture;
  targetScene.environment = envTexture;
  pmremGenerator.dispose();
  envScene.clear();
}

// ==========================================
// Animation Loop
// ==========================================
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// ==========================================
// Handle Window Resize
// ==========================================
function onWindowResize() {
  const width = container.clientWidth;
  const height = container.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
}

// ==========================================
// Load GLB Model - Enhanced with Stability Features
// ==========================================
export async function loadModel(url, retryCount = 0) {
  if (isLoading) {
    console.warn("Already loading a model, please wait...");
    return;
  }

  console.log(
    "📥 Loading model:",
    url,
    retryCount > 0 ? `(retry ${retryCount})` : ""
  );

  isLoading = true;
  abortController = new AbortController();

  try {
    // 🔥 Timeout wrapper
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("Loading timeout")),
        LOADING_CONFIG.TIMEOUT_MS
      );
    });

    const loadPromise = _loadModelCore(url);

    await Promise.race([loadPromise, timeoutPromise]);

    console.log("✅ Model loaded successfully");
  } catch (error) {
    console.error("❌ Model loading failed:", error);

    // 🔄 Retry logic
    if (retryCount < LOADING_CONFIG.MAX_RETRIES) {
      console.log(
        `Retrying... (${retryCount + 1}/${LOADING_CONFIG.MAX_RETRIES})`
      );

      await new Promise((resolve) =>
        setTimeout(resolve, LOADING_CONFIG.RETRY_DELAY_MS)
      );

      // Reset state for retry
      isLoading = false;
      abortController = null;

      return loadModel(url, retryCount + 1);
    }

    // 💥 Final failure
    throw error;
  } finally {
    isLoading = false;
    abortController = null;
  }
}

async function _loadModelCore(url) {
  let blobUrl;
  try {
    console.log("🌐 Fetching GLB file...");
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      signal: abortController?.signal,
    });
    console.log("📡 Response status:", response.status, response.statusText);

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
      console.log("📦 File size:", sizeMB.toFixed(1), "MB");
    }

    const blob = await response.blob();
    blobUrl = URL.createObjectURL(blob);
    console.log("✅ GLB file downloaded, size:", blob.size, "bytes");
  } catch (fetchError) {
    console.error("❌ GLB fetch failed:", fetchError);
    throw new Error(`Failed to download model: ${fetchError.message}`);
  }

  // 🔗 使用 GLTFLoader 从 Blob URL 加载
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();

    console.log("🔄 Parsing GLB from blob...");

    loader.load(
      blobUrl,
      // onLoad
      (gltf) => {
        console.log("✅ Model loaded successfully");

        // 🗑️ 释放 Blob URL
        URL.revokeObjectURL(blobUrl);

        // Remove old model if exists
        clearModel();

        // Add new model
        currentModel = gltf.scene;
        scene.add(currentModel);

        // Center and scale model
        centerAndScaleModel(currentModel);

        resolve();
      },
      // onProgress
      (progress) => {
        if (progress.lengthComputable) {
          const percent = ((progress.loaded / progress.total) * 100).toFixed(1);
          console.log(`Loading: ${percent}%`);
        }
      },
      // onError
      (error) => {
        console.error("❌ Model parsing error:", error);
        URL.revokeObjectURL(blobUrl);
        reject(new Error(`Failed to parse GLB: ${error.message}`));
      }
    );

    // 🚫 Handle abort signal
    if (abortController?.signal) {
      abortController.signal.addEventListener("abort", () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error("Loading was aborted"));
      });
    }
  });
}

// ==========================================
// Center and Scale Model
// ==========================================
function centerAndScaleModel(model) {
  // Compute bounding box
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  // Center model
  model.position.sub(center);

  // Scale model to fit in view
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 5 / maxDim; // Target size: 5 units
  model.scale.multiplyScalar(scale);

  // Adjust camera
  const distance = maxDim * 2;
  camera.position.set(distance, distance * 0.5, distance);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();

  console.log("📐 Model centered and scaled");
}

// ==========================================
// Clear Current Model - Enhanced Resource Cleanup
// ==========================================
export function clearModel() {
  if (currentModel) {
    scene.remove(currentModel);

    // 🧹 Enhanced resource disposal
    currentModel.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => _disposeMaterial(mat));
        } else {
          _disposeMaterial(child.material);
        }
      }
    });

    currentModel = null;
    console.log("🗑️ Model cleared");
  }
}

// 🗑️ Enhanced material disposal
function _disposeMaterial(material) {
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
export function cancelLoading() {
  if (isLoading && abortController) {
    abortController.abort();
    console.log("Loading cancelled");
  }
}

// ==========================================
// Camera Background Feature
// ==========================================
let videoElement = null;
let videoTexture = null;
let cameraActive = false;

export async function toggleCameraBackground() {
  const cameraBtn = document.getElementById("camera-btn");

  if (cameraActive) {
    // Turn off camera
    stopCamera();
    cameraBtn.textContent = "📷 Turn on Camera";
    cameraBtn.classList.remove("camera-active");
    console.log("📷 Camera turned off");
  } else {
    // Turn on camera
    try {
      await startCamera();
      cameraBtn.textContent = "📷 Turn off Camera";
      cameraBtn.classList.add("camera-active");
      console.log("📷 Camera turned on");
    } catch (error) {
      console.error("❌ Camera error:", error);
      alert(`Camera error: ${error.message}\n\nNote: Camera requires HTTPS.`);
    }
  }
}

async function startCamera() {
  // Request camera access (优先后置摄像头)
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment", // 移动端后置摄像头
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  // Create video element
  videoElement = document.createElement("video");
  videoElement.srcObject = stream;
  videoElement.setAttribute("playsinline", ""); // Required for iOS
  videoElement.muted = true;
  await videoElement.play();

  // Create Three.js video texture
  videoTexture = new THREE.VideoTexture(videoElement);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;

  // Set as scene background
  scene.background = videoTexture;
  cameraActive = true;

  // Hide grid when camera is active
  scene.children.forEach((child) => {
    if (child.isGridHelper || child.isAxesHelper) {
      child.visible = false;
    }
  });
}

function stopCamera() {
  if (videoElement && videoElement.srcObject) {
    // Stop all video tracks
    videoElement.srcObject.getTracks().forEach((track) => track.stop());
    videoElement.srcObject = null;
  }

  if (videoTexture) {
    videoTexture.dispose();
    videoTexture = null;
  }

  // Reset background to dark color
  scene.background = new THREE.Color(0x222222);
  cameraActive = false;

  // Show grid again
  scene.children.forEach((child) => {
    if (child.isGridHelper || child.isAxesHelper) {
      child.visible = true;
    }
  });
}

// ==========================================
// Initialize on Load
// ==========================================
initScene();

// Setup camera button
document
  .getElementById("camera-btn")
  ?.addEventListener("click", toggleCameraBackground);
