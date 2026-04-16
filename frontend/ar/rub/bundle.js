/**
 * Imaginary World - Rub AR Interaction
 * =====================================
 * Puzzle game: rub the model surface to find a hidden circular mark.
 * Cold-hot feedback guides the user. XP accumulates based on proximity.
 * Star dust particles fly from touch point to XP counter.
 * At XP threshold → model transforms (real → fictional).
 */

(function () {
  "use strict";

  console.log("✅ Rub AR Interaction loaded");

  /* ── Merged Config ── */
  var defaultCfg = {
    debug: true,
    mark: {
      radius: 0.04, color: "#FFD700", glowColor: "#FFA500",
      opacity: 0.0, revealOpacity: 0.85, pulseSpeed: 1.5
    },
    rub: { minMoveSpeed: 30, sampleInterval: 50, touchRadius: 0.35 },
    feedback: {
      zones: [
        { maxDist: 0.08, label: "Burning!",  color: "#FF1744", haptic: 80, xpMult: 3.0 },
        { maxDist: 0.20, label: "Hot!",      color: "#FF9100", haptic: 50, xpMult: 2.0 },
        { maxDist: 0.40, label: "Warm...",    color: "#FFD740", haptic: 30, xpMult: 1.2 },
        { maxDist: 0.70, label: "Cool",       color: "#42A5F5", haptic: 0,  xpMult: 0.5 },
        { maxDist: Infinity, label: "Cold",   color: "#90CAF9", haptic: 0,  xpMult: 0.2 }
      ]
    },
    xp: { threshold: 100, perRub: 5, decayRate: 0, counterPosition: "left" },
    particles: { count: 5, size: 0.015, speed: 1.5, color: "#FFD54F", trailLength: 3, lifetime: 800 },
    sparkle: { count: 3, size: 0.008, lifetime: 500, color: "#FFD54F", driftDistance: 0.05 },
    swap: { delay: 500, flashDuration: 400 },
    material: { metalness: 0.15, roughness: 0.85 }
  };

  function mergeDeep(base, ext) {
    if (!ext || typeof ext !== "object") return base;
    var out = {};
    Object.keys(base).forEach(function (k) {
      if (base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) &&
          ext[k] && typeof ext[k] === "object" && !Array.isArray(ext[k])) {
        out[k] = mergeDeep(base[k], ext[k]);
      } else {
        out[k] = k in ext ? ext[k] : base[k];
      }
    });
    return out;
  }

  var CFG = mergeDeep(defaultCfg, window.RUB_CONFIG);
  if (CFG.debug) console.log("⚙️ RUB_CONFIG merged", CFG);

  /* ── Test mode ── */
  var TEST = {
    enabled: true,
    realGlb: "assets/realmodel.glb",
    fictionalGlb: "assets/fictionalmodel.glb",
    itemName: "Test Fictional Item",
    realName: "Test Real Item"
  };

  /* ── State ── */
  var state = {
    realModelLoaded: false,
    fictionalGlbUrl: null,
    realGlbUrl: null,
    itemName: null,
    realName: null,
    fictionalModel: null,
    fictionalLoaded: false,
    realModel: null,
    showingFictional: false,
    transformed: false,
    // Hidden mark
    markWorldPos: null,       // THREE.Vector3 — hidden mark center on model surface
    markNormal: null,         // THREE.Vector3 — surface normal at mark
    markMesh: null,           // THREE.Mesh — the circular mark indicator
    markRevealed: false,
    // XP
    xp: 0,
    // Touch tracking
    isTouching: false,
    lastTouchPos: { x: 0, y: 0 },
    lastTouchTime: 0,
    lastRubPoint: null,       // THREE.Vector3 — last raycasted point on model
    lastSparkleTime: 0,       // Throttle for mark sparkle particles
    lastZoneIndex: -1,        // For zone transition detection
    // Model info
    modelBBox: null,
    modelMaxDim: 0.2
  };

  /* ── URL Helpers ── */
  function normalizeUrl(url) {
    if (!url || typeof url !== "string") return null;
    var t = url.trim();
    if (!t) return null;
    if (t.startsWith("#")) return t;
    try { return new URL(t, window.location.href).toString(); }
    catch (e) { return t; }
  }

  /* ── Material Fix ── */
  function fixMaterials(object) {
    if (!object) return;
    try {
      object.traverse(function (node) {
        if (node.isMesh && node.material) {
          node.castShadow = true; node.receiveShadow = true; node.frustumCulled = false;
          var mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach(function (mat) {
            if (mat) {
              mat.transparent = false; mat.opacity = 1; mat.depthWrite = true;
              mat.side = THREE.DoubleSide; mat.needsUpdate = true;
              if (mat.map && mat.map.encoding !== THREE.sRGBEncoding) mat.map.encoding = THREE.sRGBEncoding;
              if (mat.emissiveMap && mat.emissiveMap.encoding !== THREE.sRGBEncoding) mat.emissiveMap.encoding = THREE.sRGBEncoding;
            }
          });
        }
      });
    } catch (e) { console.warn("⚠️ fixMaterials:", e); }
  }

  /* ── Pre-AR Overlay ── */
  var preAROverlay = {
    _safetyTimer: null, _dismissed: false,
    setStatus: function (msg) {
      var el = document.getElementById("pre-ar-status");
      if (el) el.textContent = msg;
    },
    enableStart: function () {
      var btn = document.getElementById("enter-ar-button");
      if (btn) { btn.textContent = "Start AR"; btn.disabled = false; }
      this.setStatus("Model ready — tap to enter AR");
    },
    dismissOverlay: function () {
      if (!this._dismissed) {
        this._dismissed = true;
        if (this._safetyTimer) { clearTimeout(this._safetyTimer); this._safetyTimer = null; }
        var ov = document.getElementById("pre-ar-overlay");
        if (ov) ov.classList.add("is-hidden");
      }
    },
    _showOverlay: function () {
      var ov = document.getElementById("pre-ar-overlay");
      if (ov) ov.classList.remove("is-hidden");
      this._dismissed = false;
    },
    bind: function (scene) {
      var self = this;
      this._dismissed = false;
      var btn = document.getElementById("enter-ar-button");
      if (btn) {
        btn.addEventListener("click", function () {
          if (!btn.disabled) {
            btn.disabled = true; btn.textContent = "Starting AR…";
            scene.emit("runreality");
            if (self._safetyTimer) clearTimeout(self._safetyTimer);
            self._safetyTimer = setTimeout(function () { self.dismissOverlay(); }, 5000);
          }
        });
        scene.addEventListener("realityready", function () { self.dismissOverlay(); });
        scene.addEventListener("realityerror", function () {
          if (self._safetyTimer) { clearTimeout(self._safetyTimer); self._safetyTimer = null; }
          self._showOverlay();
          btn.textContent = "AR Failed — Retry"; btn.disabled = false;
          self.setStatus("AR failed to start.\nPlease check camera permissions.");
        });
      }
    }
  };

  /* ── UI Helpers ── */
  function showHint() {
    var el = document.getElementById("ar-hint");
    if (el) el.classList.remove("ar-ui-hidden");
  }

  function updateXPDisplay(xp, threshold) {
    var valEl = document.getElementById("xp-value");
    var barEl = document.getElementById("xp-bar-fill");
    if (valEl) valEl.textContent = Math.floor(xp);
    if (barEl) barEl.style.width = Math.min(100, (xp / threshold) * 100) + "%";
  }

  function showItemName(name) {
    var el = document.getElementById("item-name-display");
    if (el) {
      el.textContent = "✨ " + name;
      el.classList.add("visible");
    }
  }

  function setTouchRipple(x, y, active, color) {
    var el = document.getElementById("touch-ripple");
    if (!el) return;
    if (active) {
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.borderColor = color || "rgba(255,255,255,0.5)";
      el.classList.add("active");
    } else {
      el.classList.remove("active");
    }
  }

  /* ── Model Load with Retry ── */
  function loadModelEntity(element, modelUrl, opts) {
    var label = opts.label || "Model";
    var onLoaded = opts.onLoaded;
    var onFinalError = opts.onFinalError;
    var url = normalizeUrl(modelUrl);
    if (!url) { onFinalError({ attempt: 0, errorType: "invalid_url", url: modelUrl }); return; }

    var attemptCount = 0;
    var loadImpl = function () {
      attemptCount++;
      var done = false;
      var timeoutHandle = null;

      var cleanup = function () {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        element.removeEventListener("model-loaded", onSuccess);
        element.removeEventListener("model-error", onError);
      };

      var onSuccess = function () {
        if (done) return; done = true; cleanup();
        onLoaded({ attempt: attemptCount, url: url });
      };

      var onError = function () {
        if (done) return; done = true; cleanup();
        if (attemptCount <= 2) {
          console.warn("⚠️ " + label + " load failed, retrying " + (attemptCount + 1) + "/3");
          setTimeout(loadImpl, 250);
        } else {
          onFinalError({ attempt: attemptCount, url: url });
        }
      };

      timeoutHandle = setTimeout(function () {
        if (done) return; done = true; cleanup();
        if (attemptCount <= 2) { setTimeout(loadImpl, 250); }
        else { onFinalError({ attempt: attemptCount, errorType: "timeout", url: url }); }
      }, 30000);

      element.removeAttribute("gltf-model");
      setTimeout(function () { element.setAttribute("gltf-model", url); }, attemptCount === 1 ? 0 : 250);
      element.addEventListener("model-loaded", onSuccess);
      element.addEventListener("model-error", onError);
    };

    loadImpl();
  }

  /* ══════════════════════════════════════════════
     Hidden Mark Placement
     ══════════════════════════════════════════════ */

  /**
   * Pick a random point on the surface of the model by:
   * 1. Collecting all mesh triangles
   * 2. Weighted random triangle selection (by area)
   * 3. Random point within that triangle
   */
  function pickRandomSurfacePoint(object3D) {
    var triangles = [];
    var totalArea = 0;
    var _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3();
    var _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _cross = new THREE.Vector3();

    object3D.traverse(function (node) {
      if (!node.isMesh || !node.geometry) return;
      var geo = node.geometry;
      var pos = geo.attributes.position;
      if (!pos) return;

      var idx = geo.index;
      var triCount = idx ? idx.count / 3 : pos.count / 3;

      for (var i = 0; i < triCount; i++) {
        var ia, ib, ic;
        if (idx) {
          ia = idx.getX(i * 3);
          ib = idx.getX(i * 3 + 1);
          ic = idx.getX(i * 3 + 2);
        } else {
          ia = i * 3; ib = i * 3 + 1; ic = i * 3 + 2;
        }

        _va.fromBufferAttribute(pos, ia).applyMatrix4(node.matrixWorld);
        _vb.fromBufferAttribute(pos, ib).applyMatrix4(node.matrixWorld);
        _vc.fromBufferAttribute(pos, ic).applyMatrix4(node.matrixWorld);

        _ab.subVectors(_vb, _va);
        _ac.subVectors(_vc, _va);
        _cross.crossVectors(_ab, _ac);
        var area = _cross.length() * 0.5;

        if (area > 1e-8) {
          totalArea += area;
          triangles.push({
            a: _va.clone(), b: _vb.clone(), c: _vc.clone(),
            normal: _cross.normalize().clone(),
            area: area, cumArea: totalArea
          });
        }
      }
    });

    if (triangles.length === 0) return null;

    // Weighted random selection
    var r = Math.random() * totalArea;
    var tri = triangles[triangles.length - 1];
    for (var i = 0; i < triangles.length; i++) {
      if (triangles[i].cumArea >= r) { tri = triangles[i]; break; }
    }

    // Random point in triangle (barycentric)
    var u = Math.random(), v = Math.random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    var point = new THREE.Vector3()
      .addScaledVector(tri.a, 1 - u - v)
      .addScaledVector(tri.b, u)
      .addScaledVector(tri.c, v);

    return { point: point, normal: tri.normal };
  }

  /**
   * Create the circular mark mesh at the given position on the model surface.
   * Initially invisible; becomes visible when found.
   */
  function createMarkMesh(position, normal) {
    var cfg = CFG.mark;
    var geo = new THREE.CircleGeometry(cfg.radius, 32);
    var mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(cfg.color),
      transparent: true,
      opacity: cfg.opacity,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);

    // Orient the circle to align with the surface normal
    var up = new THREE.Vector3(0, 0, 1);
    var quat = new THREE.Quaternion().setFromUnitVectors(up, normal);
    mesh.quaternion.copy(quat);

    // Slight offset along normal to prevent z-fighting
    mesh.position.addScaledVector(normal, 0.002);

    mesh.renderOrder = 100;
    return mesh;
  }

  /* ══════════════════════════════════════════════
     Star Dust Particles
     ══════════════════════════════════════════════ */

  var particlePool = [];

  function spawnStarDust(sceneEl, worldPos, screenTarget) {
    var cfg = CFG.particles;
    var count = cfg.count;
    var cam = sceneEl.camera;
    if (!cam) return;

    for (var i = 0; i < count; i++) {
      (function (delay) {
        setTimeout(function () {
          var geo = new THREE.SphereGeometry(cfg.size, 6, 6);
          var mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(cfg.color),
            transparent: true, opacity: 1,
            blending: THREE.AdditiveBlending, depthWrite: false
          });
          var p = new THREE.Mesh(geo, mat);

          // Start at rub point with some random spread
          p.position.copy(worldPos);
          p.position.x += (Math.random() - 0.5) * 0.03;
          p.position.y += (Math.random() - 0.5) * 0.03;
          p.position.z += (Math.random() - 0.5) * 0.03;

          sceneEl.object3D.add(p);

          // Fly toward camera (approximation of flying to XP counter)
          var camWorldPos = new THREE.Vector3();
          cam.getWorldPosition(camWorldPos);
          // Offset toward bottom-left of view
          var left = new THREE.Vector3(-0.3, -0.2, 0);
          left.applyQuaternion(cam.quaternion);
          var target = camWorldPos.clone().add(left);

          var startPos = p.position.clone();
          var t0 = Date.now();
          var dur = cfg.lifetime + Math.random() * 200;

          function animateParticle() {
            var elapsed = Date.now() - t0;
            var t = Math.min(elapsed / dur, 1);
            var ease = t * t; // ease-in

            p.position.lerpVectors(startPos, target, ease);
            p.material.opacity = 1 - t * t;

            // Slight spiral
            var angle = t * Math.PI * 4;
            var spiral = 0.02 * (1 - t);
            p.position.x += Math.cos(angle) * spiral;
            p.position.y += Math.sin(angle) * spiral;

            if (t < 1) {
              requestAnimationFrame(animateParticle);
            } else {
              sceneEl.object3D.remove(p);
              geo.dispose(); mat.dispose();
            }
          }
          requestAnimationFrame(animateParticle);

        }, delay * 40);
      })(i);
    }
  }

  /* ══════════════════════════════════════════════
     Mark Sparkle Particles (golden shimmer at mark)
     ══════════════════════════════════════════════ */

  function spawnMarkSparkle(sceneEl, markPos, markNormal) {
    var cfg = CFG.sparkle;
    var count = cfg.count;

    for (var i = 0; i < count; i++) {
      (function (delay) {
        setTimeout(function () {
          var geo = new THREE.SphereGeometry(cfg.size, 4, 4);
          var mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(cfg.color),
            transparent: true, opacity: 0.8,
            blending: THREE.AdditiveBlending, depthWrite: false
          });
          var p = new THREE.Mesh(geo, mat);

          // Start at mark position with random spread within mark radius
          p.position.copy(markPos);
          var spread = CFG.mark.radius * 0.8;
          p.position.x += (Math.random() - 0.5) * spread;
          p.position.y += (Math.random() - 0.5) * spread;
          p.position.z += (Math.random() - 0.5) * spread;

          sceneEl.object3D.add(p);

          // Drift along surface normal
          var startPos = p.position.clone();
          var drift = cfg.driftDistance * (0.6 + Math.random() * 0.4);
          var target = startPos.clone().addScaledVector(markNormal, drift);
          // Slight lateral wobble
          var lateral = new THREE.Vector3(
            (Math.random() - 0.5) * 0.02,
            (Math.random() - 0.5) * 0.02,
            (Math.random() - 0.5) * 0.02
          );
          target.add(lateral);

          var t0 = Date.now();
          var dur = cfg.lifetime * (0.8 + Math.random() * 0.4);

          function animateSparkle() {
            var elapsed = Date.now() - t0;
            var t = Math.min(elapsed / dur, 1);

            p.position.lerpVectors(startPos, target, t);
            // Pop-and-fade: scale up then shrink
            var scale = t < 0.3 ? 1 + t * 1.5 : 1.45 * (1 - (t - 0.3) / 0.7);
            p.scale.setScalar(Math.max(scale, 0.01));
            p.material.opacity = 0.8 * (1 - t * t);

            if (t < 1) {
              requestAnimationFrame(animateSparkle);
            } else {
              sceneEl.object3D.remove(p);
              geo.dispose(); mat.dispose();
            }
          }
          requestAnimationFrame(animateSparkle);
        }, delay * 30);
      })(i);
    }
  }

  /* ══════════════════════════════════════════════
     Raycaster for touch → model surface
     ══════════════════════════════════════════════ */

  var _raycaster = new THREE.Raycaster();
  var _pointer = new THREE.Vector2();

  function raycastToModel(camera, screenX, screenY, modelObject3D, canvasWidth, canvasHeight) {
    _pointer.x = (screenX / canvasWidth) * 2 - 1;
    _pointer.y = -(screenY / canvasHeight) * 2 + 1;
    _raycaster.setFromCamera(_pointer, camera);

    var meshes = [];
    modelObject3D.traverse(function (node) {
      if (node.isMesh) meshes.push(node);
    });

    var hits = _raycaster.intersectObjects(meshes, false);
    return hits.length > 0 ? hits[0] : null;
  }

  /* ══════════════════════════════════════════════
     Zone Lookup
     ══════════════════════════════════════════════ */

  function getZone(dist) {
    var zones = CFG.feedback.zones;
    for (var i = 0; i < zones.length; i++) {
      if (dist <= zones[i].maxDist) return { zone: zones[i], index: i };
    }
    return { zone: zones[zones.length - 1], index: zones.length - 1 };
  }

  /* ══════════════════════════════════════════════
     Proximity Ring (arc around touch ripple)
     ══════════════════════════════════════════════ */

  function setProximityRing(x, y, active, progress, color) {
    var el = document.getElementById("proximity-ring");
    if (!el) return;
    if (active) {
      el.style.left = x + "px";
      el.style.top = y + "px";
      var deg = Math.round(progress * 360);
      el.style.background = "conic-gradient(" + color + " " + deg + "deg, transparent " + deg + "deg)";
      el.classList.add("active");
    } else {
      el.classList.remove("active");
    }
  }

  /* ══════════════════════════════════════════════
     Zone Transition Pop
     ══════════════════════════════════════════════ */

  var _zonePopTimer = null;

  function showZonePop(label, color) {
    var el = document.getElementById("zone-pop");
    if (!el) return;
    // Reset animation
    el.classList.remove("pop");
    el.textContent = label;
    el.style.color = color;
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add("pop");
    if (_zonePopTimer) clearTimeout(_zonePopTimer);
    _zonePopTimer = setTimeout(function () { el.classList.remove("pop"); }, 800);
  }

  /* ══════════════════════════════════════════════
     Main Component: rub-ar-interaction
     ══════════════════════════════════════════════ */

  AFRAME.registerComponent("rub-ar-interaction", {
    init: function () {
      console.log("🎮 Rub AR Interaction initializing...");
      var self = this;
      preAROverlay.bind(this.el);

      var params = new URLSearchParams(window.location.search);
      var config;
      if (TEST.enabled) {
        config = {
          realGlb: TEST.realGlb, fictionalGlb: TEST.fictionalGlb,
          interaction: "Rub", itemName: TEST.itemName, realName: TEST.realName
        };
      } else {
        config = {
          realGlb: normalizeUrl(params.get("real_glb")),
          fictionalGlb: normalizeUrl(params.get("fictional_glb")),
          interaction: params.get("interaction") || "Rub",
          itemName: params.get("item_name") || "Fictional Item",
          realName: params.get("real_name") || "Real Item"
        };
      }

      console.log("📦 Config:", config);

      if (!config.realGlb) {
        console.error("❌ Missing real_glb parameter");
        return;
      }

      state.fictionalGlbUrl = config.fictionalGlb;
      state.realGlbUrl = config.realGlb;
      state.itemName = config.itemName;
      state.realName = config.realName;

      this.loadRealModel(config.realGlb);

      // Touch event listeners
      var canvas = this.el.canvas;
      this._onTouchStart = this.onTouchStart.bind(this);
      this._onTouchMove = this.onTouchMove.bind(this);
      this._onTouchEnd = this.onTouchEnd.bind(this);
      this._onMouseDown = this.onMouseDown.bind(this);
      this._onMouseMove = this.onMouseMove.bind(this);
      this._onMouseUp = this.onMouseUp.bind(this);

      // Bind after scene is ready
      this.el.addEventListener("loaded", function () {
        showHint();
        var c = self.el.canvas;
        if (c) {
          c.addEventListener("touchstart", self._onTouchStart, { passive: false });
          c.addEventListener("touchmove", self._onTouchMove, { passive: false });
          c.addEventListener("touchend", self._onTouchEnd);
          c.addEventListener("mousedown", self._onMouseDown);
          c.addEventListener("mousemove", self._onMouseMove);
          c.addEventListener("mouseup", self._onMouseUp);
        }
      });

      updateXPDisplay(0, CFG.xp.threshold);
    },

    loadRealModel: function (modelUrl) {
      var self = this;
      var realEl = document.getElementById("realModel");
      if (!realEl) { console.error("❌ #realModel not found"); return; }

      loadModelEntity(realEl, modelUrl, {
        label: "Real Item 3D",
        onLoaded: function () {
          console.log("✅ Real Item 3D loaded");
          state.realModelLoaded = true;
          state.realModel = realEl;
          var mesh = realEl.getObject3D("mesh");
          if (mesh) {
            fixMaterials(mesh);
            self.placeHiddenMark(mesh, realEl);
          }

          if (state.fictionalGlbUrl) {
            self.preloadFictionalItem();
          }

          window.dispatchEvent(new CustomEvent("ei:realModel:ready", { detail: { modelId: "realModel" } }));
          preAROverlay.enableStart();
        },
        onFinalError: function (err) {
          console.error("❌ Failed to load Real Item 3D:", err);
        }
      });
    },

    placeHiddenMark: function (mesh, modelEl) {
      // Compute bounding box
      var box = new THREE.Box3().setFromObject(mesh);
      var size = new THREE.Vector3(); box.getSize(size);
      state.modelMaxDim = Math.max(size.x, size.y, size.z, 0.2);
      state.modelBBox = box;

      // Pick random surface point for hidden mark
      var result = pickRandomSurfacePoint(mesh);
      if (!result) {
        console.warn("⚠️ Could not pick surface point, using center");
        var center = new THREE.Vector3(); box.getCenter(center);
        result = { point: center, normal: new THREE.Vector3(0, 0, 1) };
      }

      state.markWorldPos = result.point;
      state.markNormal = result.normal;

      // Create the mark mesh (invisible initially)
      state.markMesh = createMarkMesh(result.point, result.normal);
      // Add to the model-holder so it moves with the model
      var holder = document.getElementById("model-holder");
      if (holder) {
        holder.object3D.add(state.markMesh);
      }

      if (CFG.debug) {
        console.log("📍 Hidden mark placed at:", result.point.toArray().map(function(v) { return v.toFixed(3); }));
      }
    },

    preloadFictionalItem: function () {
      if (!state.fictionalGlbUrl || state.fictionalLoaded) return;
      var holder = document.getElementById("model-holder");
      if (!holder) return;

      var el = document.createElement("a-entity");
      el.setAttribute("id", "fictionalModel");
      el.setAttribute("position", "0 0 0");
      el.setAttribute("visible", "false");
      el.setAttribute("shadow", "cast: true; receive: true");
      holder.appendChild(el);

      loadModelEntity(el, state.fictionalGlbUrl, {
        label: "Fictional Item 3D",
        onLoaded: function () {
          var mesh = el.getObject3D("mesh");
          if (mesh) { fixMaterials(mesh); el.setAttribute("visible", "false"); }
          state.fictionalModel = el;
          state.fictionalLoaded = true;
          console.log("✅ Fictional Item preloaded (hidden)");
        },
        onFinalError: function (err) {
          console.error("❌ Failed to load Fictional Item:", err);
        }
      });
    },

    /* ── Touch Handlers ── */

    onTouchStart: function (e) {
      if (state.transformed) return;
      e.preventDefault();
      var touch = e.touches[0];
      state.isTouching = true;
      state.lastTouchPos = { x: touch.clientX, y: touch.clientY };
      state.lastTouchTime = Date.now();
    },

    onTouchMove: function (e) {
      if (!state.isTouching || state.transformed) return;
      e.preventDefault();
      var touch = e.touches[0];
      this.handleRubMove(touch.clientX, touch.clientY);
    },

    onTouchEnd: function () {
      state.isTouching = false;
      state.lastRubPoint = null;
      setTouchRipple(0, 0, false);
      setProximityRing(0, 0, false, 0, "");
    },

    onMouseDown: function (e) {
      if (state.transformed) return;
      state.isTouching = true;
      state.lastTouchPos = { x: e.clientX, y: e.clientY };
      state.lastTouchTime = Date.now();
    },

    onMouseMove: function (e) {
      if (!state.isTouching || state.transformed) return;
      this.handleRubMove(e.clientX, e.clientY);
    },

    onMouseUp: function () {
      state.isTouching = false;
      state.lastRubPoint = null;
      setTouchRipple(0, 0, false);
      setProximityRing(0, 0, false, 0, "");
    },

    /* ── Core Rub Logic ── */

    handleRubMove: function (screenX, screenY) {
      var now = Date.now();

      // Throttle
      if (now - state.lastTouchTime < CFG.rub.sampleInterval) return;

      // Check movement speed
      var dx = screenX - state.lastTouchPos.x;
      var dy = screenY - state.lastTouchPos.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var dt = (now - state.lastTouchTime) / 1000;
      var speed = dt > 0 ? dist / dt : 0;

      state.lastTouchPos = { x: screenX, y: screenY };
      state.lastTouchTime = now;

      // Must be moving fast enough to count as rubbing
      if (speed < CFG.rub.minMoveSpeed) return;

      // Raycast to model surface
      var realEl = state.realModel;
      if (!realEl) return;
      var mesh = realEl.getObject3D("mesh");
      if (!mesh) return;

      var cam = this.el.camera;
      if (!cam) return;

      var canvas = this.el.canvas;
      var hit = raycastToModel(cam, screenX, screenY, mesh, canvas.clientWidth, canvas.clientHeight);

      if (!hit) {
        setTouchRipple(screenX, screenY, false);
        setProximityRing(screenX, screenY, false, 0, "");
        return;
      }

      state.lastRubPoint = hit.point;

      // Compute distance to hidden mark
      if (!state.markWorldPos) return;
      var distToMark = hit.point.distanceTo(state.markWorldPos);

      // Zone-based progressive feedback
      var result = getZone(distToMark);
      var zone = result.zone;
      var zoneIndex = result.index;

      // Proximity progress (0 = far, 1 = on mark) — use Cold boundary as max tracking distance
      var maxTrackDist = CFG.feedback.zones[CFG.feedback.zones.length - 1].maxDist;
      if (!isFinite(maxTrackDist)) maxTrackDist = CFG.feedback.zones[CFG.feedback.zones.length - 2].maxDist;
      var progress = Math.max(0, Math.min(1, 1 - distToMark / maxTrackDist));

      // Touch ripple: zone color normally, purple when inside mark area
      var hitRadius = CFG.mark.radius + CFG.rub.touchRadius;
      var nearMark = distToMark <= hitRadius;
      setTouchRipple(screenX, screenY, true, nearMark ? "#9C27B0" : zone.color);

      // Proximity ring
      setProximityRing(screenX, screenY, true, progress, zone.color);

      // Zone transition pop (only when getting warmer = lower index)
      if (zoneIndex !== state.lastZoneIndex && zoneIndex < state.lastZoneIndex) {
        showZonePop(zone.label, zone.color);
        if (navigator.vibrate) navigator.vibrate(zone.haptic + 30);
      }
      state.lastZoneIndex = zoneIndex;

      // Haptic feedback from zone
      if (navigator.vibrate && zone.haptic > 0) {
        navigator.vibrate(zone.haptic);
      }

      // XP: all zones give XP, scaled by zone multiplier
      var xpGain = CFG.xp.perRub * zone.xpMult;
      state.xp = Math.min(state.xp + xpGain, CFG.xp.threshold);
      updateXPDisplay(state.xp, CFG.xp.threshold);

      // Particles only in Hot zone or closer (index <= 1)
      if (zoneIndex <= 1) {
        spawnStarDust(this.el, hit.point, null);
      }

      // Mark sparkle when inside mark area
      if (nearMark && now - state.lastSparkleTime >= 150) {
        state.lastSparkleTime = now;
        spawnMarkSparkle(this.el, state.markWorldPos, state.markNormal || new THREE.Vector3(0, 1, 0));
      }

      // Reveal mark + show floating indicator
      if (distToMark <= CFG.mark.radius + 0.02 && !state.markRevealed) {
        this.revealMark();
      }

      // Check transformation threshold
      if (state.xp >= CFG.xp.threshold && !state.transformed) {
        this.triggerTransformation();
      }
    },

    revealMark: function () {
      if (state.markRevealed || !state.markMesh) return;
      state.markRevealed = true;
      console.log("🎯 Hidden mark revealed!");

      // Fade in the mark on model surface
      var mesh = state.markMesh;
      var targetOpacity = CFG.mark.revealOpacity;
      var t0 = Date.now();
      var dur = 500;

      function fadeIn() {
        var t = Math.min((Date.now() - t0) / dur, 1);
        mesh.material.opacity = t * targetOpacity;
        if (t < 1) requestAnimationFrame(fadeIn);
      }
      requestAnimationFrame(fadeIn);

      // Create floating purple circle indicator above the model
      this.createFloatingIndicator();

      // Update hint
      var hint = document.getElementById("interaction-hint");
      if (hint) hint.textContent = "You found it! Keep rubbing!";
    },

    createFloatingIndicator: function () {
      var holder = document.getElementById("model-holder");
      if (!holder || !state.modelBBox) return;

      // Position above the model's top
      var center = new THREE.Vector3();
      state.modelBBox.getCenter(center);
      var topY = state.modelBBox.max.y + state.modelMaxDim * 0.3;

      // Outer ring
      var ringGeo = new THREE.RingGeometry(0.04, 0.06, 32);
      var ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color("#9C27B0"),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      var ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(center.x, topY, center.z);
      ring.renderOrder = 200;

      // Inner filled circle
      var circleGeo = new THREE.CircleGeometry(0.035, 32);
      var circleMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color("#CE93D8"),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      var circle = new THREE.Mesh(circleGeo, circleMat);
      circle.position.set(center.x, topY, center.z);
      circle.renderOrder = 201;

      holder.object3D.add(ring);
      holder.object3D.add(circle);

      state._floatingRing = ring;
      state._floatingCircle = circle;

      // Fade-in + float animation
      var t0 = Date.now();
      var fadeInDur = 600;
      var baseY = topY;

      function animateIndicator() {
        var elapsed = Date.now() - t0;
        // Fade in
        var fadeT = Math.min(elapsed / fadeInDur, 1);
        ring.material.opacity = fadeT * 0.9;
        circle.material.opacity = fadeT * 0.5;

        // Gentle bob
        var bob = Math.sin(elapsed * 0.003) * 0.015;
        ring.position.y = baseY + bob;
        circle.position.y = baseY + bob;

        // Always face camera
        var cam = document.getElementById("camera");
        if (cam && cam.object3D) {
          var camWorldQuat = new THREE.Quaternion();
          cam.object3D.getWorldQuaternion(camWorldQuat);
          ring.quaternion.copy(camWorldQuat);
          circle.quaternion.copy(camWorldQuat);
        }

        if (!state.transformed) {
          requestAnimationFrame(animateIndicator);
        } else {
          // Fade out when transformed
          ring.material.opacity *= 0.9;
          circle.material.opacity *= 0.9;
          if (ring.material.opacity > 0.01) {
            requestAnimationFrame(animateIndicator);
          } else {
            holder.object3D.remove(ring);
            holder.object3D.remove(circle);
            ringGeo.dispose(); ringMat.dispose();
            circleGeo.dispose(); circleMat.dispose();
          }
        }
      }
      requestAnimationFrame(animateIndicator);
    },

    triggerTransformation: function () {
      state.transformed = true;
      state.isTouching = false;
      setTouchRipple(0, 0, false);
      setProximityRing(0, 0, false, 0, "");
      console.log("🔮 Transformation triggered!");

      var self = this;
      var swapDelay = CFG.swap.delay;

      // Flash effect
      var flashDur = CFG.swap.flashDuration;

      setTimeout(function () {
        self.swapModels();
      }, swapDelay);
    },

    swapModels: function () {
      var realEl = document.getElementById("realModel");
      var fictEl = document.getElementById("fictionalModel");

      // Hide mark
      if (state.markMesh) {
        state.markMesh.visible = false;
      }

      if (realEl) realEl.setAttribute("visible", "false");
      if (fictEl) fictEl.setAttribute("visible", "true");
      state.showingFictional = true;

      showItemName(state.itemName || "Fictional Item");

      // Show back button
      var backBtn = document.getElementById("back-to-main");
      if (backBtn) {
        setTimeout(function () {
          backBtn.classList.add("visible");
        }, 1000);
      }
    },

    /* ── Mark Glow Animation (tick) ── */
    tick: function (time) {
      if (!state.markMesh || !state.markRevealed) return;

      // Pulse glow
      var pulse = 0.5 + 0.5 * Math.sin(time * 0.001 * CFG.mark.pulseSpeed * Math.PI * 2);
      var baseColor = new THREE.Color(CFG.mark.color);
      var glowColor = new THREE.Color(CFG.mark.glowColor);
      state.markMesh.material.color.copy(baseColor).lerp(glowColor, pulse);
    },

    remove: function () {
      var c = this.el.canvas;
      if (c) {
        c.removeEventListener("touchstart", this._onTouchStart);
        c.removeEventListener("touchmove", this._onTouchMove);
        c.removeEventListener("touchend", this._onTouchEnd);
        c.removeEventListener("mousedown", this._onMouseDown);
        c.removeEventListener("mousemove", this._onMouseMove);
        c.removeEventListener("mouseup", this._onMouseUp);
      }
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    console.log("📱 DOM ready for Rub AR");
  });
})();
