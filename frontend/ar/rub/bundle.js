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
    debug: false,
    mark: {
      radius: 0.8, color: "#FF0000", glowColor: "#FFA500",
      opacity: 1.0, revealOpacity: 0.85, pulseSpeed: 1.5
    },
    rub: { minMoveSpeed: 30, sampleInterval: 16, touchRadius: 0.55 },
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
    particles: { count: 5, size: 0.015, speed: 1.5, color: "#9C27B0", trailLength: 3, lifetime: 800 },
    sparkle: { count: 3, size: 0.008, lifetime: 500, color: "#CE93D8", driftDistance: 0.05 },
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
    fictionalGlb: "assets/fictionalmodel.glb?v=2",
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
    currentModel: "real",     // "real" | "fictional" — which model is active
    roundCount: 0,            // Number of completed transformations
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
    // Genie lamp effects
    isRubbingMark: false,     // Whether actively rubbing inside mark area
    rubStartTime: 0,          // When rubbing started (for shake animation)
    currentEmissive: 0,       // Current emissive intensity (for smooth transitions)
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
    var pct = xp / threshold;
    if (valEl) {
      valEl.textContent = Math.floor(xp);
      var textGlow = Math.round(4 + pct * 12);
      valEl.style.textShadow = "0 0 " + textGlow + "px rgba(124,77,255," + (0.4 + pct * 0.6).toFixed(2) + ")";
    }
    if (barEl) {
      barEl.style.width = Math.min(100, pct * 100) + "%";
      var glowSize = Math.round(4 + pct * 16);
      var glowOpacity = (0.4 + pct * 0.6).toFixed(2);
      barEl.style.boxShadow = "0 0 " + glowSize + "px rgba(124,77,255," + glowOpacity + ")";
    }
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
      el.style.transform = "translate(calc(" + x + "px - 50%), calc(" + y + "px - 50%))";
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
     Purple Smoke Effect (mystical fog)
     ══════════════════════════════════════════════ */

  var _smokeTexture = null;
  function getSmokeTexture() {
    if (_smokeTexture) return _smokeTexture;
    var size = 64;
    var canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext("2d");
    var gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.6)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    _smokeTexture = new THREE.CanvasTexture(canvas);
    return _smokeTexture;
  }

  function spawnGenieSmoke(sceneEl, markPos, markNormal, intensity) {
    // Layer 1: Dense purple fog puffs (large, expanding, slow rise)
    var smokeCount = 2 + Math.floor(intensity * 2); // 2-4
    for (var s = 0; s < smokeCount; s++) {
      (function (delay) {
        setTimeout(function () {
          var size = 0.02 + intensity * 0.03;
          var geo = new THREE.SphereGeometry(size, 8, 8);
          var mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color("#4A148C"),
            transparent: true, opacity: 0.5,
            blending: THREE.NormalBlending, depthWrite: false
          });
          var p = new THREE.Mesh(geo, mat);

          p.position.copy(markPos);
          var spread = 0.02;
          p.position.x += (Math.random() - 0.5) * spread;
          p.position.y += (Math.random() - 0.5) * spread;
          p.position.z += (Math.random() - 0.5) * spread;

          sceneEl.object3D.add(p);

          var startPos = p.position.clone();
          var drift = (0.1 + Math.random() * 0.1) * (1 + intensity);
          var target = startPos.clone().addScaledVector(markNormal, drift);
          target.x += (Math.random() - 0.5) * 0.04;
          target.z += (Math.random() - 0.5) * 0.04;

          var t0 = Date.now();
          var dur = 800 + Math.random() * 400;

          function animateSmoke() {
            var t = Math.min((Date.now() - t0) / dur, 1);
            p.position.lerpVectors(startPos, target, t);
            var sc = 1 + t * 2.0;
            p.scale.setScalar(sc);
            p.material.opacity = 0.5 * (1 - t);
            if (t < 1) { requestAnimationFrame(animateSmoke); }
            else { sceneEl.object3D.remove(p); geo.dispose(); mat.dispose(); }
          }
          requestAnimationFrame(animateSmoke);
        }, delay * 25);
      })(s);
    }

    // Layer 2: Purple smoke wisps (soft fog tendrils with turbulence)
    var smokeColors = ["#7B1FA2", "#9C27B0", "#CE93D8"];
    var wispsCount = 4 + Math.floor(intensity * 3); // 4-7
    for (var d = 0; d < wispsCount; d++) {
      (function (delay) {
        setTimeout(function () {
          var planeSize = 0.03 + intensity * 0.04;
          var geo = new THREE.PlaneGeometry(planeSize, planeSize);
          var color = smokeColors[Math.floor(Math.random() * smokeColors.length)];
          var startOpacity = 0.45 + Math.random() * 0.15;
          var mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            map: getSmokeTexture(),
            transparent: true, opacity: startOpacity,
            blending: THREE.NormalBlending, depthWrite: false,
            side: THREE.DoubleSide
          });
          var p = new THREE.Mesh(geo, mat);

          p.position.copy(markPos);
          var spread = 0.025;
          p.position.x += (Math.random() - 0.5) * spread;
          p.position.y += (Math.random() - 0.5) * spread;
          p.position.z += (Math.random() - 0.5) * spread;

          var initRotZ = Math.random() * Math.PI * 2;

          sceneEl.object3D.add(p);

          var startPos = p.position.clone();
          var driftSpeed = (0.06 + Math.random() * 0.08) * (1 + intensity * 0.5);

          // Tangent/bitangent for turbulence axes
          var up = Math.abs(markNormal.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
          var tangent = new THREE.Vector3().crossVectors(markNormal, up).normalize();
          var bitangent = new THREE.Vector3().crossVectors(markNormal, tangent).normalize();

          var wanderX = 0, wanderZ = 0;
          var wanderStrength = 0.003 + Math.random() * 0.003;
          var swayPhase = Math.random() * Math.PI * 2;
          var swayFreq = 2 + Math.random() * 2;
          var swayAmp = 0.008 + Math.random() * 0.008;

          var t0 = Date.now();
          var dur = 1000 + Math.random() * 800;
          var maxScale = 2.5 + Math.random() * 1.0;

          function animateWisp() {
            var t = Math.min((Date.now() - t0) / dur, 1);

            // Drift along normal
            var driftDist = driftSpeed * t;
            p.position.copy(startPos).addScaledVector(markNormal, driftDist);

            // Random walk turbulence
            wanderX += (Math.random() - 0.5) * wanderStrength;
            wanderZ += (Math.random() - 0.5) * wanderStrength;
            p.position.addScaledVector(tangent, wanderX);
            p.position.addScaledVector(bitangent, wanderZ);

            // Sinusoidal sway
            var sway = Math.sin(swayPhase + t * swayFreq * Math.PI) * swayAmp;
            p.position.addScaledVector(tangent, sway);

            // Billboard: face camera
            var cam = sceneEl.camera;
            if (cam) p.quaternion.copy(cam.quaternion);

            // Apply initial Z rotation on top of billboard
            var zRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), initRotZ + t * 0.5);
            p.quaternion.multiply(zRot);

            // Ease-out expansion
            var easeT = 1 - Math.pow(1 - t, 2);
            var sc = 1 + easeT * (maxScale - 1);
            p.scale.setScalar(sc);

            // Opacity: hold 30%, then fade
            if (t < 0.3) {
              mat.opacity = startOpacity;
            } else {
              mat.opacity = startOpacity * (1 - ((t - 0.3) / 0.7));
            }

            if (t < 1) { requestAnimationFrame(animateWisp); }
            else { sceneEl.object3D.remove(p); geo.dispose(); mat.dispose(); }
          }
          requestAnimationFrame(animateWisp);
        }, delay * 30);
      })(d);
    }
  }

  /* ══════════════════════════════════════════════
     Burst Particles (transformation climax)
     ══════════════════════════════════════════════ */

  function burstParticles(sceneEl, markPos, markNormal) {
    var count = 20;
    var colors = ["#1A237E", "#311B92", "#4A148C", "#283593", "#7C4DFF", "#B388FF"];

    for (var i = 0; i < count; i++) {
      (function (idx) {
        var size = 0.015 + Math.random() * 0.025;
        var geo = new THREE.SphereGeometry(size, 6, 6);
        var col = colors[Math.floor(Math.random() * colors.length)];
        var mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(col),
          transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false
        });
        var p = new THREE.Mesh(geo, mat);
        p.position.copy(markPos);

        sceneEl.object3D.add(p);

        var startPos = p.position.clone();
        // Radial burst direction with some upward bias along normal
        var dir = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2
        ).normalize();
        dir.addScaledVector(markNormal, 0.5).normalize();
        var dist = 0.15 + Math.random() * 0.25;
        var target = startPos.clone().addScaledVector(dir, dist);

        var t0 = Date.now();
        var dur = 600 + Math.random() * 600;

        function animateBurst() {
          var t = Math.min((Date.now() - t0) / dur, 1);
          var ease = 1 - Math.pow(1 - t, 2); // ease-out
          p.position.lerpVectors(startPos, target, ease);
          p.material.opacity = 1 - t;
          var sc = 1 + t * 0.5;
          p.scale.setScalar(sc);
          if (t < 1) { requestAnimationFrame(animateBurst); }
          else { sceneEl.object3D.remove(p); geo.dispose(); mat.dispose(); }
        }
        requestAnimationFrame(animateBurst);
      })(i);
    }
  }

  /* ══════════════════════════════════════════════
     Lightning Bolt Effect (purple-blue electric arcs)
     ══════════════════════════════════════════════ */

  function spawnLightningBolt(sceneEl, origin, direction, length) {
    var segments = 8 + Math.floor(Math.random() * 6);
    var points = [];
    var pos = origin.clone();
    var segLen = length / segments;
    var jitter = length * 0.15;

    points.push(pos.clone());
    for (var i = 0; i < segments; i++) {
      pos = pos.clone().addScaledVector(direction, segLen);
      // Add lateral jitter perpendicular to direction
      var perp1 = new THREE.Vector3(direction.y, -direction.x, direction.z).normalize();
      var perp2 = new THREE.Vector3().crossVectors(direction, perp1).normalize();
      pos.addScaledVector(perp1, (Math.random() - 0.5) * jitter);
      pos.addScaledVector(perp2, (Math.random() - 0.5) * jitter);
      points.push(pos.clone());
    }

    var geo = new THREE.BufferGeometry().setFromPoints(points);
    var colors = ["#8080FF", "#A0A0FF", "#C0C0FF", "#6060DD"];
    var col = colors[Math.floor(Math.random() * colors.length)];
    var mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(col),
      transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
      linewidth: 2
    });
    var line = new THREE.Line(geo, mat);
    line.renderOrder = 300;
    sceneEl.object3D.add(line);

    // Flicker + fade
    var t0 = Date.now();
    var dur = 150 + Math.random() * 200;
    function animateBolt() {
      var t = (Date.now() - t0) / dur;
      if (t >= 1) {
        sceneEl.object3D.remove(line);
        geo.dispose(); mat.dispose();
        return;
      }
      // Flicker effect
      mat.opacity = (1 - t) * (Math.random() > 0.3 ? 1 : 0.3);
      requestAnimationFrame(animateBolt);
    }
    requestAnimationFrame(animateBolt);

    // Spawn a small branch occasionally
    if (Math.random() > 0.5 && points.length > 3) {
      var branchIdx = 2 + Math.floor(Math.random() * (points.length - 3));
      var branchDir = new THREE.Vector3(
        (Math.random() - 0.5),
        (Math.random() - 0.5),
        (Math.random() - 0.5)
      ).normalize();
      spawnLightningBranch(sceneEl, points[branchIdx], branchDir, length * 0.3);
    }
  }

  function spawnLightningBranch(sceneEl, origin, direction, length) {
    var segments = 4;
    var points = [];
    var pos = origin.clone();
    var segLen = length / segments;
    var jitter = length * 0.2;

    points.push(pos.clone());
    for (var i = 0; i < segments; i++) {
      pos = pos.clone().addScaledVector(direction, segLen);
      pos.x += (Math.random() - 0.5) * jitter;
      pos.y += (Math.random() - 0.5) * jitter;
      pos.z += (Math.random() - 0.5) * jitter;
      points.push(pos.clone());
    }

    var geo = new THREE.BufferGeometry().setFromPoints(points);
    var mat = new THREE.LineBasicMaterial({
      color: new THREE.Color("#9090FF"),
      transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var line = new THREE.Line(geo, mat);
    line.renderOrder = 300;
    sceneEl.object3D.add(line);

    var t0 = Date.now();
    var dur = 100 + Math.random() * 100;
    function animateBranch() {
      var t = (Date.now() - t0) / dur;
      if (t >= 1) {
        sceneEl.object3D.remove(line);
        geo.dispose(); mat.dispose();
        return;
      }
      mat.opacity = 0.7 * (1 - t) * (Math.random() > 0.4 ? 1 : 0.2);
      requestAnimationFrame(animateBranch);
    }
    requestAnimationFrame(animateBranch);
  }

  /* ══════════════════════════════════════════════
     Massive Smoke Eruption (transformation climax)
     ══════════════════════════════════════════════ */

  function smokeEruption(sceneEl, centerPos) {
    var smokeColors = ["#1A0A4A", "#2D1B69", "#4A148C", "#311B92", "#1A237E", "#283593"];
    var count = 30;

    for (var i = 0; i < count; i++) {
      (function (idx) {
        setTimeout(function () {
          var size = 0.04 + Math.random() * 0.08;
          var geo = new THREE.PlaneGeometry(size, size);
          var col = smokeColors[Math.floor(Math.random() * smokeColors.length)];
          var mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(col),
            map: getSmokeTexture(),
            transparent: true, opacity: 0.7,
            blending: THREE.NormalBlending, depthWrite: false,
            side: THREE.DoubleSide
          });
          var p = new THREE.Mesh(geo, mat);
          p.position.copy(centerPos);
          p.position.x += (Math.random() - 0.5) * 0.05;
          p.position.y += (Math.random() - 0.5) * 0.05;
          p.position.z += (Math.random() - 0.5) * 0.05;

          sceneEl.object3D.add(p);

          var startPos = p.position.clone();
          // Radial outward + upward drift
          var dir = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            0.3 + Math.random() * 0.7,
            (Math.random() - 0.5) * 2
          ).normalize();
          var dist = 0.15 + Math.random() * 0.3;
          var target = startPos.clone().addScaledVector(dir, dist);

          var initRot = Math.random() * Math.PI * 2;
          var rotSpeed = (Math.random() - 0.5) * 2;
          var maxScale = 3 + Math.random() * 3;

          var t0 = Date.now();
          var dur = 1200 + Math.random() * 800;

          function animateEruption() {
            var t = Math.min((Date.now() - t0) / dur, 1);
            var ease = 1 - Math.pow(1 - t, 3);

            p.position.lerpVectors(startPos, target, ease);

            // Billboard
            var cam = sceneEl.camera;
            if (cam) p.quaternion.copy(cam.quaternion);
            var zRot = new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 0, 1), initRot + t * rotSpeed
            );
            p.quaternion.multiply(zRot);

            var sc = 1 + ease * (maxScale - 1);
            p.scale.setScalar(sc);

            // Hold opacity then fade
            if (t < 0.4) {
              mat.opacity = 0.7;
            } else {
              mat.opacity = 0.7 * (1 - ((t - 0.4) / 0.6));
            }

            if (t < 1) { requestAnimationFrame(animateEruption); }
            else { sceneEl.object3D.remove(p); geo.dispose(); mat.dispose(); }
          }
          requestAnimationFrame(animateEruption);
        }, idx * 20);
      })(i);
    }

    // Spawn lightning bolts from center
    for (var l = 0; l < 8; l++) {
      (function (delay) {
        setTimeout(function () {
          var dir = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
          ).normalize();
          spawnLightningBolt(sceneEl, centerPos.clone(), dir, 0.2 + Math.random() * 0.3);
        }, delay * 50 + Math.random() * 100);
      })(l);
    }
  }

  /* ══════════════════════════════════════════════
     Genie Smoke Reveal (model twists out of smoke like Aladdin)
     ══════════════════════════════════════════════ */

  function genieRevealModel(sceneEl, modelEl, centerPos) {
    if (!modelEl) return;
    var obj = modelEl.object3D;

    // Start: model is invisible, scaled to 0, rotated
    obj.scale.set(0.01, 0.01, 0.01);
    obj.rotation.y = Math.PI * 4; // Start twisted
    modelEl.setAttribute("visible", "true");

    // Continuous smoke wisps rising from base during reveal
    var smokeColors = ["#1A0A4A", "#2D1B69", "#4A148C", "#311B92", "#1A237E"];
    var smokeInterval = null;
    var smokeCount = 0;
    var maxSmokeBursts = 15;

    smokeInterval = setInterval(function () {
      smokeCount++;
      if (smokeCount > maxSmokeBursts) { clearInterval(smokeInterval); return; }

      for (var s = 0; s < 3; s++) {
        var size = 0.03 + Math.random() * 0.05;
        var geo = new THREE.PlaneGeometry(size, size);
        var col = smokeColors[Math.floor(Math.random() * smokeColors.length)];
        var mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(col),
          map: getSmokeTexture(),
          transparent: true, opacity: 0.6,
          blending: THREE.NormalBlending, depthWrite: false,
          side: THREE.DoubleSide
        });
        var smoke = new THREE.Mesh(geo, mat);
        // Spawn around the model base
        smoke.position.copy(centerPos);
        smoke.position.x += (Math.random() - 0.5) * 0.1;
        smoke.position.z += (Math.random() - 0.5) * 0.1;

        sceneEl.object3D.add(smoke);

        (function (sm, g, m) {
          var sp = sm.position.clone();
          var tgt = sp.clone();
          tgt.y += 0.1 + Math.random() * 0.2;
          tgt.x += (Math.random() - 0.5) * 0.08;
          var swirl = Math.random() * Math.PI * 2;
          var t0 = Date.now();
          var dur = 600 + Math.random() * 400;

          function animWisp() {
            var t = Math.min((Date.now() - t0) / dur, 1);
            sm.position.lerpVectors(sp, tgt, t);
            // Swirling motion
            sm.position.x += Math.sin(swirl + t * Math.PI * 3) * 0.015 * (1 - t);
            sm.position.z += Math.cos(swirl + t * Math.PI * 3) * 0.015 * (1 - t);

            var cam = sceneEl.camera;
            if (cam) sm.quaternion.copy(cam.quaternion);

            var sc = 1 + t * 2;
            sm.scale.setScalar(sc);
            m.opacity = 0.6 * (1 - t);

            if (t < 1) { requestAnimationFrame(animWisp); }
            else { sceneEl.object3D.remove(sm); g.dispose(); m.dispose(); }
          }
          requestAnimationFrame(animWisp);
        })(smoke, geo, mat);
      }

      // Occasional lightning during reveal
      if (Math.random() > 0.5) {
        var dir = new THREE.Vector3(
          (Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5)
        ).normalize();
        spawnLightningBolt(sceneEl, centerPos.clone(), dir, 0.15 + Math.random() * 0.15);
      }
    }, 80);

    // Animate the model: untwist + scale up (genie emerging from smoke)
    var t0 = Date.now();
    var dur = 1200;
    var startRotY = Math.PI * 4;

    function animateGenie() {
      var elapsed = Date.now() - t0;
      var t = Math.min(elapsed / dur, 1);

      // Ease-out elastic for scale
      var scaleEase;
      if (t < 0.6) {
        // Fast grow phase
        scaleEase = Math.pow(t / 0.6, 0.5);
      } else {
        // Overshoot + settle
        var t2 = (t - 0.6) / 0.4;
        scaleEase = 1 + Math.sin(t2 * Math.PI) * 0.08 * (1 - t2);
      }
      obj.scale.setScalar(Math.max(0.01, scaleEase));

      // Untwist: rotate from 4*PI back to 0
      var rotEase = 1 - Math.pow(1 - t, 2.5);
      obj.rotation.y = startRotY * (1 - rotEase);

      // Slight vertical stretch during early phase (smoke column effect)
      if (t < 0.4) {
        var stretch = 1 + (1 - t / 0.4) * 0.3;
        obj.scale.y = Math.max(0.01, scaleEase) * stretch;
      }

      if (t < 1) {
        requestAnimationFrame(animateGenie);
      } else {
        // Final settle
        obj.scale.set(1, 1, 1);
        obj.rotation.y = 0;
      }
    }
    requestAnimationFrame(animateGenie);
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
      el.style.transform = "translate(calc(" + x + "px - 50%), calc(" + y + "px - 50%))";
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
      var holder = document.getElementById("model-holder");
      var holderObj = holder ? holder.object3D : null;

      // Compute world-space bounding box, then convert to model-holder local space
      var box = new THREE.Box3().setFromObject(mesh);

      // Convert to model-holder local coordinates using all 8 bbox corners
      var center, size;
      if (holderObj) {
        holderObj.updateMatrixWorld(true);
        var invMatrix = new THREE.Matrix4().copy(holderObj.matrixWorld).invert();
        var corners = [
          new THREE.Vector3(box.min.x, box.min.y, box.min.z),
          new THREE.Vector3(box.min.x, box.min.y, box.max.z),
          new THREE.Vector3(box.min.x, box.max.y, box.min.z),
          new THREE.Vector3(box.min.x, box.max.y, box.max.z),
          new THREE.Vector3(box.max.x, box.min.y, box.min.z),
          new THREE.Vector3(box.max.x, box.min.y, box.max.z),
          new THREE.Vector3(box.max.x, box.max.y, box.min.z),
          new THREE.Vector3(box.max.x, box.max.y, box.max.z)
        ];
        var lbox = new THREE.Box3();
        for (var ci = 0; ci < 8; ci++) {
          corners[ci].applyMatrix4(invMatrix);
          lbox.expandByPoint(corners[ci]);
        }
        center = new THREE.Vector3(); lbox.getCenter(center);
        size = new THREE.Vector3(); lbox.getSize(size);
        state.modelBBox = lbox;
      } else {
        center = new THREE.Vector3(); box.getCenter(center);
        size = new THREE.Vector3(); box.getSize(size);
        state.modelBBox = box;
      }

      state.modelMaxDim = Math.max(size.x, size.y, size.z, 0.2);

      // Pick a random face (exclude bottom -Y)
      // 0=+X, 1=-X, 2=+Y(top), 3=+Z(front), 4=-Z(back)
      var faceOptions = [0, 1, 2, 3, 4];
      var faceIdx = faceOptions[Math.floor(Math.random() * faceOptions.length)];
      var markPos = center.clone();
      var markNormal = new THREE.Vector3();

      switch (faceIdx) {
        case 0: markPos.x = center.x + size.x * 0.5; markNormal.set(1, 0, 0); break;
        case 1: markPos.x = center.x - size.x * 0.5; markNormal.set(-1, 0, 0); break;
        case 2: markPos.y = center.y + size.y * 0.5; markNormal.set(0, 1, 0); break;
        case 3: markPos.z = center.z + size.z * 0.5; markNormal.set(0, 0, 1); break;
        case 4: markPos.z = center.z - size.z * 0.5; markNormal.set(0, 0, -1); break;
      }

      // Add small random offset within the face so mark isn't always dead center
      var offsetRange = 0.3;
      switch (faceIdx) {
        case 0: case 1:
          markPos.y += (Math.random() - 0.5) * size.y * offsetRange;
          markPos.z += (Math.random() - 0.5) * size.z * offsetRange;
          break;
        case 2:
          markPos.x += (Math.random() - 0.5) * size.x * offsetRange;
          markPos.z += (Math.random() - 0.5) * size.z * offsetRange;
          break;
        case 3: case 4:
          markPos.x += (Math.random() - 0.5) * size.x * offsetRange;
          markPos.y += (Math.random() - 0.5) * size.y * offsetRange;
          break;
      }

      state.markWorldPos = markPos;
      state.markNormal = markNormal;

      // Create the mark mesh in local coordinates
      state.markMesh = createMarkMesh(markPos, markNormal);
      // Add to model-holder so it moves/rotates with the model
      if (holderObj) {
        holderObj.add(state.markMesh);
      }

      if (CFG.debug) {
        var faceNames = ["+X", "-X", "+Y(top)", "+Z(front)", "-Z(back)"];
        var tiltDir = markPos.clone().sub(center);
        var tiltLen = tiltDir.length();
        console.log("📍 Hidden mark placed on bbox face:", faceNames[faceIdx],
          "local pos:", markPos.toArray().map(function(v) { return v.toFixed(3); }),
          "bbox size:", size.toArray().map(function(v) { return v.toFixed(3); }),
          "bbox center:", center.toArray().map(function(v) { return v.toFixed(3); }),
          "tilt dir:", tiltDir.toArray().map(function(v) { return v.toFixed(3); }),
          "tilt len:", tiltLen.toFixed(4));

        // ── Debug: draw bounding box wireframe ──
        var bboxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
        var bboxEdges = new THREE.EdgesGeometry(bboxGeo);
        var bboxLine = new THREE.LineSegments(bboxEdges, new THREE.LineBasicMaterial({
          color: 0x00ff00, linewidth: 2, transparent: true, opacity: 0.8
        }));
        bboxLine.position.copy(center);
        bboxLine.renderOrder = 99;
        if (holderObj) holderObj.add(bboxLine);
        state._debugBBox = bboxLine;
        console.log("📦 Debug bounding box shown (green wireframe)");

        // ── Debug: make mark fully visible immediately ──
        state.markMesh.material.opacity = 1.0;
        state.markMesh.material.color.set("#FF0000");
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
      e.preventDefault();
      var touch = e.touches[0];
      state.isTouching = true;
      state.lastTouchPos = { x: touch.clientX, y: touch.clientY };
      state.lastTouchTime = Date.now();
    },

    onTouchMove: function (e) {
      if (!state.isTouching) return;
      e.preventDefault();
      var touch = e.touches[0];
      this.handleRubMove(touch.clientX, touch.clientY);
    },

    onTouchEnd: function () {
      state.isTouching = false;
      state.lastRubPoint = null;
      state.isRubbingMark = false;
      setTouchRipple(0, 0, false);
    },

    onMouseDown: function (e) {
      state.isTouching = true;
      state.lastTouchPos = { x: e.clientX, y: e.clientY };
      state.lastTouchTime = Date.now();
    },

    onMouseMove: function (e) {
      if (!state.isTouching) return;
      this.handleRubMove(e.clientX, e.clientY);
    },

    onMouseUp: function () {
      state.isTouching = false;
      state.lastRubPoint = null;
      state.isRubbingMark = false;
      setTouchRipple(0, 0, false);
    },

    /* ── Core Rub Logic ── */

    handleRubMove: function (screenX, screenY) {
      // Pause input during transformation transition
      if (state.transformed) return;

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

      // Raycast to the currently active model
      var activeEl = state.currentModel === "fictional"
        ? document.getElementById("fictionalModel")
        : document.getElementById("realModel");
      if (!activeEl) return;
      var mesh = activeEl.getObject3D("mesh");
      if (!mesh) return;

      var cam = this.el.camera;
      if (!cam) return;

      var canvas = this.el.canvas;
      var hit = raycastToModel(cam, screenX, screenY, mesh, canvas.clientWidth, canvas.clientHeight);

      if (!hit) {
        // Even without a model hit, check screen-space proximity to mark
        // This handles the case where mark is on the bbox face away from the model surface
        var cam = this.el.camera;
        if (cam && state.markWorldPos) {
          var markWorld = state.markWorldPos.clone();
          var holder = document.getElementById("model-holder");
          if (holder) markWorld.applyMatrix4(holder.object3D.matrixWorld);
          var markScreen = markWorld.clone().project(cam);
          var canvas = this.el.canvas;
          var markSX = (markScreen.x * 0.5 + 0.5) * canvas.clientWidth;
          var markSY = (-markScreen.y * 0.5 + 0.5) * canvas.clientHeight;
          var sdx = screenX - markSX;
          var sdy = screenY - markSY;
          var screenDist = Math.sqrt(sdx * sdx + sdy * sdy);
          if (screenDist < 80) {
            // Treat as near-mark touch even without model hit
            setTouchRipple(screenX, screenY, true, "#9C27B0");
            if (speed >= CFG.rub.minMoveSpeed) {
              state.isRubbingMark = true;
              if (!state.rubStartTime) state.rubStartTime = Date.now();
              if (navigator.vibrate) navigator.vibrate(60);
              var xpGain = CFG.xp.perRub;
              state.xp = Math.min(state.xp + xpGain, CFG.xp.threshold);
              updateXPDisplay(state.xp, CFG.xp.threshold);
              if (Date.now() - state.lastSparkleTime >= 100) {
                state.lastSparkleTime = Date.now();
                var intensity = state.xp / CFG.xp.threshold;
                spawnGenieSmoke(this.el, markWorld, state.markNormal || new THREE.Vector3(0, 1, 0), intensity);
              }
              if (!state.markRevealed) this.revealMark();
              if (state.xp >= CFG.xp.threshold && !state.transformed) this.triggerTransformation();
            }
            return;
          }
        }
        setTouchRipple(screenX, screenY, false);
        return;
      }

      // Convert mark local position to world position for distance check
      var markWorldPos = null;
      if (state.markWorldPos) {
        markWorldPos = state.markWorldPos.clone();
        var holder = document.getElementById("model-holder");
        if (holder) {
          markWorldPos.applyMatrix4(holder.object3D.matrixWorld);
        }
      }

      // Always show white ripple on model contact
      var hitRadius = CFG.mark.radius + CFG.rub.touchRadius;
      var distToMark = markWorldPos ? hit.point.distanceTo(markWorldPos) : Infinity;
      var nearMark = distToMark <= hitRadius;

      // Fallback: screen-space proximity check when 3D distance fails
      // (mark is on bbox face, far from model surface in 3D but close on screen)
      if (!nearMark && markWorldPos && cam) {
        var markScreen = markWorldPos.clone().project(cam);
        var canvas = this.el.canvas;
        var markSX = (markScreen.x * 0.5 + 0.5) * canvas.clientWidth;
        var markSY = (-markScreen.y * 0.5 + 0.5) * canvas.clientHeight;
        var sdx = screenX - markSX;
        var sdy = screenY - markSY;
        var screenDist = Math.sqrt(sdx * sdx + sdy * sdy);
        nearMark = screenDist < 80;
      }

      if (CFG.debug && markWorldPos && distToMark < 5) {
        console.log("🎯 dist=" + distToMark.toFixed(3) + " hitR=" + hitRadius.toFixed(3) + " near=" + nearMark +
          " hit=" + hit.point.toArray().map(function(v){return v.toFixed(3)}) +
          " mark=" + markWorldPos.toArray().map(function(v){return v.toFixed(3)}));
      }

      // Ripple: white outside, purple inside mark area
      setTouchRipple(screenX, screenY, true, nearMark ? "#9C27B0" : "rgba(255,255,255,0.5)");

      // ── Speed gate: everything below requires actual rubbing ──
      if (speed < CFG.rub.minMoveSpeed) return;

      // ── Only Mark area triggers effects (Aladdin style) ──
      if (!nearMark || !state.markWorldPos) return;

      // Activate genie lamp rubbing state
      state.isRubbingMark = true;
      if (!state.rubStartTime) state.rubStartTime = now;

      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate(distToMark <= CFG.mark.radius ? 80 : 40);
      }

      // XP accumulation
      var closeness = Math.max(0, 1 - (distToMark / hitRadius));
      var xpGain = CFG.xp.perRub;
      state.xp = Math.max(0, Math.min(state.xp + xpGain, CFG.xp.threshold));
      updateXPDisplay(state.xp, CFG.xp.threshold);

      // Genie smoke + stardust from mark
      if (now - state.lastSparkleTime >= 100) {
        state.lastSparkleTime = now;
        var intensity = state.xp / CFG.xp.threshold;
        spawnGenieSmoke(this.el, markWorldPos, state.markNormal || new THREE.Vector3(0, 1, 0), intensity);
      }

      // Reveal mark
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
      state.isRubbingMark = false;
      setTouchRipple(0, 0, false);
      console.log("🔮 Transformation triggered!");

      var self = this;
      var holder = document.getElementById("model-holder");

      // Get model center for effects
      var effectCenter = new THREE.Vector3();
      if (state.modelBBox) {
        state.modelBBox.getCenter(effectCenter);
        if (holder) effectCenter.applyMatrix4(holder.object3D.matrixWorld);
      } else if (state.markWorldPos) {
        effectCenter.copy(state.markWorldPos);
        if (holder) effectCenter.applyMatrix4(holder.object3D.matrixWorld);
      }

      // Phase 1 (0-400ms): Intensify shake + spawn swirling smoke
      var shakeStart = Date.now();
      function intensifyShake() {
        var elapsed = Date.now() - shakeStart;
        if (elapsed < 400 && holder) {
          var amp = THREE.MathUtils.degToRad(12);
          var freq = 15;
          holder.object3D.rotation.z = Math.sin(elapsed * 0.001 * freq) * amp;
          holder.object3D.rotation.x = Math.sin(elapsed * 0.001 * freq * 0.7) * amp * 0.6;
          requestAnimationFrame(intensifyShake);
        }
      }
      intensifyShake();

      // Phase 2 (200ms): Start smoke building around model
      setTimeout(function () {
        smokeEruption(self.el, effectCenter);
      }, 200);

      // Phase 2b (300ms): Burst particles from mark
      setTimeout(function () {
        if (state.markWorldPos) {
          var burstPos = state.markWorldPos.clone();
          var holder = document.getElementById("model-holder");
          if (holder) burstPos.applyMatrix4(holder.object3D.matrixWorld);
          burstParticles(self.el, burstPos, state.markNormal || new THREE.Vector3(0, 1, 0));
        }
      }, 300);

      // Phase 3 (500ms): Purple-blue flash overlay + extra lightning
      setTimeout(function () {
        var flash = document.getElementById("flash-overlay");
        if (flash) {
          flash.classList.add("active");
          setTimeout(function () { flash.classList.remove("active"); }, 500);
        }

        // Extra lightning bolts during flash
        for (var i = 0; i < 5; i++) {
          (function (delay) {
            setTimeout(function () {
              var dir = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
              ).normalize();
              spawnLightningBolt(self.el, effectCenter.clone(), dir, 0.3 + Math.random() * 0.2);
            }, delay * 60);
          })(i);
        }
      }, 500);

      // Phase 3b (600ms): Reset shake + hide current model
      setTimeout(function () {
        if (holder) {
          holder.object3D.rotation.z = 0;
          holder.object3D.rotation.x = 0;
        }
        state.currentEmissive = 0;
      }, 600);

      // Phase 4 (900ms): Swap models with genie reveal
      setTimeout(function () {
        self.swapModels();
      }, 900);
    },

    swapModels: function () {
      var realEl = document.getElementById("realModel");
      var fictEl = document.getElementById("fictionalModel");
      var holder = document.getElementById("model-holder");

      // Hide mark
      if (state.markMesh) {
        state.markMesh.visible = false;
      }

      // Get model center for genie reveal effect
      var effectCenter = new THREE.Vector3();
      if (state.modelBBox) {
        state.modelBBox.getCenter(effectCenter);
        if (holder) effectCenter.applyMatrix4(holder.object3D.matrixWorld);
      }

      if (state.currentModel === "real") {
        // Real → Fictional: hide real, genie-reveal fictional
        if (realEl) realEl.setAttribute("visible", "false");
        if (fictEl) {
          genieRevealModel(this.el, fictEl, effectCenter);
        }
        state.currentModel = "fictional";
        showItemName(state.itemName || "Fictional Item");
      } else {
        // Fictional → Real: hide fictional, genie-reveal real
        if (fictEl) fictEl.setAttribute("visible", "false");
        if (realEl) {
          genieRevealModel(this.el, realEl, effectCenter);
        }
        state.currentModel = "real";
        showItemName(state.realName || "Real Item");
      }

      state.roundCount++;
      console.log("🔄 Round " + state.roundCount + " complete → now showing " + state.currentModel);

      // Start a new round after genie reveal animation completes
      var self = this;
      setTimeout(function () {
        self.startNewRound();
      }, 2000);
    },

    startNewRound: function () {
      // Reset game state for the new round
      state.transformed = false;
      state.markRevealed = false;
      state.xp = 0;
      state.lastZoneIndex = -1;
      state.lastSparkleTime = 0;
      state.isRubbingMark = false;
      state.rubStartTime = 0;
      state.currentEmissive = 0;
      updateXPDisplay(0, CFG.xp.threshold);

      // Remove old mark mesh
      if (state.markMesh) {
        var holder = document.getElementById("model-holder");
        if (holder) holder.object3D.remove(state.markMesh);
        if (state.markMesh.geometry) state.markMesh.geometry.dispose();
        if (state.markMesh.material) state.markMesh.material.dispose();
        state.markMesh = null;
      }

      // Remove old debug bounding box
      if (state._debugBBox) {
        var dbgParent = state._debugBBox.parent;
        if (dbgParent) dbgParent.remove(state._debugBBox);
        if (state._debugBBox.geometry) state._debugBBox.geometry.dispose();
        if (state._debugBBox.material) state._debugBBox.material.dispose();
        state._debugBBox = null;
      }

      // Remove floating indicator
      if (state._floatingRing) {
        var parent = state._floatingRing.parent;
        if (parent) {
          parent.remove(state._floatingRing);
          if (state._floatingRing.geometry) state._floatingRing.geometry.dispose();
          if (state._floatingRing.material) state._floatingRing.material.dispose();
        }
        state._floatingRing = null;
      }
      if (state._floatingCircle) {
        var parent2 = state._floatingCircle.parent;
        if (parent2) {
          parent2.remove(state._floatingCircle);
          if (state._floatingCircle.geometry) state._floatingCircle.geometry.dispose();
          if (state._floatingCircle.material) state._floatingCircle.material.dispose();
        }
        state._floatingCircle = null;
      }

      // Place new mark on the currently visible model
      var activeEl = state.currentModel === "fictional"
        ? document.getElementById("fictionalModel")
        : document.getElementById("realModel");
      if (activeEl) {
        var mesh = activeEl.getObject3D("mesh");
        if (mesh) {
          this.placeHiddenMark(mesh, activeEl);
        }
      }

      // Update hint
      var hint = document.getElementById("interaction-hint");
      if (hint) hint.textContent = "Rub to find the hidden mark!";

      // Hide item name display
      var nameEl = document.getElementById("item-name-display");
      if (nameEl) nameEl.classList.remove("visible");

      console.log("🆕 New round started on " + state.currentModel + " model");
    },

    /* ── Tick: Lamp Shake + Hint Tilt + Emissive Glow + Mark Pulse ── */
    tick: function (time) {
      var holder = document.getElementById("model-holder");

      // ── Lamp shake when rubbing mark ──
      if (holder) {
        if (state.isRubbingMark && !state.transformed) {
          var elapsed = Date.now() - state.rubStartTime;
          var xpProgress = state.xp / CFG.xp.threshold;
          var amp = THREE.MathUtils.degToRad(3 + xpProgress * 7);
          var freq = 8 + xpProgress * 6;
          holder.object3D.rotation.z = Math.sin(elapsed * 0.001 * freq) * amp;
          holder.object3D.rotation.x = Math.sin(elapsed * 0.001 * freq * 0.7) * amp * 0.5;
        } else if (!state.transformed && !state.markRevealed) {
          // ── Periodic hint tilt toward mark ──
          // Every ~4 seconds, tilt briefly toward the mark's direction
          if (state.markWorldPos && state.modelBBox) {
            var cycle = (time * 0.001) % 4; // 4-second cycle
            if (cycle < 1.2) {
              // Tilt phase: smooth bell curve over 1.2s
              var tiltT = cycle / 1.2;
              var tiltStrength = Math.sin(tiltT * Math.PI); // 0→1→0
              var bboxCenter = new THREE.Vector3();
              state.modelBBox.getCenter(bboxCenter);

              // Direction from center to mark in holder LOCAL space
              var localDx = state.markWorldPos.x - bboxCenter.x;
              var localDy = state.markWorldPos.y - bboxCenter.y;
              var localDz = state.markWorldPos.z - bboxCenter.z;
              var localLen = Math.sqrt(localDx * localDx + localDy * localDy + localDz * localDz);

              if (localLen > 0.001) {
                // ── Transform local direction to SCREEN space ──
                // rotation.y is set by xrextras-two-finger-rotate (user yaw).
                // The XZ plane rotates by rotation.y, so we undo it to get screen direction.
                var userRotY = holder.object3D.rotation.y;
                var cosY = Math.cos(userRotY);
                var sinY = Math.sin(userRotY);

                // Rotate local XZ by rotation.y → screen-space direction
                // (standard Y-axis rotation matrix applied to direction vector)
                var screenX = localDx * cosY + localDz * sinY;   // + = right on screen
                var screenZ = -localDx * sinY + localDz * cosY;  // + = toward camera
                var screenY = localDy;                             // + = up

                var screenLen = Math.sqrt(screenX * screenX + screenY * screenY + screenZ * screenZ);
                var nx = screenX / screenLen;
                var ny = screenY / screenLen;
                var nz = screenZ / screenLen;

                var tiltAmp = THREE.MathUtils.degToRad(10);

                // rotation.z (last in XYZ Euler order) = always screen left/right
                // Mark on screen-right (nx>0) → lean right → rotation.z < 0
                var targetZ = -nx * tiltAmp * tiltStrength;

                // rotation.x (first in XYZ Euler order) = pitch, but its screen effect
                // depends on rotation.y. For small tilt angles the coupling error is
                // sin(10°)·sin(ry) ≈ 0.17·sin(ry) — acceptable.
                // Mark toward camera (nz>0) → bow forward → rotation.x > 0
                var targetX = nz * tiltAmp * tiltStrength;

                // For marks primarily on top/bottom (+Y/-Y), nod to expose the face
                // Mark on top (ny>0) → tilt backward → rotation.x < 0 (exposes top to camera)
                if (Math.abs(ny) > Math.abs(nx) && Math.abs(ny) > Math.abs(nz)) {
                  targetX = -ny * tiltAmp * 0.6 * tiltStrength;
                }

                holder.object3D.rotation.z = targetZ;
                holder.object3D.rotation.x = targetX;

                if (CFG.debug && cycle < 0.05) {
                  console.log("🔄 Tilt: userRotY=" + (userRotY * 180 / Math.PI).toFixed(1) + "°",
                    "local(" + localDx.toFixed(3) + "," + localDy.toFixed(3) + "," + localDz.toFixed(3) + ")",
                    "→ screen(" + nx.toFixed(2) + "," + ny.toFixed(2) + "," + nz.toFixed(2) + ")",
                    "→ tilt(z=" + (targetZ * 180 / Math.PI).toFixed(1) + "°, x=" + (targetX * 180 / Math.PI).toFixed(1) + "°)");
                }
              } else if (CFG.debug) {
                console.warn("⚠️ Tilt: mark too close to center, len=" + localLen.toFixed(6));
              }
            } else {
              // Rest phase: smooth return (preserve rotation.y)
              holder.object3D.rotation.z *= 0.92;
              holder.object3D.rotation.x *= 0.92;
              if (Math.abs(holder.object3D.rotation.z) < 0.001) holder.object3D.rotation.z = 0;
              if (Math.abs(holder.object3D.rotation.x) < 0.001) holder.object3D.rotation.x = 0;
            }
          } else {
            // No mark yet, just smooth return
            holder.object3D.rotation.z *= 0.9;
            holder.object3D.rotation.x *= 0.9;
            if (Math.abs(holder.object3D.rotation.z) < 0.001) holder.object3D.rotation.z = 0;
            if (Math.abs(holder.object3D.rotation.x) < 0.001) holder.object3D.rotation.x = 0;
          }
        } else if (!state.transformed) {
          // Mark already revealed, smooth return
          holder.object3D.rotation.z *= 0.9;
          holder.object3D.rotation.x *= 0.9;
          if (Math.abs(holder.object3D.rotation.z) < 0.001) holder.object3D.rotation.z = 0;
          if (Math.abs(holder.object3D.rotation.x) < 0.001) holder.object3D.rotation.x = 0;
        }
      }

      // ── Model emissive glow ──
      var targetEmissive = state.isRubbingMark ? (state.xp / CFG.xp.threshold) * 0.3 : 0;
      state.currentEmissive += (targetEmissive - state.currentEmissive) * 0.1;

      if (state.currentEmissive > 0.005) {
        var activeEl = state.currentModel === "fictional"
          ? document.getElementById("fictionalModel")
          : document.getElementById("realModel");
        if (activeEl) {
          var mesh = activeEl.getObject3D("mesh");
          if (mesh) {
            mesh.traverse(function (node) {
              if (node.isMesh && node.material) {
                var mats = Array.isArray(node.material) ? node.material : [node.material];
                mats.forEach(function (mat) {
                  if (mat.emissive) {
                    mat.emissive.setHex(0x4A148C);
                    mat.emissiveIntensity = state.currentEmissive;
                    mat.needsUpdate = true;
                  }
                });
              }
            });
          }
        }
      }

      // ── Mark glow pulse ──
      if (state.markMesh && state.markRevealed) {
        var pulse = 0.5 + 0.5 * Math.sin(time * 0.001 * CFG.mark.pulseSpeed * Math.PI * 2);
        var baseColor = new THREE.Color(CFG.mark.color);
        var glowColor = new THREE.Color(CFG.mark.glowColor);
        state.markMesh.material.color.copy(baseColor).lerp(glowColor, pulse);
      }
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
