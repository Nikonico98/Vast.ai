/**
 * RigAnything Test — Frontend Application
 * Three.js 3D Viewer + Chat UI + Skeleton Controls
 */

// ==========================================
// State
// ==========================================
const state = {
    sessionId: null,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    meshGroup: null,
    skeletonGroup: null,
    skeletonData: null,  // { joints, parents }
    selectedJoint: -1,
    showMesh: true,
    showSkeleton: true,
    showWeights: false,
    showWireframe: false,
    originalMaterials: [],
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

    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x0d1117);

    state.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 100);
    state.camera.position.set(2, 1.5, 2);

    state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    state.renderer.setSize(container.clientWidth, container.clientHeight);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.outputColorSpace = THREE.SRGBColorSpace;

    state.controls = new THREE.OrbitControls(state.camera, canvas);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.1;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    state.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 5, 5);
    state.scene.add(dirLight);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-3, 2, -3);
    state.scene.add(dirLight2);

    // Grid
    const grid = new THREE.GridHelper(4, 20, 0x30363d, 0x21262d);
    state.scene.add(grid);

    // Resize
    const resizeObserver = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        state.camera.aspect = w / h;
        state.camera.updateProjectionMatrix();
        state.renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

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
    // Upload
    const uploadArea = document.getElementById("upload-area");
    const fileInput = document.getElementById("file-input");
    document.getElementById("btn-upload").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
        if (e.target.files[0]) uploadFile(e.target.files[0]);
    });

    // Drag & drop
    uploadArea.addEventListener("dragover", (e) => { e.preventDefault(); uploadArea.classList.add("drag-over"); });
    uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
    uploadArea.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadArea.classList.remove("drag-over");
        if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
    });

    // Viewer controls
    document.getElementById("show-mesh").addEventListener("change", (e) => {
        state.showMesh = e.target.checked;
        if (state.meshGroup) state.meshGroup.visible = state.showMesh;
    });
    document.getElementById("show-skeleton").addEventListener("change", (e) => {
        state.showSkeleton = e.target.checked;
        if (state.skeletonGroup) state.skeletonGroup.visible = state.showSkeleton;
    });
    document.getElementById("show-weights").addEventListener("change", (e) => {
        state.showWeights = e.target.checked;
        if (state.showWeights) {
            const jointIdx = parseInt(document.getElementById("weight-joint-select").value) || 0;
            loadWeightPaint(jointIdx);
        } else {
            restoreOriginalMaterials();
        }
    });
    document.getElementById("show-wireframe").addEventListener("change", (e) => {
        state.showWireframe = e.target.checked;
        toggleWireframe(state.showWireframe);
    });
    document.getElementById("weight-joint-select").addEventListener("change", (e) => {
        if (state.showWeights) loadWeightPaint(parseInt(e.target.value));
    });

    // Chat
    document.getElementById("btn-send").addEventListener("click", sendChat);
    document.getElementById("chat-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    document.getElementById("btn-auto-analyze").addEventListener("click", autoAnalyze);

    // Tabs
    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });

    // Instructions
    document.getElementById("btn-apply-instructions").addEventListener("click", applyInstructionsFromEditor);

    // Header actions
    document.getElementById("btn-reset").addEventListener("click", resetSkeleton);
    document.getElementById("btn-export").addEventListener("click", exportGLB);
}

// ==========================================
// Upload & Inference
// ==========================================
async function loadExamples() {
    try {
        const resp = await fetch("/api/examples");
        const examples = await resp.json();
        const container = document.getElementById("examples-list");
        examples.forEach(ex => {
            const btn = document.createElement("button");
            btn.className = "example-btn";
            btn.textContent = ex.name;
            btn.addEventListener("click", () => uploadExample(ex.filename));
            container.appendChild(btn);
        });
    } catch (e) {
        console.error("Failed to load examples:", e);
    }
}

async function uploadFile(file) {
    showLoading("正在上傳並執行 RigAnything 推論...");
    const formData = new FormData();
    formData.append("file", file);

    try {
        const resp = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        onInferenceComplete(data);
    } catch (e) {
        hideLoading();
        alert("Error: " + e.message);
    }
}

async function uploadExample(filename) {
    showLoading(`正在載入範例 ${filename} 並執行推論...`);
    const formData = new FormData();
    formData.append("example", filename);

    try {
        const resp = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        onInferenceComplete(data);
    } catch (e) {
        hideLoading();
        alert("Error: " + e.message);
    }
}

function onInferenceComplete(data) {
    state.sessionId = data.session_id;
    hideLoading();
    document.getElementById("upload-area").classList.add("hidden");
    document.getElementById("viewer-controls").classList.remove("hidden");
    document.getElementById("side-panel").classList.remove("hidden");
    document.getElementById("btn-reset").classList.remove("hidden");
    document.getElementById("btn-export").classList.remove("hidden");
    document.getElementById("session-badge").classList.remove("hidden");
    document.getElementById("session-badge").textContent = `Session: ${data.session_id}`;

    // Load mesh
    loadMesh(data.mesh_url);
    // Load skeleton
    loadSkeletonData();
    // Update UI
    updateSkeletonInfo(data.skeleton);
    addChatMessage("system", data.message);
}

