(() => {
  "use strict";

  // ─── Helpers: typeof polyfill ───
  function _typeof(obj) {
    return (_typeof =
      "function" == typeof Symbol && "symbol" == typeof Symbol.iterator
        ? function (o) { return typeof o; }
        : function (o) {
            return o && "function" == typeof Symbol &&
              o.constructor === Symbol && o !== Symbol.prototype
              ? "symbol"
              : typeof o;
          }),
    _typeof(obj);
  }

  // ─── Helpers: defineProperty wrapper ───
  function _defineProperty(target, key, value) {
    key = (function (arg) {
      var prim = (function (input) {
        if ("object" != _typeof(input) || !input) return input;
        var fn = input[Symbol.toPrimitive];
        if (void 0 !== fn) {
          var out = fn.call(input, "string");
          if ("object" != _typeof(out)) return out;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return String(input);
      })(arg);
      return "symbol" == _typeof(prim) ? prim : prim + "";
    })(key);

    return key in target
      ? Object.defineProperty(target, key, {
          value: value,
          enumerable: true,
          configurable: true,
          writable: true,
        })
      : (target[key] = value),
    target;
  }

  // ─── Helpers: own keys ───
  function _ownKeys(obj, enumerableOnly) {
    var keys = Object.keys(obj);
    if (Object.getOwnPropertySymbols) {
      var syms = Object.getOwnPropertySymbols(obj);
      if (enumerableOnly) {
        syms = syms.filter(function (s) {
          return Object.getOwnPropertyDescriptor(obj, s).enumerable;
        });
      }
      keys.push.apply(keys, syms);
    }
    return keys;
  }

  // ─── Helpers: object spread ───
  function _objectSpread(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      i % 2
        ? _ownKeys(Object(source), true).forEach(function (key) {
            _defineProperty(target, key, source[key]);
          })
        : Object.getOwnPropertyDescriptors
          ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source))
          : _ownKeys(Object(source)).forEach(function (key) {
              Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
            });
    }
    return target;
  }

  console.log("✅ Track AR Interaction loaded");

  // ═══════════════════════════════════════════
  //  CONFIG — merge defaults with ar-config.js
  // ═══════════════════════════════════════════
  var CONFIG = (function () {
    var defaults = {
      debug: false,
      targetSize: 0.6,
      roam:     { speed: 1, radius: 4, minY: 1, maxY: 5 },
      track:    { duration: 5000, hitboxPadding: 0.5 },
      dissolve: { duration: 600 },
      material: { metalness: 0.15, roughness: 0.85 },
    };

    var ext = window.TRACK_CONFIG;
    if (!ext || "object" !== _typeof(ext)) return defaults;

    var merged = {};
    for (var idx = 0, keys = Object.keys(defaults); idx < keys.length; idx++) {
      var key = keys[idx];
      if (
        defaults[key] && "object" === _typeof(defaults[key]) && !Array.isArray(defaults[key]) &&
        ext[key]      && "object" === _typeof(ext[key])      && !Array.isArray(ext[key])
      ) {
        merged[key] = _objectSpread(_objectSpread({}, defaults[key]), ext[key]);
      } else {
        merged[key] = key in ext ? ext[key] : defaults[key];
      }
    }
    console.log("⚙️ TRACK_CONFIG merged from ar-config.js", merged);
    return merged;
  })();

  // ═══════════════════════════════════
  //  TEST MODE flags (local dev only)
  // ═══════════════════════════════════
  var TEST_MODE = {
    enabled: true,
    realGlb: "assets/realmodel.glb",
    fictionalGlb: "assets/fictionalmodel.glb",
    itemName: "Test Fictional Item",
    realName: "Test Real Item",
  };

  // ═══════════════════════════════════
  //  APP STATE
  // ═══════════════════════════════════
  var appState = {
    realGlbUrl: null,
    fictionalGlbUrl: null,
    itemName: null,
    realName: null,
    shellLoaded: false,
    coreLoaded: false,
    showingFictional: false,
    trackTimer: 0,
  };

  // ═══════════════════════════════════
  //  UI HELPERS
  // ═══════════════════════════════════
  var ui = {
    init: function () {
      this.hint           = document.getElementById("ar-hint");
      this.status         = document.getElementById("ar-status");
      this.aimIcon        = document.getElementById("aim-icon");
      this.trackProgress  = document.getElementById("track-progress");
      this.progressFill   = document.querySelector("#track-progress .progress-fill");
      this.trackingText   = document.getElementById("tracking-text");
      this.itemNameDisplay = document.getElementById("item-name-display");
    },

    showHint: function () {
      this.hint && this.hint.classList.remove("ar-ui-hidden");
    },
    hideHint: function () {
      this.hint && this.hint.classList.add("ar-ui-hidden");
    },

    setStatus: function (text) {
      var cls = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : "";
      if (this.status) {
        var old;
        null === (old = this.status.querySelector(".status-text")) || void 0 === old || old.remove();
        var span = document.createElement("span");
        span.className = "status-text";
        span.textContent = text;
        this.status.appendChild(span);
        this.status.className = "ar-status ".concat(cls);
      }
    },

    setTargeting: function (active) {
      this.aimIcon &&
        (active
          ? this.aimIcon.classList.add("targeting")
          : this.aimIcon.classList.remove("targeting"));
    },

    updateProgress: function (pct) {
      if (this.progressFill) {
        var offset = 283 * (1 - pct);
        this.progressFill.style.strokeDashoffset = offset;
      }
    },

    showTrackingText: function (elapsed, total) {
      this.trackingText &&
        ((this.trackingText.textContent =
          "Tracking... ".concat(elapsed.toFixed(1), "s / ").concat(total.toFixed(1), "s")),
        this.trackingText.classList.add("visible"));
    },
    hideTrackingText: function () {
      this.trackingText && this.trackingText.classList.remove("visible");
    },

    hideAimUI: function () {
      this.aimIcon && (this.aimIcon.style.display = "none");
      this.trackProgress && (this.trackProgress.style.display = "none");
      this.hideTrackingText();
    },

    showItemName: function (name) {
      this.itemNameDisplay &&
        name &&
        ((this.itemNameDisplay.textContent = "✨ ".concat(name)),
        this.itemNameDisplay.classList.add("visible"));
    },
    hideItemName: function () {
      this.itemNameDisplay && this.itemNameDisplay.classList.remove("visible");
    },
  };

  // ═══════════════════════════════════
  //  fixMaterials — ensure every mesh
  //  has a valid transparent material
  // ═══════════════════════════════════
  function fixMaterials(root) {
    var fixCount = 0;
    root.traverse(function (node) {
      if (node.isMesh) {
        var mats = Array.isArray(node.material) ? node.material : [node.material];
        if (mats.length && mats[0]) {
          mats.forEach(function (m) {
            if (m) {
              m.transparent = true;
              m.opacity = 1;
              m.depthWrite = true;
              m.side = THREE.DoubleSide;
              m.needsUpdate = true;
            }
          });
        } else {
          node.material = new THREE.MeshStandardMaterial({
            color: 14540253,
            metalness: CONFIG.material.metalness,
            roughness: CONFIG.material.roughness,
            transparent: true,
            opacity: 1,
            depthWrite: true,
            side: THREE.DoubleSide,
          });
          fixCount++;
        }
        node.frustumCulled = false;
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    if (fixCount > 0) {
      console.log("🔧 Fixed ".concat(fixCount, " mesh material(s)"));
    }
  }

  // ═══════════════════════════════════
  //  animateOpacity — lerp meshes
  //  from → to over duration ms
  // ═══════════════════════════════════
  function animateOpacity(meshes, from, to, duration, onComplete) {
    if (!meshes || 0 === meshes.length) {
      onComplete && onComplete();
      return;
    }
    var start = performance.now();
    var step = function () {
      var elapsed = performance.now() - start;
      var t = Math.min(elapsed / duration, 1);
      var opacity = THREE.MathUtils.lerp(from, to, t);

      meshes.forEach(function (m) {
        if (m && m.material) {
          m.material.opacity = opacity;
          m.material.transparent = true;
          m.material.depthWrite = opacity > 0.5;
          m.material.needsUpdate = true;
          m.visible = opacity > 0.01;
        }
      });

      if (t < 1) {
        requestAnimationFrame(step);
      } else if (onComplete) {
        onComplete();
      }
    };
    step();
  }

  // ═══════════════════════════════════
  //  COMPONENT: sky-roam
  //  Moves entity randomly in the sky
  // ═══════════════════════════════════
  AFRAME.registerComponent("sky-roam", {
    schema: {
      speed:  { type: "number", default: CONFIG.roam.speed },
      radius: { type: "number", default: CONFIG.roam.radius },
      minY:   { type: "number", default: CONFIG.roam.minY },
      maxY:   { type: "number", default: CONFIG.roam.maxY },
    },

    init: function () {
      console.log("[sky-roam] Initializing...");
      this.nextTarget = this.getRandomTarget();
      this.active = true;
    },

    tick: function (time, delta) {
      if (!this.active) return;

      var pos = this.el.object3D.position;
      var target = this.nextTarget;

      if (pos.distanceTo(target) < 0.15) {
        this.nextTarget = this.getRandomTarget();
      } else {
        var dir = new THREE.Vector3().subVectors(target, pos).normalize();
        var step = (this.data.speed * delta) / 1000;
        this.el.object3D.position.addScaledVector(dir, step);
      }
    },

    getRandomTarget: function () {
      var angle = Math.random() * Math.PI * 2;
      var dist = this.data.radius * (0.6 + 0.4 * Math.random());
      var x = Math.cos(angle) * dist;
      var z = Math.sin(angle) * dist;
      var y = THREE.MathUtils.lerp(this.data.minY, this.data.maxY, Math.random());
      return new THREE.Vector3(x, y, -Math.abs(z));
    },

    stop: function () {
      this.active = false;
    },
    resume: function () {
      this.active = true;
      this.nextTarget = this.getRandomTarget();
    },
  });

  // ═══════════════════════════════════════════════
  //  COMPONENT: sky-shell-core
  //  Manages shell ↔ core toggle via raycasting
  // ═══════════════════════════════════════════════
  AFRAME.registerComponent("sky-shell-core", {
    schema: {
      trackDuration: { type: "number", default: CONFIG.track.duration },
    },

    init: function () {
      var self = this;
      console.log("[sky-shell-core] Initializing...");

      this.shellEl = this.el;
      this.coreEl = null;
      this.timer = 0;
      this.missGrace = 0;
      this.showingFictional = false;
      this.transitioning = false;
      this.toggleCount = 0;
      this.readyForRaycast = false;
      this.stabilizationFrames = 0;

      this.camera = null;
      this.raycaster = new THREE.Raycaster();
      this.raycaster.far = 100;

      this.shellMeshes = [];
      this.coreMeshes = [];
      this.hitboxMesh = null;

      this.setupCamera();

      this.shellEl.addEventListener(
        "model-loaded",
        function () {
          var mesh = self.shellEl.getObject3D("mesh");
          if (mesh) {
            fixMaterials(mesh);
            mesh.traverse(function (child) {
              if (child.isMesh) self.shellMeshes.push(child);
            });
            self.createHitbox();
            console.log(
              "[sky-shell-core] ✅ Shell ready: ".concat(self.shellMeshes.length, " meshes")
            );
          }
        },
        { once: true }
      );
    },

    setupCamera: function () {
      this.camera = document.getElementById("camera");
      if (!this.camera) this.camera = document.querySelector("[camera]");
      if (!this.camera) this.camera = document.querySelector("a-camera");

      this.camera
        ? console.log("[sky-shell-core] ✅ Camera found:", this.camera.id || "unnamed")
        : console.warn("[sky-shell-core] ⚠️ Camera not found, will retry in tick");
    },

    createHitbox: function () {
      var mesh = this.shellEl.getObject3D("mesh");
      if (!mesh) {
        console.warn("[sky-shell-core] ⚠️ No mesh found for hitbox");
        return;
      }

      this.shellEl.object3D.updateMatrixWorld(true);
      mesh.updateMatrixWorld(true);

      var box = new THREE.Box3().setFromObject(mesh);
      var size = new THREE.Vector3();
      var center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      if (0 === size.x || 0 === size.y || 0 === size.z) {
        console.error("[sky-shell-core] ❌ Invalid bounding box size:", size);
        return;
      }

      var padding = CONFIG.track.hitboxPadding;
      var paddedSize = size.clone().multiplyScalar(1 + padding);
      var geo = new THREE.BoxGeometry(paddedSize.x, paddedSize.y, paddedSize.z);

      var isDebug = CONFIG.debug;
      var mat = new THREE.MeshBasicMaterial({
        color: isDebug ? 65280 : 16777215,
        transparent: true,
        opacity: isDebug ? 0.4 : 0,
        wireframe: isDebug,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      });

      this.hitboxMesh = new THREE.Mesh(geo, mat);
      this.hitboxMesh.name = "shell_hitbox";
      this.shellEl.object3D.worldToLocal(center);
      this.hitboxMesh.position.copy(center);
      this.hitboxMesh.raycast = THREE.Mesh.prototype.raycast;
      this.shellEl.object3D.add(this.hitboxMesh);

      console.log("[sky-shell-core] ✅ Hitbox created", {
        size: paddedSize,
        center: center,
        padding: padding,
        worldPosition: this.shellEl.object3D.position.clone(),
      });

      this.hitboxCreated = true;
      this.checkReadyForRaycast();
    },

    checkReadyForRaycast: function () {
      if (this.readyForRaycast || !this.hitboxCreated || !this.hitboxMesh) return;

      if (!this.camera || !this.camera.components || !this.camera.components.camera) {
        this.setupCamera();
        return;
      }

      this.stabilizationFrames++;
      if (this.stabilizationFrames < 10) return;

      this.el.sceneEl.object3D.updateMatrixWorld(true);
      this.shellEl.object3D.updateMatrixWorld(true);
      this.readyForRaycast = true;
      console.log("[sky-shell-core] ✅ Raycast ENABLED - all conditions met");

      var pos = new THREE.Vector3();
      this.hitboxMesh.getWorldPosition(pos);
      console.log(
        "[sky-shell-core] Hitbox world position:",
        pos.toArray().map(function (v) { return v.toFixed(2); })
      );
    },

    tick: function (time, delta) {
      if (this.transitioning) return;

      if (!this.readyForRaycast) {
        this.checkReadyForRaycast();
        return;
      }

      if (!this.hitboxMesh) return;

      this.shellEl.object3D.updateMatrixWorld(true);

      var cam = this.camera.components.camera.camera;
      var origin = new THREE.Vector3();
      var direction = new THREE.Vector3();
      cam.getWorldPosition(origin);
      cam.getWorldDirection(direction);
      this.raycaster.set(origin, direction);

      var hits = this.raycaster.intersectObject(this.hitboxMesh, false);

      // Debug logging every 120 frames
      if (!this._debugCounter) this._debugCounter = 0;
      this._debugCounter++;
      if (this._debugCounter % 120 === 0) {
        var hbPos = new THREE.Vector3();
        this.hitboxMesh.getWorldPosition(hbPos);
        var camPos = new THREE.Vector3();
        cam.getWorldPosition(camPos);
        console.log("[sky-shell-core] Raycast debug:", {
          hitboxWorldPos: hbPos.toArray().map(function (v) { return v.toFixed(2); }),
          shellPos: this.shellEl.object3D.position.toArray().map(function (v) { return v.toFixed(2); }),
          cameraWorldPos: camPos.toArray().map(function (v) { return v.toFixed(2); }),
          rayOrigin: this.raycaster.ray.origin.toArray().map(function (v) { return v.toFixed(2); }),
          rayDirection: this.raycaster.ray.direction.toArray().map(function (v) { return v.toFixed(2); }),
          hits: hits.length,
        });
      }

      if (hits.length > 0) {
        // Aiming at the object
        this.timer += delta;
        this.missGrace = 0;

        var progress = this.timer / this.data.trackDuration;
        var elapsedSec = this.timer / 1000;
        var totalSec = this.data.trackDuration / 1000;

        ui.setTargeting(true);
        ui.updateProgress(progress);
        ui.showTrackingText(elapsedSec, totalSec);

        if (this.timer >= this.data.trackDuration) {
          this.toggleModels();
        }
      } else {
        // Not aiming — grace period then reset
        this.missGrace += delta;
        if (this.missGrace > 300) {
          this.timer = 0;
          this.missGrace = 0;
          ui.setTargeting(false);
          ui.updateProgress(0);
          ui.hideTrackingText();
        }
      }
    },

    setCoreEntity: function (entity) {
      this.coreEl = entity;
    },

    toggleModels: function () {
      var self = this;
      if (this.transitioning) return;

      this.transitioning = true;
      this.timer = 0;
      this.missGrace = 0;
      console.log("🔄 Toggle! Current:", this.showingFictional ? "Fictional" : "Real");

      var roamComp = this.shellEl.components["sky-roam"];
      if (roamComp) roamComp.stop();

      ui.setTargeting(false);
      ui.updateProgress(0);
      ui.hideTrackingText();

      var dur = CONFIG.dissolve.duration;

      if (this.showingFictional) {
        // ── Fictional → Real ──
        ui.showItemName(appState.realName || "Real Item");
        animateOpacity(this.coreMeshes, 1, 0, dur, function () {
          if (self.coreEl) self.coreEl.setAttribute("visible", false);
          animateOpacity(self.shellMeshes, 0, 1, dur, function () {
            self.showingFictional = false;
            appState.showingFictional = false;
            console.log("🔙 Now showing Real Item");
            setTimeout(function () {
              if (roamComp) roamComp.resume();
              self.transitioning = false;
              self.toggleCount++;
              console.log(
                "🛫 Resume flying (Real visible) — toggle #".concat(self.toggleCount)
              );
              if (self.toggleCount >= 3) self.showBackButton();
            }, 3000);
          });
        });
      } else {
        // ── Real → Fictional ──
        animateOpacity(this.shellMeshes, 1, 0, dur, function () {
          if (!self.coreEl) return;

          self.coreEl.setAttribute("visible", true);

          if (0 === self.coreMeshes.length) {
            var coreMesh = self.coreEl.getObject3D("mesh");
            if (coreMesh) {
              coreMesh.traverse(function (child) {
                if (child.isMesh) {
                  child.material.transparent = true;
                  child.material.opacity = 0;
                  child.visible = true;
                  self.coreMeshes.push(child);
                }
              });
            }
          }

          animateOpacity(self.coreMeshes, 0, 1, dur, function () {
            self.showingFictional = true;
            appState.showingFictional = true;
            console.log("✨ Now showing Fictional Item");
            if (appState.itemName) ui.showItemName(appState.itemName);
            setTimeout(function () {
              if (roamComp) roamComp.resume();
              self.transitioning = false;
              self.toggleCount++;
              console.log(
                "🛫 Resume flying (Fictional visible) — toggle #".concat(self.toggleCount)
              );
              if (self.toggleCount >= 3) self.showBackButton();
            }, 3000);
          });
        });
      }
    },

    showBackButton: function () {
      var btn = document.getElementById("back-to-main");
      if (btn && !btn.classList.contains("visible")) {
        btn.classList.add("visible");
        console.log("🏠 Back button shown after", this.toggleCount, "toggles");
      }
    },
  });

  // ═══════════════════════════════════
  //  PRE-AR OVERLAY controller
  // ═══════════════════════════════════
  var preArOverlay = {
    _safetyTimer: null,

    setStatus: function (text) {
      var el = document.getElementById("pre-ar-status");
      if (el) el.textContent = text;
    },

    enableStart: function () {
      var btn = document.getElementById("enter-ar-button");
      if (btn) {
        btn.textContent = "Start AR";
        btn.disabled = false;
      }
      this.setStatus("Model ready — tap to enter AR");
    },

    dismissOverlay: function () {
      if (this._dismissed) return;
      this._dismissed = true;
      if (this._safetyTimer) {
        clearTimeout(this._safetyTimer);
        this._safetyTimer = null;
      }
      var overlay = document.getElementById("pre-ar-overlay");
      if (overlay) overlay.classList.add("is-hidden");
    },

    _showOverlay: function () {
      var overlay = document.getElementById("pre-ar-overlay");
      if (overlay) overlay.classList.remove("is-hidden");
      this._dismissed = false;
    },

    bind: function (sceneEl) {
      var self = this;
      this._dismissed = false;

      var btn = document.getElementById("enter-ar-button");
      if (!btn) return;

      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = "Starting AR…";
        sceneEl.emit("runreality");

        if (self._safetyTimer) clearTimeout(self._safetyTimer);
        self._safetyTimer = setTimeout(function () {
          return self.dismissOverlay();
        }, 5000);
      });

      sceneEl.addEventListener("realityready", function () {
        self.dismissOverlay();
      });

      sceneEl.addEventListener("realityerror", function () {
        if (self._safetyTimer) {
          clearTimeout(self._safetyTimer);
          self._safetyTimer = null;
        }
        self._showOverlay();
        btn.textContent = "AR Failed — Retry";
        btn.disabled = false;
        self.setStatus("AR failed to start.\nPlease check camera permissions.");
      });
    },
  };

  // ═══════════════════════════════════════════════
  //  COMPONENT: track-ar-interaction (main entry)
  // ═══════════════════════════════════════════════
  AFRAME.registerComponent("track-ar-interaction", {
    init: function () {
      console.log("🎮 Track AR Interaction initializing...");
      preArOverlay.bind(this.el);
      ui.init();

      // Parse URL parameters (or use test-mode overrides)
      var params = (function () {
        var urlParams = new URLSearchParams(window.location.search);

        if (TEST_MODE.enabled) {
          console.log("🧪 TEST MODE: Using local assets");
          return {
            realGlb: TEST_MODE.realGlb,
            fictionalGlb: TEST_MODE.fictionalGlb,
            interaction: "Track",
            itemName: TEST_MODE.itemName,
            realName: TEST_MODE.realName || "Real Item",
          };
        }

        return {
          realGlb: urlParams.get("real_glb"),
          fictionalGlb: urlParams.get("fictional_glb"),
          interaction: urlParams.get("interaction") || "Track",
          itemName: urlParams.get("item_name"),
          realName: urlParams.get("real_name") || "Real Item",
        };
      })();

      appState.realGlbUrl = params.realGlb;
      appState.fictionalGlbUrl = params.fictionalGlb;
      appState.itemName = params.itemName;
      appState.realName = params.realName;
      console.log("📋 URL Parameters:", params);

      if (!appState.realGlbUrl) {
        console.error("❌ Missing required parameter: real_glb");
        ui.setStatus("Error: Missing real_glb parameter", "error");
        return;
      }

      ui.showHint();
      ui.setStatus("Loading models...", "waiting");
      this.loadModels();
    },

    loadModels: function () {
      var self = this;
      console.log("📥 Loading models...");
      this.loadShellModel();
      if (appState.fictionalGlbUrl) {
        setTimeout(function () {
          self.loadCoreModel();
        }, 100);
      }
    },

    loadShellModel: function () {
      var self = this;
      var shellEl = document.getElementById("shellEntity");
      if (!shellEl) {
        console.error("❌ #shellEntity not found");
        return;
      }

      console.log("🐚 Loading Shell (Real Item):", appState.realGlbUrl);
      shellEl.setAttribute("gltf-model", appState.realGlbUrl);

      shellEl.addEventListener(
        "model-loaded",
        function () {
          console.log("✅ Shell model loaded");
          appState.shellLoaded = true;
          var mesh = shellEl.getObject3D("mesh");
          if (mesh) fixMaterials(mesh);
          self.checkAllLoaded();
        },
        { once: true }
      );

      shellEl.addEventListener(
        "model-error",
        function (evt) {
          console.error("❌ Shell model failed:", evt);
          ui.setStatus("Failed to load shell", "error");
        },
        { once: true }
      );
    },

    loadCoreModel: function () {
      var self = this;
      var shellEl = document.getElementById("shellEntity");
      if (!shellEl) {
        console.error("❌ #shellEntity not found for core");
        return;
      }

      console.log("💎 Loading Core (Fictional Item):", appState.fictionalGlbUrl);

      var coreEl = document.createElement("a-entity");
      coreEl.id = "coreEntity";
      coreEl.setAttribute("gltf-model", appState.fictionalGlbUrl);
      coreEl.setAttribute("position", "0 0 0");
      coreEl.setAttribute("scale", "1 1 1");
      coreEl.setAttribute("visible", false);
      coreEl.setAttribute("shadow", "cast: true; receive: false");

      coreEl.addEventListener(
        "model-loaded",
        function () {
          console.log("✅ Core model loaded");
          appState.coreLoaded = true;

          var mesh = coreEl.getObject3D("mesh");
          if (mesh) {
            fixMaterials(mesh);
            mesh.traverse(function (child) {
              if (child.isMesh) {
                child.material.transparent = true;
                child.material.opacity = 0;
                child.visible = false;
              }
            });
          }

          var shellCoreComp = shellEl.components["sky-shell-core"];
          if (shellCoreComp) shellCoreComp.setCoreEntity(coreEl);
          self.checkAllLoaded();
        },
        { once: true }
      );

      coreEl.addEventListener(
        "model-error",
        function (evt) {
          console.error("❌ Core model failed:", evt);
        },
        { once: true }
      );

      shellEl.appendChild(coreEl);
    },

    checkAllLoaded: function () {
      var shellReady = appState.shellLoaded;
      var coreReady = !appState.fictionalGlbUrl || appState.coreLoaded;

      if (shellReady && coreReady) {
        console.log("✅ All models loaded - Ready for tracking");
        ui.setStatus("Aim at the flying object!", "complete");
        preArOverlay.enableStart();
      } else if (shellReady) {
        ui.setStatus("Shell ready, loading core...", "waiting");
        preArOverlay.enableStart();
      }
    },
  });

  // ─── DOM Ready ───
  document.addEventListener("DOMContentLoaded", function () {
    console.log("📱 DOM ready for Track AR Interaction");
  });
})();