(() => {
  "use strict";

  // ─── Helpers ───
  function _typeof(obj) {
    return (_typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator
      ? function (o) { return typeof o; }
      : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }),
    _typeof(obj);
  }

  function _objectSpread(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      Object.keys(source).forEach(function (key) { target[key] = source[key]; });
    }
    return target;
  }

  console.log("✅ Track AR Interaction loaded (animism mode)");

  // ═══════════════════════════════════════════
  //  CONFIG
  // ═══════════════════════════════════════════
  var CONFIG = (function () {
    var defaults = {
      debug: false,
      targetSize: 0.6,
      roam: { speed: 1, radius: 4, minY: 1, maxY: 5 },
      track: { duration: 7000, hitboxPadding: 0.5, cumulative: true, decayRate: 0.05 },
      gazeAware: {
        reactionDelay: 300,
        behaviors: { dodge: 0.5, shy: 0.3, curious: 0.2 },
        dodge: { speedMultiplier: 2.5, deflectionAngle: 60 },
        shy: { speedMultiplier: 0.3, wobbleDeg: 3, wobblePeriod: 400 },
        curious: { speedMultiplier: 0.8, approachDistance: 2.5, minDistance: 1.5 },
        behaviorDuration: 2000,
        transitionSmoothing: 0.05
      },
      dissolve: { duration: 600 },
      material: { metalness: 0.15, roughness: 0.85 }
    };
    var ext = window.TRACK_ANIMISM_CONFIG;
    if (!ext || "object" !== _typeof(ext)) return defaults;
    var merged = {};
    for (var idx = 0, keys = Object.keys(defaults); idx < keys.length; idx++) {
      var key = keys[idx];
      if (defaults[key] && "object" === _typeof(defaults[key]) && !Array.isArray(defaults[key]) &&
          ext[key] && "object" === _typeof(ext[key]) && !Array.isArray(ext[key])) {
        merged[key] = _objectSpread(_objectSpread({}, defaults[key]), ext[key]);
      } else {
        merged[key] = key in ext ? ext[key] : defaults[key];
      }
    }
    // Deep merge gazeAware sub-objects
    if (ext.gazeAware && defaults.gazeAware) {
      ["behaviors", "dodge", "shy", "curious"].forEach(function (k) {
        if (ext.gazeAware[k] && defaults.gazeAware[k]) {
          merged.gazeAware[k] = _objectSpread(_objectSpread({}, defaults.gazeAware[k]), ext.gazeAware[k]);
        }
      });
    }
    console.log("⚙️ TRACK_ANIMISM_CONFIG merged", merged);
    return merged;
  })();

  // ═══════════════════════════════════
  //  TEST MODE
  // ═══════════════════════════════════
  var TEST_MODE = {
    enabled: true,
    realGlb: "assets/realmodel.glb",
    fictionalGlb: "assets/fictionalmodel.glb",
    itemName: "Test Fictional Item",
    realName: "Test Real Item"
  };

  // ═══════════════════════════════════
  //  APP STATE
  // ═══════════════════════════════════
  var appState = {
    realGlbUrl: null, fictionalGlbUrl: null, itemName: null, realName: null,
    shellLoaded: false, coreLoaded: false, showingFictional: false,
    trackTimer: 0
  };

  // ═══════════════════════════════════
  //  UI
  // ═══════════════════════════════════
  var ui = {
    init: function () {
      this.hint = document.getElementById("ar-hint");
      this.aimIcon = document.getElementById("aim-icon");
      this.trackProgress = document.getElementById("track-progress");
      this.progressFill = document.querySelector("#track-progress .progress-fill");
      this.trackingText = document.getElementById("tracking-text");
      this.itemNameDisplay = document.getElementById("item-name-display");
      this.behaviorIndicator = document.getElementById("behavior-indicator");
    },
    showHint: function () { this.hint && this.hint.classList.remove("ar-ui-hidden"); },
    setTargeting: function (active) {
      this.aimIcon && (active ? this.aimIcon.classList.add("targeting") : this.aimIcon.classList.remove("targeting"));
    },
    updateProgress: function (pct) {
      if (this.progressFill) {
        this.progressFill.style.strokeDashoffset = 283 * (1 - pct);
      }
    },
    showTrackingText: function (elapsed, total) {
      this.trackingText &&
        ((this.trackingText.textContent = "Tracking... " + elapsed.toFixed(1) + "s / " + total.toFixed(1) + "s"),
        this.trackingText.classList.add("visible"));
    },
    hideTrackingText: function () {
      this.trackingText && this.trackingText.classList.remove("visible");
    },
    hideAimUI: function () {
      this.aimIcon && (this.aimIcon.style.display = "none");
      this.trackProgress && (this.trackProgress.style.display = "none");
      this.hideTrackingText();
      this.hideBehavior();
    },
    showBehavior: function (text) {
      this.behaviorIndicator &&
        ((this.behaviorIndicator.textContent = text),
        this.behaviorIndicator.classList.add("visible"));
    },
    hideBehavior: function () {
      this.behaviorIndicator && this.behaviorIndicator.classList.remove("visible");
    },
    showItemName: function (name) {
      this.itemNameDisplay && name &&
        ((this.itemNameDisplay.textContent = "✨ " + name),
        this.itemNameDisplay.classList.add("visible"));
    },
    hideItemName: function () {
      this.itemNameDisplay && this.itemNameDisplay.classList.remove("visible");
    }
  };

  // ═══════════════════════════════════
  //  fixMaterials / animateOpacity
  // ═══════════════════════════════════
  function fixMaterials(root) {
    var fixCount = 0;
    root.traverse(function (node) {
      if (node.isMesh) {
        var mats = Array.isArray(node.material) ? node.material : [node.material];
        if (mats.length && mats[0]) {
          mats.forEach(function (m) {
            if (m) { m.transparent = true; m.opacity = 1; m.depthWrite = true; m.side = THREE.DoubleSide; m.needsUpdate = true; }
          });
        } else {
          node.material = new THREE.MeshStandardMaterial({
            color: 14540253, metalness: CONFIG.material.metalness, roughness: CONFIG.material.roughness,
            transparent: true, opacity: 1, depthWrite: true, side: THREE.DoubleSide
          });
          fixCount++;
        }
        node.frustumCulled = false; node.castShadow = true; node.receiveShadow = true;
      }
    });
    if (fixCount > 0) console.log("🔧 Fixed " + fixCount + " mesh material(s)");
  }

  function animateOpacity(meshes, from, to, duration, onComplete) {
    if (!meshes || 0 === meshes.length) { onComplete && onComplete(); return; }
    var start = performance.now();
    var step = function () {
      var elapsed = performance.now() - start;
      var t = Math.min(elapsed / duration, 1);
      var opacity = THREE.MathUtils.lerp(from, to, t);
      meshes.forEach(function (m) {
        if (m && m.material) {
          m.material.opacity = opacity; m.material.transparent = true;
          m.material.depthWrite = opacity > 0.5; m.material.needsUpdate = true;
          m.visible = opacity > 0.01;
        }
      });
      if (t < 1) requestAnimationFrame(step);
      else if (onComplete) onComplete();
    };
    step();
  }

  // ═══════════════════════════════════
  //  COMPONENT: sky-roam-animism
  //  Gaze-aware flying behavior
  // ═══════════════════════════════════
  AFRAME.registerComponent("sky-roam-animism", {
    schema: {
      speed: { type: "number", default: CONFIG.roam.speed },
      radius: { type: "number", default: CONFIG.roam.radius },
      minY: { type: "number", default: CONFIG.roam.minY },
      maxY: { type: "number", default: CONFIG.roam.maxY }
    },

    init: function () {
      console.log("[sky-roam-animism] Initializing...");
      this.nextTarget = this.getRandomTarget();
      this.active = true;

      // Gaze-aware state
      this.isBeingWatched = false;
      this.watchStartTime = 0;
      this.currentBehavior = "idle"; // idle | dodge | shy | curious
      this.behaviorStartTime = 0;
      this.currentSpeedMult = 1.0;
      this.targetSpeedMult = 1.0;

      // Shy wobble state
      this.shyWobbleTime = 0;

      // Camera ref
      this.camera = null;
    },

    tick: function (time, delta) {
      if (!this.active) return;

      // Lazy camera lookup
      if (!this.camera) {
        this.camera = document.getElementById("camera") ||
                      document.querySelector("[camera]") ||
                      document.querySelector("a-camera");
      }

      var pos = this.el.object3D.position;
      var dtSec = delta / 1000;

      // Smooth speed multiplier transition
      var smoothing = CONFIG.gazeAware.transitionSmoothing;
      this.currentSpeedMult += (this.targetSpeedMult - this.currentSpeedMult) * smoothing;

      // Behavior-specific movement
      if (this.currentBehavior === "shy") {
        // Shy: minimal movement + nervous wobble
        this.shyWobbleTime += delta;
        var wobbleAngle = Math.sin(this.shyWobbleTime / CONFIG.gazeAware.shy.wobblePeriod * Math.PI * 2);
        var wobbleRad = CONFIG.gazeAware.shy.wobbleDeg * Math.PI / 180;
        this.el.object3D.rotation.z = wobbleAngle * wobbleRad;

        // Very slow drift toward target
        var dir = new THREE.Vector3().subVectors(this.nextTarget, pos).normalize();
        var step = this.data.speed * this.currentSpeedMult * dtSec;
        this.el.object3D.position.addScaledVector(dir, step);
      } else if (this.currentBehavior === "curious" && this.camera) {
        // Curious: move toward camera
        var camPos = new THREE.Vector3();
        this.camera.object3D.getWorldPosition(camPos);
        var toCamera = new THREE.Vector3().subVectors(camPos, pos);
        var dist = toCamera.length();

        if (dist > CONFIG.gazeAware.curious.minDistance) {
          toCamera.normalize();
          var step = this.data.speed * this.currentSpeedMult * dtSec;
          this.el.object3D.position.addScaledVector(toCamera, step);
        }
        // Reset wobble
        this.el.object3D.rotation.z *= 0.95;
      } else {
        // Default / dodge: move toward nextTarget (dodge picks far-away targets)
        var target = this.nextTarget;
        if (pos.distanceTo(target) < 0.15) {
          this.nextTarget = this.getRandomTarget();
        } else {
          var dir = new THREE.Vector3().subVectors(target, pos).normalize();
          var step = this.data.speed * this.currentSpeedMult * dtSec;
          this.el.object3D.position.addScaledVector(dir, step);
        }
        // Smooth out any wobble rotation
        this.el.object3D.rotation.z *= 0.95;
      }

      // Check if behavior expired
      if (this.currentBehavior !== "idle" &&
          time - this.behaviorStartTime > CONFIG.gazeAware.behaviorDuration) {
        if (this.isBeingWatched) {
          this.pickBehavior(time);
        } else {
          this.currentBehavior = "idle";
          this.targetSpeedMult = 1.0;
        }
      }
    },

    setWatched: function (isWatched, time) {
      if (isWatched && !this.isBeingWatched) {
        // Just started being watched
        this.isBeingWatched = true;
        this.watchStartTime = time;
        // React after delay
        var self = this;
        setTimeout(function () {
          if (self.isBeingWatched) {
            self.pickBehavior(performance.now());
          }
        }, CONFIG.gazeAware.reactionDelay);
      } else if (!isWatched && this.isBeingWatched) {
        // Stopped being watched — gradually return to idle
        this.isBeingWatched = false;
        this.currentBehavior = "idle";
        this.targetSpeedMult = 1.0;
        ui.hideBehavior();
      }
    },

    pickBehavior: function (time) {
      var behaviors = CONFIG.gazeAware.behaviors;
      var rand = Math.random();
      var cumulative = 0;

      if ((cumulative += behaviors.dodge) > rand) {
        this.currentBehavior = "dodge";
        this.targetSpeedMult = CONFIG.gazeAware.dodge.speedMultiplier;
        // Pick a target away from camera
        this.nextTarget = this.getDodgeTarget();
        ui.showBehavior("It's running away!");
      } else if ((cumulative += behaviors.shy) > rand) {
        this.currentBehavior = "shy";
        this.targetSpeedMult = CONFIG.gazeAware.shy.speedMultiplier;
        this.shyWobbleTime = 0;
        ui.showBehavior("It seems shy...");
      } else {
        this.currentBehavior = "curious";
        this.targetSpeedMult = CONFIG.gazeAware.curious.speedMultiplier;
        ui.showBehavior("It's curious about you!");
      }

      this.behaviorStartTime = time;
      console.log("[sky-roam-animism] Behavior:", this.currentBehavior);
    },

    getDodgeTarget: function () {
      if (!this.camera) return this.getRandomTarget();

      var camPos = new THREE.Vector3();
      this.camera.object3D.getWorldPosition(camPos);
      var myPos = this.el.object3D.position.clone();

      // Direction away from camera
      var away = new THREE.Vector3().subVectors(myPos, camPos).normalize();

      // Add random deflection
      var deflection = (Math.random() - 0.5) * 2 * CONFIG.gazeAware.dodge.deflectionAngle * Math.PI / 180;
      var cos = Math.cos(deflection), sin = Math.sin(deflection);
      var deflected = new THREE.Vector3(
        away.x * cos - away.z * sin,
        0,
        away.x * sin + away.z * cos
      ).normalize();

      var dist = this.data.radius * (0.6 + 0.4 * Math.random());
      var y = THREE.MathUtils.lerp(this.data.minY, this.data.maxY, Math.random());

      return new THREE.Vector3(
        deflected.x * dist,
        y,
        -Math.abs(deflected.z * dist)
      );
    },

    getRandomTarget: function () {
      var angle = Math.random() * Math.PI * 2;
      var dist = this.data.radius * (0.6 + 0.4 * Math.random());
      var x = Math.cos(angle) * dist;
      var z = Math.sin(angle) * dist;
      var y = THREE.MathUtils.lerp(this.data.minY, this.data.maxY, Math.random());
      return new THREE.Vector3(x, y, -Math.abs(z));
    },

    stop: function () { this.active = false; },
    resume: function () { this.active = true; this.nextTarget = this.getRandomTarget(); this.currentBehavior = "idle"; this.targetSpeedMult = 1.0; }
  });

  // ═══════════════════════════════════════════════
  //  COMPONENT: sky-shell-core-animism
  //  Cumulative tracking with gaze-aware integration
  // ═══════════════════════════════════════════════
  AFRAME.registerComponent("sky-shell-core-animism", {
    schema: {
      trackDuration: { type: "number", default: CONFIG.track.duration }
    },

    init: function () {
      var self = this;
      console.log("[sky-shell-core-animism] Initializing...");

      this.shellEl = this.el;
      this.coreEl = null;
      this.timer = 0;
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

      this.shellEl.addEventListener("model-loaded", function () {
        var mesh = self.shellEl.getObject3D("mesh");
        if (mesh) {
          fixMaterials(mesh);
          mesh.traverse(function (child) { if (child.isMesh) self.shellMeshes.push(child); });
          self.createHitbox();
          console.log("[sky-shell-core-animism] ✅ Shell ready: " + self.shellMeshes.length + " meshes");
        }
      }, { once: true });
    },

    setupCamera: function () {
      this.camera = document.getElementById("camera") || document.querySelector("[camera]") || document.querySelector("a-camera");
      this.camera ? console.log("[sky-shell-core-animism] ✅ Camera found") : console.warn("[sky-shell-core-animism] ⚠️ Camera not found");
    },

    createHitbox: function () {
      var mesh = this.shellEl.getObject3D("mesh");
      if (!mesh) return;

      this.shellEl.object3D.updateMatrixWorld(true);
      mesh.updateMatrixWorld(true);
      var box = new THREE.Box3().setFromObject(mesh);
      var size = new THREE.Vector3();
      var center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      if (0 === size.x || 0 === size.y || 0 === size.z) return;

      var padding = CONFIG.track.hitboxPadding;
      var paddedSize = size.clone().multiplyScalar(1 + padding);
      var geo = new THREE.BoxGeometry(paddedSize.x, paddedSize.y, paddedSize.z);
      var isDebug = CONFIG.debug;
      var mat = new THREE.MeshBasicMaterial({
        color: isDebug ? 65280 : 16777215,
        transparent: true, opacity: isDebug ? 0.4 : 0,
        wireframe: isDebug, depthWrite: false, depthTest: true, side: THREE.DoubleSide
      });

      this.hitboxMesh = new THREE.Mesh(geo, mat);
      this.hitboxMesh.name = "shell_hitbox";
      this.shellEl.object3D.worldToLocal(center);
      this.hitboxMesh.position.copy(center);
      this.hitboxMesh.raycast = THREE.Mesh.prototype.raycast;
      this.shellEl.object3D.add(this.hitboxMesh);

      this.hitboxCreated = true;
      this.checkReadyForRaycast();
    },

    checkReadyForRaycast: function () {
      if (this.readyForRaycast || !this.hitboxCreated || !this.hitboxMesh) return;
      if (!this.camera || !this.camera.components || !this.camera.components.camera) { this.setupCamera(); return; }
      this.stabilizationFrames++;
      if (this.stabilizationFrames < 10) return;
      this.el.sceneEl.object3D.updateMatrixWorld(true);
      this.shellEl.object3D.updateMatrixWorld(true);
      this.readyForRaycast = true;
      console.log("[sky-shell-core-animism] ✅ Raycast ENABLED");
    },

    tick: function (time, delta) {
      if (this.transitioning) return;
      if (!this.readyForRaycast) { this.checkReadyForRaycast(); return; }
      if (!this.hitboxMesh) return;

      this.shellEl.object3D.updateMatrixWorld(true);
      var cam = this.camera.components.camera.camera;
      var origin = new THREE.Vector3();
      var direction = new THREE.Vector3();
      cam.getWorldPosition(origin);
      cam.getWorldDirection(direction);
      this.raycaster.set(origin, direction);

      var hits = this.raycaster.intersectObject(this.hitboxMesh, false);

      // Notify roam component about gaze
      var roamComp = this.shellEl.components["sky-roam-animism"];
      if (roamComp) roamComp.setWatched(hits.length > 0, time);

      if (hits.length > 0) {
        // Aiming at object — cumulative progress (doesn't reset)
        this.timer += delta;

        var progress = this.timer / this.data.trackDuration;
        var elapsedSec = this.timer / 1000;
        var totalSec = this.data.trackDuration / 1000;

        ui.setTargeting(true);
        ui.updateProgress(Math.min(1, progress));
        ui.showTrackingText(Math.min(elapsedSec, totalSec), totalSec);

        if (this.timer >= this.data.trackDuration) {
          this.toggleModels();
        }
      } else {
        // Not aiming — slow decay (cumulative: timer doesn't fully reset)
        if (CONFIG.track.cumulative && this.timer > 0) {
          this.timer = Math.max(0, this.timer - delta * CONFIG.track.decayRate);
          var progress = this.timer / this.data.trackDuration;
          ui.updateProgress(progress);
          if (this.timer > 0) {
            ui.showTrackingText(this.timer / 1000, this.data.trackDuration / 1000);
          } else {
            ui.hideTrackingText();
          }
        }
        ui.setTargeting(false);
      }
    },

    setCoreEntity: function (entity) { this.coreEl = entity; },

    toggleModels: function () {
      var self = this;
      if (this.transitioning) return;

      this.transitioning = true;
      this.timer = 0;

      var roamComp = this.shellEl.components["sky-roam-animism"];
      if (roamComp) roamComp.stop();

      ui.setTargeting(false);
      ui.updateProgress(0);
      ui.hideTrackingText();
      ui.hideBehavior();

      var dur = CONFIG.dissolve.duration;

      if (this.showingFictional) {
        ui.showItemName(appState.realName || "Real Item");
        animateOpacity(this.coreMeshes, 1, 0, dur, function () {
          if (self.coreEl) self.coreEl.setAttribute("visible", false);
          animateOpacity(self.shellMeshes, 0, 1, dur, function () {
            self.showingFictional = false;
            appState.showingFictional = false;
            setTimeout(function () {
              if (roamComp) roamComp.resume();
              self.transitioning = false;
              self.toggleCount++;
              if (self.toggleCount >= 3) self.showBackButton();
            }, 3000);
          });
        });
      } else {
        animateOpacity(this.shellMeshes, 1, 0, dur, function () {
          if (!self.coreEl) return;
          self.coreEl.setAttribute("visible", true);
          if (0 === self.coreMeshes.length) {
            var coreMesh = self.coreEl.getObject3D("mesh");
            if (coreMesh) {
              coreMesh.traverse(function (child) {
                if (child.isMesh) {
                  child.material.transparent = true; child.material.opacity = 0;
                  child.visible = true; self.coreMeshes.push(child);
                }
              });
            }
          }
          animateOpacity(self.coreMeshes, 0, 1, dur, function () {
            self.showingFictional = true;
            appState.showingFictional = true;
            if (appState.itemName) ui.showItemName(appState.itemName);
            setTimeout(function () {
              if (roamComp) roamComp.resume();
              self.transitioning = false;
              self.toggleCount++;
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
      }
    }
  });

  // ═══════════════════════════════════
  //  PRE-AR OVERLAY
  // ═══════════════════════════════════
  var preArOverlay = {
    _safetyTimer: null, _dismissed: false,

    setStatus: function (text) { var el = document.getElementById("pre-ar-status"); if (el) el.textContent = text; },

    enableStart: function () {
      var btn = document.getElementById("enter-ar-button");
      if (btn) { btn.textContent = "Start AR"; btn.disabled = false; }
      this.setStatus("Model ready — tap to enter AR");
    },

    dismissOverlay: function () {
      if (this._dismissed) return;
      this._dismissed = true;
      if (this._safetyTimer) { clearTimeout(this._safetyTimer); this._safetyTimer = null; }
      var overlay = document.getElementById("pre-ar-overlay");
      if (overlay) overlay.classList.add("is-hidden");
    },

    bind: function (sceneEl) {
      var self = this;
      this._dismissed = false;
      var btn = document.getElementById("enter-ar-button");
      if (!btn) return;

      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        btn.disabled = true; btn.textContent = "Starting AR…";
        sceneEl.emit("runreality");
        if (self._safetyTimer) clearTimeout(self._safetyTimer);
        self._safetyTimer = setTimeout(function () { self.dismissOverlay(); }, 5000);
      });

      sceneEl.addEventListener("realityready", function () { self.dismissOverlay(); });
      sceneEl.addEventListener("realityerror", function () {
        if (self._safetyTimer) { clearTimeout(self._safetyTimer); self._safetyTimer = null; }
        self._dismissed = false;
        var el = document.getElementById("pre-ar-overlay");
        if (el) el.classList.remove("is-hidden");
        btn.textContent = "AR Failed — Retry"; btn.disabled = false;
        self.setStatus("AR failed to start.\nPlease check camera permissions.");
      });
    }
  };

  // ═══════════════════════════════════════════════
  //  COMPONENT: track-animism-interaction (main)
  // ═══════════════════════════════════════════════
  AFRAME.registerComponent("track-animism-interaction", {
    init: function () {
      console.log("🎮 Track AR Interaction initializing (animism mode)...");
      preArOverlay.bind(this.el);
      ui.init();

      var params = (function () {
        if (TEST_MODE.enabled) {
          return { realGlb: TEST_MODE.realGlb, fictionalGlb: TEST_MODE.fictionalGlb,
            interaction: "Track", itemName: TEST_MODE.itemName, realName: TEST_MODE.realName };
        }
        var urlParams = new URLSearchParams(window.location.search);
        return {
          realGlb: urlParams.get("real_glb"), fictionalGlb: urlParams.get("fictional_glb"),
          interaction: urlParams.get("interaction") || "Track",
          itemName: urlParams.get("item_name"), realName: urlParams.get("real_name") || "Real Item"
        };
      })();

      appState.realGlbUrl = params.realGlb;
      appState.fictionalGlbUrl = params.fictionalGlb;
      appState.itemName = params.itemName;
      appState.realName = params.realName;

      if (!appState.realGlbUrl) {
        console.error("❌ Missing required parameter: real_glb");
        return;
      }

      ui.showHint();
      this.loadModels();
    },

    loadModels: function () {
      var self = this;
      this.loadShellModel();
      if (appState.fictionalGlbUrl) {
        setTimeout(function () { self.loadCoreModel(); }, 100);
      }
    },

    loadShellModel: function () {
      var self = this;
      var shellEl = document.getElementById("shellEntity");
      if (!shellEl) return;

      shellEl.setAttribute("gltf-model", appState.realGlbUrl);
      shellEl.addEventListener("model-loaded", function () {
        appState.shellLoaded = true;
        var mesh = shellEl.getObject3D("mesh");
        if (mesh) fixMaterials(mesh);
        self.checkAllLoaded();
      }, { once: true });
      shellEl.addEventListener("model-error", function (evt) {
        console.error("❌ Shell model failed:", evt);
      }, { once: true });
    },

    loadCoreModel: function () {
      var self = this;
      var shellEl = document.getElementById("shellEntity");
      if (!shellEl) return;

      var coreEl = document.createElement("a-entity");
      coreEl.id = "coreEntity";
      coreEl.setAttribute("gltf-model", appState.fictionalGlbUrl);
      coreEl.setAttribute("position", "0 0 0");
      coreEl.setAttribute("scale", "1 1 1");
      coreEl.setAttribute("visible", false);
      coreEl.setAttribute("shadow", "cast: true; receive: false");

      coreEl.addEventListener("model-loaded", function () {
        appState.coreLoaded = true;
        var mesh = coreEl.getObject3D("mesh");
        if (mesh) {
          fixMaterials(mesh);
          mesh.traverse(function (child) {
            if (child.isMesh) { child.material.transparent = true; child.material.opacity = 0; child.visible = false; }
          });
        }
        var shellCoreComp = shellEl.components["sky-shell-core-animism"];
        if (shellCoreComp) shellCoreComp.setCoreEntity(coreEl);
        self.checkAllLoaded();
      }, { once: true });
      coreEl.addEventListener("model-error", function (evt) { console.error("❌ Core model failed:", evt); }, { once: true });

      shellEl.appendChild(coreEl);
    },

    checkAllLoaded: function () {
      var shellReady = appState.shellLoaded;
      var coreReady = !appState.fictionalGlbUrl || appState.coreLoaded;
      if (shellReady && coreReady) {
        console.log("✅ All models loaded - Ready for tracking (animism)");
        preArOverlay.enableStart();
      } else if (shellReady) {
        preArOverlay.enableStart();
      }
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    console.log("📱 DOM ready for Track AR Interaction (animism)");
  });
})();