// ==========================================
// 3D Viewer — Mesh
// ==========================================
function loadMesh(url) {
    const loader = new THREE.GLTFLoader();
    loader.load(url, (gltf) => {
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

        // Store original materials
        state.originalMaterials = [];
        state.meshGroup.traverse((child) => {
            if (child.isMesh) {
                state.originalMaterials.push({ mesh: child, material: child.material.clone() });
            }
        });

        state.scene.add(state.meshGroup);
        state.camera.lookAt(0, 0, 0);
        state.controls.target.set(0, 0, 0);
    }, undefined, (err) => console.error("GLB load error:", err));
}

// ==========================================
// 3D Viewer — Skeleton
// ==========================================
async function loadSkeletonData() {
    if (!state.sessionId) return;
    try {
        const resp = await fetch(`/api/skeleton/${state.sessionId}/joints`);
        const data = await resp.json();
        state.skeletonData = data;
        drawSkeleton(data.joints, data.parents);
        populateJointSelect(data.joints.length);
    } catch (e) {
        console.error("Failed to load skeleton:", e);
    }
}

function drawSkeleton(joints, parents) {
    if (state.skeletonGroup) state.scene.remove(state.skeletonGroup);
    state.skeletonGroup = new THREE.Group();

    // Apply same transform as mesh
    if (state.meshGroup) {
        state.skeletonGroup.scale.copy(state.meshGroup.scale);
        state.skeletonGroup.position.copy(state.meshGroup.position);
    }

    const jointGeom = new THREE.SphereGeometry(0.015, 8, 8);
    const jointMat = new THREE.MeshBasicMaterial({ color: 0xf0883e });
    const boneMat = new THREE.LineBasicMaterial({ color: 0x58a6ff, linewidth: 2 });

    // Draw joints
    joints.forEach((pos, i) => {
        const sphere = new THREE.Mesh(jointGeom, jointMat.clone());
        sphere.position.set(pos[0], pos[1], pos[2]);
        sphere.userData.jointIndex = i;
        state.skeletonGroup.add(sphere);
    });

    // Draw bones (lines from child to parent)
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
        const lines = new THREE.LineSegments(geom, boneMat);
        state.skeletonGroup.add(lines);
    }

    state.scene.add(state.skeletonGroup);
    state.skeletonGroup.visible = state.showSkeleton;
}

