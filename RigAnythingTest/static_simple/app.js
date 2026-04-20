/**
 * RigAnything Simple — Frontend Application
 * State machine: UPLOAD → PREVIEW → RIGGING → RIGGED
 */

// ==========================================
// Configuration
// ==========================================
// Set API_BASE to your backend URL.
// Leave empty string "" when frontend is served by the same backend.
// When using nginx reverse proxy on Hostinger, keep this empty.
const API_BASE = window.RIG_API_BASE || "";

// ==========================================
// State
// ==========================================
const state = {
    phase: "UPLOAD",   // UPLOAD | PREVIEW | RIGGING | RIGGED
    sessionId: null,
    // Three.js
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    // 3D 物件
    meshGroup: null,
    skeletonGroup: null,
    // 數據
    skeletonData: null,  // { joints, parents }
    originalMaterials: [],
    // 開關
    showMesh: true,
    showSkeleton: true,
    showWeights: false,
    showWireframe: false,
};

// ==========================================
// Init
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    initThreeJS();
    initEventListeners();
    loadExamples();
});

function initThreeJS() {
    const canvas = document.getElementById("three-canvas");
    const container = document.getElementById("viewer-container");

    // Scene
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x0d1117);

    // Camera
    state.camera = new THREE.PerspectiveCamera(
        45, container.clientWidth / container.clientHeight, 0.01, 100
    );
    state.camera.position.set(2, 1.5, 2);

    // Renderer
    state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    state.renderer.setSize(container.clientWidth, container.clientHeight);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Orbit Controls
    state.controls = new THREE.OrbitControls(state.camera, canvas);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.1;

    // Lights
    state.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(5, 5, 5);
    state.scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-3, 2, -3);
    state.scene.add(dir2);

    // Grid
    state.scene.add(new THREE.GridHelper(4, 20, 0x30363d, 0x21262d));

    // Responsive resize
    const ro = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        state.camera.aspect = w / h;
        state.camera.updateProjectionMatrix();
        state.renderer.setSize(w, h);
    });
    ro.observe(container);

    animate();
}

function animate() {
    requestAnimationFrame(animate);
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
}

// ==========================================
// Event Listeners
// ==========================================
function initEventListeners() {
    // File upload
    const uploadBox = document.querySelector(".upload-box");
    const fileInput = document.getElementById("file-input");

    document.getElementById("btn-choose-file").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
        if (e.target.files[0]) handleUpload(e.target.files[0]);
    });

    // Drag & drop
    uploadBox.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadBox.classList.add("drag-over");
    });
    uploadBox.addEventListener("dragleave", () => uploadBox.classList.remove("drag-over"));
    uploadBox.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadBox.classList.remove("drag-over");
        if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
    });

    // Header buttons
    document.getElementById("btn-rig").addEventListener("click", handleRig);
    document.getElementById("btn-download").addEventListener("click", handleDownload);
    document.getElementById("btn-new").addEventListener("click", handleNewModel);

    // Controls
    document.getElementById("chk-mesh").addEventListener("change", (e) => {
        state.showMesh = e.target.checked;
        if (state.meshGroup) state.meshGroup.visible = state.showMesh;
    });
    document.getElementById("chk-skeleton").addEventListener("change", (e) => {
        state.showSkeleton = e.target.checked;
        if (state.skeletonGroup) state.skeletonGroup.visible = state.showSkeleton;
    });
    document.getElementById("chk-weights").addEventListener("change", (e) => {
        state.showWeights = e.target.checked;
        if (state.showWeights) {
            const idx = parseInt(document.getElementById("sel-joint").value) || 0;
            loadWeightPaint(idx);
        } else {
            restoreOriginalMaterials();
        }
    });
    document.getElementById("sel-joint").addEventListener("change", (e) => {
        if (state.showWeights) loadWeightPaint(parseInt(e.target.value));
    });
    document.getElementById("chk-wireframe").addEventListener("change", (e) => {
        state.showWireframe = e.target.checked;
        toggleWireframe(state.showWireframe);
    });
}

