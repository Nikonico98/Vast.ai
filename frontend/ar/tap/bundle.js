/**
 * Imaginary World - Tap AR Interaction (3-Star Mechanic)
 * 3 stars fly simultaneously. User taps each star → halo + fadeout.
 * After all 3 tapped → model swap (real ↔ fictional).
 * Then 3 new stars spawn for the next round.
 */

(function () {
  "use strict";

  console.log("✅ Tap AR Interaction (3-Star) loaded");

  /* ── Merged Config ── */
  var defaultCfg = {
    star: {
      count: 3, color: "#ffd54a", emissive: "#ff9900", emissiveIntensity: 0.7,
      sizeRatio: 0.11, minSize: 0.07, maxSize: 0.15,
      pulseScale: 1.35, pulseMin: 0.92, pulseDuration: 650, spinSpeed: 0, flySpeed: 700,
      haloColor: "#ffffff", haloDuration: 600, fadeDuration: 800
    },
    spawn: { duration: 360, easing: "easeOutBack", staggerDelay: 300 },
    burst: { count: 4, baseRadius: 0.012, maxDistance: 0.15, duration: 350 },
    swap: { delay: 500, animationDuration: 400 }
  };

  function mergeConfig() {
    var ext = window.TAP_CONFIG;
    if (!ext || typeof ext !== "object") return defaultCfg;
    var out = {};
    Object.keys(defaultCfg).forEach(function (k) {
      if (defaultCfg[k] && typeof defaultCfg[k] === "object" && !Array.isArray(defaultCfg[k]) &&
          ext[k] && typeof ext[k] === "object" && !Array.isArray(ext[k])) {
        out[k] = Object.assign({}, defaultCfg[k], ext[k]);
      } else {
        out[k] = k in ext ? ext[k] : defaultCfg[k];
      }
    });
    console.log("⚙️ TAP_CONFIG merged", out);
    return out;
  }

  var CFG = mergeConfig();

  /* ── Test mode ── */
  var TEST = { enabled: true, realGlb: "assets/realmodel.glb", fictionalGlb: "assets/fictionalmodel.glb",
               itemName: "Test Fictional Item", realName: "Test Real Item" };

  /* ── Global State ── */
  var state = {
    realModelLoaded: false, fictionalGlbUrl: null, realGlbUrl: null,
    itemName: null, realName: null, starsCreated: false,
    fictionalRevealed: false, showingFictional: false,
    fictionalModel: null, fictionalLoaded: false, realModel: null,
    activeStars: [], tappedCount: 0,
    totalStars: CFG.star.count || 3,
    isTransitioning: false, toggleCount: 0, roundCount: 0,
    modelMaxDim: 0.2, flyRangeX: 0.1, flyRangeY: 0.1, flyRangeZ: 0.1,
    baseHeight: 0.1, starSize: 0.05
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

  /* ── Star Counter UI ── */
  function updateStarCounter() {
    var el = document.getElementById("star-counter");
    if (!el) return;
    var dots = "";
    for (var i = 0; i < state.totalStars; i++) {
      dots += i < state.tappedCount ? "★ " : "☆ ";
    }
    el.textContent = dots.trim();
    el.style.color = (state.tappedCount >= state.totalStars) ? "#4caf50" : "#ffd54a";
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

  /* ── Billboard Component ── */
  AFRAME.registerComponent("billboard", {
    schema: { spinSpeed: { type: "number", default: 0 } },
    init: function () {
      this._parentQuat = new THREE.Quaternion();
      this._cameraQuat = new THREE.Quaternion();
      this._spinQuat = new THREE.Quaternion();
      this._spinAxis = new THREE.Vector3(0, 0, 1);
      this._startTime = Date.now();
    },
    tick: function () {
      var cam = this.el.sceneEl.camera;
      if (!cam || !this.el.object3D.parent) return;
      this.el.object3D.parent.getWorldQuaternion(this._parentQuat);
      this._parentQuat.invert();
      cam.getWorldQuaternion(this._cameraQuat);
      this.el.object3D.quaternion.copy(this._parentQuat.multiply(this._cameraQuat));
      if (this.data.spinSpeed !== 0) {
        var elapsed = (Date.now() - this._startTime) / 1000;
        var angle = THREE.MathUtils.degToRad(this.data.spinSpeed * elapsed);
        this._spinQuat.setFromAxisAngle(this._spinAxis, angle);
        this.el.object3D.quaternion.multiply(this._spinQuat);
      }
    }
  });

  /* ── Random-Fly Component (Erratic / Hard Mode) ── */
  AFRAME.registerComponent("random-fly", {
    schema: {
      rangeX: { type: "number", default: 0.3 },
      rangeY: { type: "number", default: 0.3 },
      rangeZ: { type: "number", default: 0.3 },
      baseHeight: { type: "number", default: 0.2 },
      speed: { type: "number", default: 700 }
    },
    init: function () {
      var self = this;
      this._stopped = false;
      this._easings = [
        "easeInOutSine", "easeInQuad", "easeOutQuad", "easeInOutQuart",
        "easeInCubic", "easeOutCubic", "linear", "easeInOutBack"
      ];
      this._moveCount = 0;
      setTimeout(function () { self._flyToNext(); }, 50 + Math.random() * 200);
    },
    _getRandomTarget: function () {
      // Erratic: sometimes overshoot range, sometimes cluster near center
      var spread = 0.4 + Math.random() * 0.8; // 0.4x to 1.2x range
      var jitterX = (Math.random() - 0.5) * 0.15 * this.data.rangeX;
      var jitterZ = (Math.random() - 0.5) * 0.15 * this.data.rangeZ;
      return {
        x: 2 * (Math.random() - 0.5) * this.data.rangeX * spread + jitterX,
        y: this.data.baseHeight + Math.random() * this.data.rangeY * (0.5 + Math.random()),
        z: 2 * (Math.random() - 0.5) * this.data.rangeZ * spread + jitterZ
      };
    },
    _pickEasing: function () {
      return this._easings[Math.floor(Math.random() * this._easings.length)];
    },
    _flyToNext: function () {
      var self = this;
      if (this._stopped) return;
      this._moveCount++;

      // Every few moves, do a quick feint (very short fast move then redirect)
      var isFeint = this._moveCount % 3 === 0 && Math.random() > 0.3;
      var t = this._getRandomTarget();
      // Speed varies wildly: sometimes very fast burst, sometimes moderate
      var speedMult = isFeint ? (0.2 + 0.2 * Math.random()) : (0.5 + 0.7 * Math.random());
      var dur = this.data.speed * speedMult;
      // Minimum 150ms, max around speed * 1.2
      dur = Math.max(150, Math.min(dur, this.data.speed * 1.2));

      if (isFeint) {
        // Feint: move partway toward a fake target, then immediately redirect
        var curPos = this.el.object3D.position;
        var fakeT = {
          x: curPos.x + (t.x - curPos.x) * 0.3 + (Math.random() - 0.5) * this.data.rangeX * 0.5,
          y: curPos.y + (t.y - curPos.y) * 0.3 + (Math.random() - 0.5) * this.data.rangeY * 0.3,
          z: curPos.z + (t.z - curPos.z) * 0.3 + (Math.random() - 0.5) * this.data.rangeZ * 0.5
        };
        this.el.removeAttribute("animation__fly");
        this.el.setAttribute("animation__fly", {
          property: "position",
          to: fakeT.x.toFixed(3) + " " + fakeT.y.toFixed(3) + " " + fakeT.z.toFixed(3),
          dur: dur * 0.5, easing: "easeInQuad"
        });
        this.el.addEventListener("animationcomplete__fly", function () {
          if (self._stopped) return;
          var t2 = self._getRandomTarget();
          var dur2 = self.data.speed * (0.4 + 0.5 * Math.random());
          self.el.removeAttribute("animation__fly");
          self.el.setAttribute("animation__fly", {
            property: "position",
            to: t2.x.toFixed(3) + " " + t2.y.toFixed(3) + " " + t2.z.toFixed(3),
            dur: dur2, easing: self._pickEasing()
          });
          self.el.addEventListener("animationcomplete__fly", function () { self._flyToNext(); }, { once: true });
        }, { once: true });
      } else {
        this.el.removeAttribute("animation__fly");
        this.el.setAttribute("animation__fly", {
          property: "position",
          to: t.x.toFixed(3) + " " + t.y.toFixed(3) + " " + t.z.toFixed(3),
          dur: dur, easing: this._pickEasing()
        });
        this.el.addEventListener("animationcomplete__fly", function () { self._flyToNext(); }, { once: true });
      }
    },
    remove: function () {
      this._stopped = true;
      this.el.removeAttribute("animation__fly");
    }
  });

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

  /* ── UI Manager ── */
  var UI = {
    elements: {},
    init: function () {
      this.elements = {
        hint: document.getElementById("ar-hint"),
        interactionType: document.getElementById("interaction-type"),
        interactionHint: document.getElementById("interaction-hint"),
        status: document.getElementById("ar-status"),
        statusText: document.getElementById("status-text"),
        itemName: document.getElementById("item-name-display"),
        starCounter: document.getElementById("star-counter")
      };
    },
    show: function () {
      Object.values(this.elements).forEach(function (el) {
        if (el) el.classList.remove("ar-ui-hidden");
      });
    },
    setInteractionType: function (type) {
      if (this.elements.interactionType) this.elements.interactionType.textContent = type;
      if (this.elements.interactionHint) this.elements.interactionHint.textContent = "Tap all 3 flying stars!";
    },
    setStatus: function (msg, cls) {
      cls = cls || "waiting";
      if (this.elements.status) {
        this.elements.status.className = cls;
        this.elements.status.classList.remove("ar-ui-hidden");
      }
      if (this.elements.statusText) this.elements.statusText.textContent = msg;
    },
    showItemName: function (name) {
      if (this.elements.itemName) {
        this.elements.itemName.textContent = "✨ " + name;
        this.elements.itemName.classList.add("visible");
      }
    },
    hideItemName: function () {
      if (this.elements.itemName) this.elements.itemName.classList.remove("visible");
    }
  };

  /* ── Model Load with Retry ── */
  function loadModelEntity(element, modelUrl, opts) {
    var label = opts.label || "Model";
    var retryStatusText = opts.retryStatusText;
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

      var onError = function (evt) { handleErr("model_error", evt); };

      var handleErr = function (errorType, event) {
        if (done) return; done = true; cleanup();
        var code = errorType;
        if (errorType === "model_error") {
          fetch(url, { method: "HEAD", mode: "cors", cache: "no-store" }).then(function (r) {
            if (!r.ok) {
              if (r.status === 404) code = "not_found";
              else if (r.status === 401 || r.status === 403) code = "forbidden";
              else if (r.status >= 500) code = "server";
              else code = "http_error";
            }
          }).catch(function () { code = "network_or_cors"; }).finally(function () {
            retryOrFail(code, event);
          });
        } else {
          retryOrFail(code, event);
        }
      };

      var retryOrFail = function (code, event) {
        if (attemptCount <= 2) {
          console.warn("⚠️ " + label + " load failed (" + code + "), retrying " + (attemptCount + 1) + "/3");
          if (retryStatusText) UI.setStatus(retryStatusText + " (retry " + (attemptCount + 1) + "/3)", "waiting");
          setTimeout(loadImpl, 250);
        } else {
          onFinalError({ attempt: attemptCount, errorType: code, event: event, url: url });
        }
      };

      timeoutHandle = setTimeout(function () {
        element.removeAttribute("gltf-model");
        handleErr("timeout");
      }, 30000);

      element.removeAttribute("gltf-model");
      setTimeout(function () { element.setAttribute("gltf-model", url); }, attemptCount === 1 ? 0 : 250);
      element.addEventListener("model-loaded", onSuccess);
      element.addEventListener("model-error", onError);
    };

    loadImpl();
  }

  /* ── Halo Effect ── */
  function createHaloEffect(starEl) {
    var cfg = CFG.star;
    var haloDur = cfg.haloDuration || 600;

    var parent = starEl.object3D.parent;
    if (!parent) return;

    var worldPos = new THREE.Vector3();
    starEl.object3D.getWorldPosition(worldPos);
    parent.worldToLocal(worldPos);

    var haloGeo = new THREE.RingGeometry(0.01, 0.06, 32);
    var haloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(cfg.haloColor || "#ffffff"),
      transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.renderOrder = 999;
    haloMesh.position.copy(worldPos);

    var cam = starEl.sceneEl.camera;
    if (cam) {
      var q = new THREE.Quaternion();
      cam.getWorldQuaternion(q);
      haloMesh.quaternion.copy(q);
    }

    parent.add(haloMesh);

    var t0 = Date.now();
    var maxScale = 8;
    function animate() {
      var t = Math.min((Date.now() - t0) / haloDur, 1);
      var ease = 1 - Math.pow(1 - t, 3);
      var s = 1 + ease * maxScale;
      haloMesh.scale.set(s, s, 1);
      haloMesh.material.opacity = 0.9 * (1 - ease);
      if (t < 1) { requestAnimationFrame(animate); }
      else { parent.remove(haloMesh); haloGeo.dispose(); haloMat.dispose(); }
    }
    requestAnimationFrame(animate);
  }

  /* ── Sprite Burst Overlay ── */
  function triggerBurst() {
    var el = document.getElementById("sprite-burst-overlay");
    if (el) {
      el.classList.remove("active"); el.offsetWidth; el.classList.add("active");
      setTimeout(function () { el.classList.remove("active"); el.style.opacity = "0"; el.style.visibility = "hidden"; }, 1700);
    }
  }

  /* ── Error message helper ── */
  function modelErrMsg(type, label) {
    switch (type) {
      case "timeout": return label + " load timed out";
      case "not_found": return label + " URL returned 404";
      case "forbidden": return label + " was blocked (403/CORS)";
      case "server": return label + " server returned 5xx";
      case "network_or_cors": return label + " request failed (network/CORS)";
      case "invalid_url": return label + " URL is invalid";
      default: return "Failed to load " + label;
    }
  }

  /* ═══════════════════════════════════════════════
     Main Component: tap-ar-interaction
     ═══════════════════════════════════════════════ */
  AFRAME.registerComponent("tap-ar-interaction", {
    init: function () {
      console.log("🎮 Tap AR Interaction (3-Star) initializing...");
      preAROverlay.bind(this.el);
      UI.init();

      var params = new URLSearchParams(window.location.search);
      var config;
      if (TEST.enabled) {
        config = { realGlb: TEST.realGlb, fictionalGlb: TEST.fictionalGlb,
                   interaction: "Tap", itemName: TEST.itemName, realName: TEST.realName };
      } else {
        config = {
          realGlb: normalizeUrl(params.get("real_glb")),
          fictionalGlb: normalizeUrl(params.get("fictional_glb")),
          interaction: params.get("interaction") || "Tap",
          itemName: params.get("item_name") || "Fictional Item",
          realName: params.get("real_name") || "Real Item"
        };
      }

      console.log("📦 Config:", {
        real_glb: config.realGlb ? config.realGlb.substring(0, 60) + "..." : null,
        fictional_glb: config.fictionalGlb ? config.fictionalGlb.substring(0, 60) + "..." : null,
        interaction: config.interaction, item_name: config.itemName, real_name: config.realName
      });

      if (!config.realGlb) {
        console.error("❌ Missing real_glb parameter");
        UI.setStatus("Error: No model URL provided", "error");
        return;
      }

      state.fictionalGlbUrl = config.fictionalGlb;
      state.realGlbUrl = config.realGlb;
      state.itemName = config.itemName;
      state.realName = config.realName;

      UI.setInteractionType(config.interaction);
      UI.setStatus("Loading Real Item 3D...", "waiting");
      this.loadRealModel(config.realGlb);

      this.el.addEventListener("loaded", function () {
        UI.show();
        var vid = document.getElementById("star-fly-video");
        if (vid) {
          var p = vid.play();
          if (p !== undefined) {
            p.catch(function () {
              var retry = function () {
                vid.play().catch(function () {});
                document.removeEventListener("touchstart", retry);
                document.removeEventListener("click", retry);
              };
              document.addEventListener("touchstart", retry, { once: true });
              document.addEventListener("click", retry, { once: true });
            });
          }
        }
      });
    },

    loadRealModel: function (modelUrl) {
      var self = this;
      var realEl = document.getElementById("realModel");
      if (!realEl) { console.error("❌ #realModel not found"); return; }

      loadModelEntity(realEl, modelUrl, {
        label: "Real Item 3D",
        retryStatusText: "Retrying Real Item 3D...",
        onLoaded: function () {
          console.log("✅ Real Item 3D loaded");
          state.realModelLoaded = true;
          var mesh = realEl.getObject3D("mesh");
          if (mesh) fixMaterials(mesh);

          if (state.fictionalGlbUrl && !state.starsCreated) {
            self._cacheModelDimensions(realEl);
            self.preloadFictionalItem();
            self.spawnStarRound();
            state.starsCreated = true;
            state.realModel = realEl;
            UI.setStatus("Tap the 3 stars! ✨", "waiting");
          } else if (!state.fictionalGlbUrl) {
            UI.setStatus("Real Item 3D loaded", "complete");
          }
          window.dispatchEvent(new CustomEvent("ei:realModel:ready", { detail: { modelId: "realModel" } }));
          preAROverlay.enableStart();
        },
        onFinalError: function (err) {
          console.error("❌ Failed to load Real Item 3D:", err);
          UI.setStatus(modelErrMsg(err.errorType, "Real Item 3D"), "error");
        }
      });
    },

    _cacheModelDimensions: function (modelEl) {
      var box = new THREE.Box3();
      modelEl.object3D.traverse(function (node) {
        if (node.isMesh && node.geometry) {
          node.geometry.computeBoundingBox();
          var bb = node.geometry.boundingBox.clone();
          bb.applyMatrix4(node.matrixWorld);
          box.union(bb);
        }
      });
      var size = new THREE.Vector3(); box.getSize(size);
      var maxDim = Math.max(size.x, size.y, size.z, 0.2);
      var cfg = CFG.star;
      var markRadius = THREE.MathUtils.clamp(maxDim * (cfg.sizeRatio || 0.11), cfg.minSize || 0.07, cfg.maxSize || 0.15);
      state.modelMaxDim = maxDim;
      state.flyRangeX = 1 * maxDim;
      state.flyRangeY = 1 * maxDim;
      state.flyRangeZ = 1 * maxDim;
      state.baseHeight = 0.5 * maxDim;
      state.starSize = 15 * markRadius;
      console.log("📐 Model dimensions cached:", { maxDim: maxDim, starSize: state.starSize });
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

    /* ── Spawn a Round of Stars ── */
    spawnStarRound: function () {
      var self = this;
      state.tappedCount = 0;
      state.activeStars = [];
      state.isTransitioning = false;
      state.roundCount++;
      updateStarCounter();

      var holder = document.getElementById("model-holder");
      if (!holder) return;

      var stagger = (CFG.spawn && CFG.spawn.staggerDelay) || 300;

      for (var i = 0; i < state.totalStars; i++) {
        (function (idx) {
          setTimeout(function () {
            if (state.isTransitioning) return;
            self._createStar(holder, idx);
          }, idx * stagger);
        })(i);
      }
      console.log("⭐ Round " + state.roundCount + ": Spawning " + state.totalStars + " stars");
    },

    /* ── Create One Flying Star ── */
    _createStar: function (parentEl, index) {
      var self = this;
      var cfg = CFG.star;
      var sz = state.starSize;

      // Spread initial positions apart using angle offset
      var angle = (index / state.totalStars) * Math.PI * 2 + Math.random() * 0.5;
      var initPos = {
        x: Math.cos(angle) * state.flyRangeX * 0.6,
        y: state.baseHeight + Math.random() * state.flyRangeY,
        z: Math.sin(angle) * state.flyRangeZ * 0.6
      };

      var plane = document.createElement("a-plane");
      plane.classList.add("can-tap", "cantap");
      plane.setAttribute("width", sz.toFixed(3));
      plane.setAttribute("height", sz.toFixed(3));
      plane.setAttribute("position", initPos.x.toFixed(3) + " " + initPos.y.toFixed(3) + " " + initPos.z.toFixed(3));
      plane.setAttribute("material", "shader: flat; transparent: true; opacity: 0.001; side: double; depthWrite: false");
      plane.setAttribute("billboard", "spinSpeed: 0");

      // Pulse
      plane.setAttribute("animation__pulse", {
        property: "scale", dir: "alternate",
        from: (cfg.pulseMin || 0.92) + " " + (cfg.pulseMin || 0.92) + " " + (cfg.pulseMin || 0.92),
        to: (cfg.pulseScale || 1.35) + " " + (cfg.pulseScale || 1.35) + " " + (cfg.pulseScale || 1.35),
        dur: (cfg.pulseDuration || 650) + index * 50, easing: "linear", loop: true
      });

      // Random fly (fast erratic speed per star, slight variation)
      var speed = (cfg.flySpeed || 700) + index * 80;
      plane.setAttribute("random-fly",
        "rangeX: " + state.flyRangeX.toFixed(3) + "; rangeY: " + state.flyRangeY.toFixed(3) +
        "; rangeZ: " + state.flyRangeZ.toFixed(3) + "; baseHeight: " + state.baseHeight.toFixed(3) +
        "; speed: " + speed
      );

      // Spawn scale-in animation
      plane.setAttribute("animation__spawn", {
        property: "scale", from: "0.01 0.01 0.01", to: "1 1 1",
        dur: (CFG.spawn && CFG.spawn.duration) || 360, easing: "easeOutBack"
      });

      // Apply video texture
      plane.addEventListener("loaded", function () {
        var mesh = plane.getObject3D("mesh");
        if (mesh) {
          mesh.castShadow = false; mesh.frustumCulled = false;
          var vid = document.getElementById("star-fly-video");
          if (vid) {
            var tex = new THREE.VideoTexture(vid);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.format = THREE.RGBAFormat;
            mesh.material = new THREE.MeshBasicMaterial({
              map: tex, blending: THREE.AdditiveBlending,
              transparent: true, depthWrite: false,
              side: THREE.DoubleSide, toneMapped: false
            });
          }
        }
      }, { once: true });

      var tapped = false;

      // Tap handler
      var handleTap = function () {
        if (tapped || state.isTransitioning) return;
        tapped = true;

        state.tappedCount++;
        updateStarCounter();
        console.log("👆 Star " + (index + 1) + " tapped! (" + state.tappedCount + "/" + state.totalStars + ")");

        plane.removeEventListener("click", handleTap);
        plane.removeEventListener("pointerdown", handleTap);
        plane.removeEventListener("touchstart", handleTouch);

        // Stop movement
        plane.removeAttribute("random-fly");
        plane.removeAttribute("animation__fly");
        plane.removeAttribute("animation__pulse");

        // Haptic
        if (navigator.vibrate) navigator.vibrate(60);

        // Halo
        createHaloEffect(plane);

        // Fade out star
        var fadeDur = cfg.fadeDuration || 800;
        plane.setAttribute("animation__fadeout", {
          property: "scale", to: "2.5 2.5 2.5", dur: fadeDur, easing: "easeOutQuad"
        });

        var mesh = plane.getObject3D("mesh");
        if (mesh && mesh.material) {
          var startOp = mesh.material.opacity || 1;
          var t0 = Date.now();
          (function fadeLoop() {
            var t = Math.min((Date.now() - t0) / fadeDur, 1);
            if (mesh.material) mesh.material.opacity = startOp * (1 - t);
            if (t < 1) requestAnimationFrame(fadeLoop);
          })();
        }

        // Remove star element after fade
        setTimeout(function () {
          try { plane.remove(); } catch (e) {}
          var idx = state.activeStars.indexOf(plane);
          if (idx !== -1) state.activeStars.splice(idx, 1);
        }, fadeDur + 50);

        // All stars tapped? → swap!
        if (state.tappedCount >= state.totalStars) {
          state.isTransitioning = true;
          var swapDelay = (CFG.swap && CFG.swap.delay) || 500;
          setTimeout(function () {
            triggerBurst();
            self.toggleModels();
            // Spawn next round after brief pause
            setTimeout(function () {
              state.isTransitioning = false;
              self.spawnStarRound();
            }, 1200);
          }, swapDelay);
        }
      };

      var handleTouch = function (e) {
        if (e.preventDefault) e.preventDefault();
        handleTap();
      };

      plane.addEventListener("click", handleTap);
      plane.addEventListener("pointerdown", handleTap);
      plane.addEventListener("touchstart", handleTouch, { passive: false });

      parentEl.appendChild(plane);
      state.activeStars.push(plane);
    },

    /* ── Toggle Models ── */
    toggleModels: function () {
      var realEl = document.getElementById("realModel");
      var fictEl = document.getElementById("fictionalModel");

      if (state.showingFictional) {
        console.log("🔄 → Real Item");
        if (fictEl) fictEl.setAttribute("visible", "false");
        if (realEl) realEl.setAttribute("visible", "true");
        state.showingFictional = false;
        UI.showItemName(state.realName || "Real Item");
      } else {
        console.log("🔄 → Fictional Item");
        if (realEl) realEl.setAttribute("visible", "false");
        if (fictEl) fictEl.setAttribute("visible", "true");
        state.showingFictional = true;
        state.fictionalRevealed = true;
        UI.showItemName(state.itemName || "Fictional Item");
      }

      state.toggleCount++;
      console.log("🔄 Toggle #" + state.toggleCount);

      if (state.toggleCount >= 3) {
        var backBtn = document.getElementById("back-to-main");
        if (backBtn && !backBtn.classList.contains("visible")) {
          backBtn.classList.add("visible");
          console.log("🏠 Back button shown");
        }
      }
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    console.log("📱 DOM ready for 3-Star Tap AR");
  });
})();