function populateJointSelect(numJoints) {
    const select = document.getElementById("weight-joint-select");
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
        const resp = await fetch(`/api/skeleton/${state.sessionId}/weights?joint=${jointIdx}`);
        const data = await resp.json();
        if (data.error) return;
        applyWeightColors(data.weights);
    } catch (e) {
        console.error("Failed to load weights:", e);
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
            // Blue (cold) -> Red (hot) gradient
            colors[i * 3] = wi;           // R
            colors[i * 3 + 1] = 0;       // G
            colors[i * 3 + 2] = 1 - wi;  // B
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
// Skeleton Info
// ==========================================
function updateSkeletonInfo(skeleton) {
    const container = document.getElementById("skeleton-info");
    if (!skeleton) { container.innerHTML = "<p>No skeleton data</p>"; return; }

    let html = `
        <div class="skeleton-stat"><strong>${skeleton.num_joints}</strong> 個關節</div>
        <div class="skeleton-stat"><strong>${skeleton.num_vertices}</strong> 個頂點</div>
    `;
    if (skeleton.bbox) {
        const s = skeleton.bbox.size;
        html += `<div class="skeleton-stat">BBox: ${s.map(v => v.toFixed(3)).join(" × ")}</div>`;
    }

    html += `<div class="joint-tree" style="margin-top:12px;"><strong>關節層級：</strong>`;
    if (skeleton.joints) {
        skeleton.joints.forEach(j => {
            const indent = "  ".repeat(j.depth);
            html += `<div class="joint-item" data-idx="${j.index}" style="padding-left:${j.depth * 12}px">
                ${indent}${j.index}: [${j.position.map(v => v.toFixed(3)).join(", ")}] ← ${j.parent}
            </div>`;
        });
    }
    html += `</div>`;
    container.innerHTML = html;

    // Click to highlight joint
    container.querySelectorAll(".joint-item").forEach(el => {
        el.addEventListener("click", () => {
            const idx = parseInt(el.dataset.idx);
            highlightJoint(idx);
            container.querySelectorAll(".joint-item").forEach(e => e.classList.remove("selected"));
            el.classList.add("selected");
        });
    });
}

function highlightJoint(idx) {
    if (!state.skeletonGroup) return;
    state.skeletonGroup.children.forEach(child => {
        if (child.isMesh && child.userData.jointIndex !== undefined) {
            child.material.color.set(child.userData.jointIndex === idx ? 0xff4444 : 0xf0883e);
            child.scale.setScalar(child.userData.jointIndex === idx ? 2 : 1);
        }
    });
    state.selectedJoint = idx;
    // Auto load weight paint
    if (state.showWeights) {
        document.getElementById("weight-joint-select").value = idx;
        loadWeightPaint(idx);
    }
}

// ==========================================
// Chat
// ==========================================
async function sendChat() {
    const input = document.getElementById("chat-input");
    const message = input.value.trim();
    if (!message || !state.sessionId) return;

    input.value = "";
    addChatMessage("user", message);
    const autoApply = document.getElementById("auto-apply").checked;

    document.getElementById("btn-send").disabled = true;

    try {
        const resp = await fetch(`/api/chat/${state.sessionId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, auto_apply: autoApply }),
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        addChatMessage("assistant", data.message);

        if (data.instructions) {
            document.getElementById("instructions-json").value = JSON.stringify(data.instructions, null, 2);
            if (data.applied) {
                addChatMessage("system", "✅ 指令已自動套用");
                refreshSkeletonView();
                if (data.skeleton) updateSkeletonInfo(data.skeleton);
            }
        }
    } catch (e) {
        addChatMessage("system", "❌ Error: " + e.message);
    }
    document.getElementById("btn-send").disabled = false;
}

async function autoAnalyze() {
    if (!state.sessionId) return;
    addChatMessage("system", "🔍 正在自動分析骨骼結構...");
    document.getElementById("btn-auto-analyze").disabled = true;

    try {
        const resp = await fetch(`/api/chat/${state.sessionId}/auto-analyze`, { method: "POST" });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        if (data.explanation) addChatMessage("assistant", data.explanation);
        document.getElementById("instructions-json").value = JSON.stringify(data, null, 2);
        switchTab("instructions");
    } catch (e) {
        addChatMessage("system", "❌ Error: " + e.message);
    }
    document.getElementById("btn-auto-analyze").disabled = false;
}

function addChatMessage(role, content) {
    const container = document.getElementById("chat-messages");
    const msg = document.createElement("div");
    msg.className = `chat-msg ${role}`;
    msg.textContent = content;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

// ==========================================
// Instructions
// ==========================================
async function applyInstructionsFromEditor() {
    const text = document.getElementById("instructions-json").value.trim();
    if (!text || !state.sessionId) return;

    let instructions;
    try {
        instructions = JSON.parse(text);
    } catch (e) {
        alert("JSON 格式錯誤: " + e.message);
        return;
    }

    try {
        const resp = await fetch(`/api/apply/${state.sessionId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(instructions),
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        addChatMessage("system", "✅ " + data.message);
        refreshSkeletonView();
        if (data.skeleton) updateSkeletonInfo(data.skeleton);
    } catch (e) {
        alert("套用失敗: " + e.message);
    }
}

// ==========================================
// Actions
// ==========================================
async function resetSkeleton() {
    if (!state.sessionId) return;
    try {
        const resp = await fetch(`/api/reset/${state.sessionId}`, { method: "POST" });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        addChatMessage("system", "↺ " + data.message);
        refreshSkeletonView();
        if (data.skeleton) updateSkeletonInfo(data.skeleton);
    } catch (e) {
        alert("重置失敗: " + e.message);
    }
}

async function exportGLB() {
    if (!state.sessionId) return;
    document.getElementById("btn-export").disabled = true;
    addChatMessage("system", "正在匯出 GLB...");

    try {
        const resp = await fetch(`/api/export/${state.sessionId}`, { method: "POST" });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        addChatMessage("system", "✅ " + data.message);
        // Download
        const a = document.createElement("a");
        a.href = data.download_url;
        a.download = "rigged_output.glb";
        a.click();
    } catch (e) {
        addChatMessage("system", "❌ 匯出失敗: " + e.message);
    }
    document.getElementById("btn-export").disabled = false;
}

async function refreshSkeletonView() {
    await loadSkeletonData();
    if (state.showWeights) {
        const jointIdx = parseInt(document.getElementById("weight-joint-select").value) || 0;
        loadWeightPaint(jointIdx);
    }
}

// ==========================================
// Tabs
// ==========================================
function switchTab(tabName) {
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.toggle("active", c.id === `tab-${tabName}`));
}

// ==========================================
// UI Helpers
// ==========================================
function showLoading(text) {
    document.getElementById("upload-area").classList.add("hidden");
    document.getElementById("loading-indicator").classList.remove("hidden");
    document.getElementById("loading-text").textContent = text;
}

function hideLoading() {
    document.getElementById("loading-indicator").classList.add("hidden");
}