// ==========================================
// State Machine
// ==========================================
function setPhase(phase) {
    state.phase = phase;

    const uploadOverlay = document.getElementById("upload-overlay");
    const loadingOverlay = document.getElementById("loading-overlay");
    const controlsBar = document.getElementById("controls-bar");
    const btnRig = document.getElementById("btn-rig");
    const btnDownload = document.getElementById("btn-download");
    const btnNew = document.getElementById("btn-new");
    const sessionBadge = document.getElementById("session-badge");

    // Hide all
    uploadOverlay.classList.add("hidden");
    loadingOverlay.classList.add("hidden");
    controlsBar.classList.add("hidden");
    btnRig.classList.add("hidden");
    btnDownload.classList.add("hidden");
    btnNew.classList.add("hidden");
    sessionBadge.classList.add("hidden");

    switch (phase) {
        case "UPLOAD":
            uploadOverlay.classList.remove("hidden");
            setStatus("Ready — Upload a GLB file to begin");
            break;

        case "PREVIEW":
            btnRig.classList.remove("hidden");
            btnNew.classList.remove("hidden");
            sessionBadge.classList.remove("hidden");
            sessionBadge.textContent = state.sessionId;
            setStatus("Model loaded — Click [Rig] to start rigging");
            break;

        case "RIGGING":
            loadingOverlay.classList.remove("hidden");
            btnNew.classList.remove("hidden");
            sessionBadge.classList.remove("hidden");
            document.getElementById("loading-text").textContent = "Running RigAnything inference...";
            setStatus("Rigging in progress, please wait...");
            break;

        case "RIGGED":
            controlsBar.classList.remove("hidden");
            btnDownload.classList.remove("hidden");
            btnNew.classList.remove("hidden");
            sessionBadge.classList.remove("hidden");
            setStatus(`Rigging complete — ${state.skeletonData.joints.length} joints`);
            break;
    }
}

function setStatus(text) {
    document.getElementById("status-text").textContent = text;
}

// ==========================================
// Upload
// ==========================================
async function handleUpload(file) {
    setPhase("RIGGING");
    document.getElementById("loading-text").textContent = "Uploading file...";

    const formData = new FormData();
    formData.append("file", file);

    try {
        const resp = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: formData });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        state.sessionId = data.session_id;
        loadMesh(`${API_BASE}${data.mesh_url}`, () => setPhase("PREVIEW"));
    } catch (e) {
        setPhase("UPLOAD");
        alert("Upload failed: " + e.message);
    }
}

async function handleUploadExample(filename) {
    setPhase("RIGGING");
    document.getElementById("loading-text").textContent = `Loading example ${filename}...`;

    const formData = new FormData();
    formData.append("example", filename);

    try {
        const resp = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: formData });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        state.sessionId = data.session_id;
        loadMesh(`${API_BASE}${data.mesh_url}`, () => setPhase("PREVIEW"));
    } catch (e) {
        setPhase("UPLOAD");
        alert("Load failed: " + e.message);
    }
}

// ==========================================
// Load Examples
// ==========================================
async function loadExamples() {
    try {
        const resp = await fetch(`${API_BASE}/api/examples`);
        const examples = await resp.json();
        const container = document.getElementById("examples-list");
        if (examples.length === 0) {
            document.getElementById("examples-section").classList.add("hidden");
            return;
        }
        examples.forEach(ex => {
            const btn = document.createElement("button");
            btn.className = "example-btn";
            btn.textContent = ex.name;
            btn.addEventListener("click", () => handleUploadExample(ex.filename));
            container.appendChild(btn);
        });
    } catch (e) {
        console.warn("Failed to load examples:", e);
    }
}

// ==========================================
// 3D Mesh Loading
// ==========================================
function loadMesh(url, onDone) {
    const loader = new THREE.GLTFLoader();
    loader.load(url, (gltf) => {
        // Remove old mesh
        if (state.meshGroup) state.scene.remove(state.meshGroup);
        state.meshGroup = gltf.scene;

        // Center and scale
        const box = new THREE.Box3().setFromObject(state.meshGroup);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2 / maxDim;
        state.meshGroup.scale.setScalar(scale);
        state.meshGroup.position.sub(center.multiplyScalar(scale));

        // Save original materials
        state.originalMaterials = [];
        state.meshGroup.traverse((child) => {
            if (child.isMesh) {
                state.originalMaterials.push({ mesh: child, material: child.material.clone() });
            }
        });

        state.scene.add(state.meshGroup);
        state.camera.lookAt(0, 0, 0);
        state.controls.target.set(0, 0, 0);

        if (onDone) onDone();
    }, undefined, (err) => {
        console.error("GLB load failed:", err);
        alert("GLB load failed");
        setPhase("UPLOAD");
    });
}

// ==========================================
// Rigging Inference
// ==========================================
async function handleRig() {
    if (!state.sessionId) return;
    setPhase("RIGGING");

    try {
        const resp = await fetch(`${API_BASE}/api/rig/${state.sessionId}`, { method: "POST" });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        state.skeletonData = { joints: data.joints, parents: data.parents };
        drawSkeleton(data.joints, data.parents);
        populateJointSelect(data.joints.length);
        setPhase("RIGGED");
    } catch (e) {
        setPhase("PREVIEW");
        alert("Rigging failed: " + e.message);
    }
}

// ==========================================
// Draw Skeleton
// ==========================================
function drawSkeleton(joints, parents) {
    if (state.skeletonGroup) state.scene.remove(state.skeletonGroup);
    state.skeletonGroup = new THREE.Group();

    // Align with mesh transform
    if (state.meshGroup) {
        state.skeletonGroup.scale.copy(state.meshGroup.scale);
        state.skeletonGroup.position.copy(state.meshGroup.position);
    }

    const jointGeom = new THREE.SphereGeometry(0.015, 8, 8);
    const jointMat = new THREE.MeshBasicMaterial({ color: 0xf0883e });
    const boneMat = new THREE.LineBasicMaterial({ color: 0x58a6ff, linewidth: 2 });

    // Draw joint spheres
    joints.forEach((pos, i) => {
        const sphere = new THREE.Mesh(jointGeom, jointMat.clone());
        sphere.position.set(pos[0], pos[1], pos[2]);
        sphere.userData.jointIndex = i;
        state.skeletonGroup.add(sphere);
    });

    // Draw bone lines
    const linePositions = [];
    for (let i = 1; i < joints.length; i++) {
        const pi = parents[i];
        if (pi !== i && pi >= 0 && pi < joints.length) {
            linePositions.push(
                joints[i][0], joints[i][1], joints[i][2],
                joints[pi][0], joints[pi][1], joints[pi][2]
            );
        }
    }
    if (linePositions.length > 0) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
        state.skeletonGroup.add(new THREE.LineSegments(geom, boneMat));
    }

    state.scene.add(state.skeletonGroup);
    state.skeletonGroup.visible = state.showSkeleton;
}

function populateJointSelect(numJoints) {
    const select = document.getElementById("sel-joint");
    select.innerHTML = "";
    for (let i = 0; i < numJoints; i++) {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = `Bone_${i}`;
        select.appendChild(opt);
    }
}

// ==========================================
// Weight Paint
// ==========================================
async function loadWeightPaint(jointIdx) {
    if (!state.sessionId) return;
    try {
        const resp = await fetch(`${API_BASE}/api/weights/${state.sessionId}?joint=${jointIdx}`);
        const data = await resp.json();
        if (data.error) {
            console.error("Weight load failed:", data.error);
            return;
        }
        applyWeightColors(data.weights);
    } catch (e) {
        console.error("Weight load failed:", e);
    }
}

function applyWeightColors(weights) {
    if (!state.meshGroup) return;
    let vertexOffset = 0;

    state.meshGroup.traverse((child) => {
        if (!child.isMesh) return;
        const geom = child.geometry;
        const posAttr = geom.getAttribute("position");
        const vertCount = posAttr.count;
        const colors = new Float32Array(vertCount * 3);

        for (let i = 0; i < vertCount; i++) {
            const wi = vertexOffset + i < weights.length ? weights[vertexOffset + i] : 0;
            // Blue (cold) → Red (hot) gradient
            colors[i * 3]     = wi;       // R
            colors[i * 3 + 1] = 0;        // G
            colors[i * 3 + 2] = 1 - wi;   // B
        }

        geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        child.material = new THREE.MeshBasicMaterial({ vertexColors: true });
        vertexOffset += vertCount;
    });
}

function restoreOriginalMaterials() {
    state.originalMaterials.forEach(({ mesh, material }) => {
        mesh.material = material.clone();
    });
}

function toggleWireframe(show) {
    if (!state.meshGroup) return;
    state.meshGroup.traverse((child) => {
        if (child.isMesh && child.material) {
            child.material.wireframe = show;
        }
    });
}

// ==========================================
// Export & Download
// ==========================================
async function handleDownload() {
    if (!state.sessionId) return;

    const btn = document.getElementById("btn-download");
    btn.disabled = true;
    setStatus("Exporting GLB...");

    try {
        const resp = await fetch(`${API_BASE}/api/export/${state.sessionId}`, { method: "POST" });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        // Trigger browser download
        const a = document.createElement("a");
        a.href = `${API_BASE}${data.download_url}`;
        a.download = "rigged_output.glb";
        a.click();

        setStatus("GLB exported successfully");
    } catch (e) {
        alert("Export failed: " + e.message);
        setStatus("Export failed");
    }
    btn.disabled = false;
}

// ==========================================
// New Model (Reset)
// ==========================================
function handleNewModel() {
    // Clear 3D scene
    if (state.meshGroup) {
        state.scene.remove(state.meshGroup);
        state.meshGroup = null;
    }
    if (state.skeletonGroup) {
        state.scene.remove(state.skeletonGroup);
        state.skeletonGroup = null;
    }
    state.sessionId = null;
    state.skeletonData = null;
    state.originalMaterials = [];

    // Reset controls
    document.getElementById("chk-mesh").checked = true;
    document.getElementById("chk-skeleton").checked = true;
    document.getElementById("chk-weights").checked = false;
    document.getElementById("chk-wireframe").checked = false;
    state.showMesh = true;
    state.showSkeleton = true;
    state.showWeights = false;
    state.showWireframe = false;

    // Reset file input
    document.getElementById("file-input").value = "";

    setPhase("UPLOAD");
}
