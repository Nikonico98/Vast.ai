(function () {
  "use strict";

  console.log("✅ BlowItem AR Interaction loaded");

  // ─── TEST MODE ───
  var TEST_MODE = {
    enabled: true,
    realGlb: "assets/realmodel.glb",
    fictionalGlb: "assets/fictionalmodel.glb",
    itemName: "Test Fictional Item",
    realName: "Test Real Item"
  };

  // ─── MERGE CONFIG ───
  var cfg = (function () {
    var defaults = {
      blow: {
        fftSize: 512,
        lowFreqBins: 6,
        threshold: 0.06,
        smoothing: 0.3,
        calibrationTime: 2000,
        decayRate: 0.15,
        // 3DS-style wind detection defaults
        lowFreqRatioMin: 0.03,
        spectralFlatnessMin: 0.02,
        energyStabilityMax: 0.85
      },
      rolling: {
        maxRotationSpeed: 540,
        maxTranslateSpeed: 6.0,
        friction: 0.92,
        rollOutDistance: 3.0,
        rollInStartZ: 3.0,
        rollInDuration: 800
      },
      progress: {
        target: 100,
        blowMultiplier: 12.0,
        decayRate: 0.02,
        checkpoints: [33, 66, 100],
        messages: ["Keep blowing!", "Almost there!", null]
      },
      bounce: {
        initialHeight: 0.3,
        damping: 0.4,
        bounceDuration: 350,
        bounceCount: 3,
        squashStretch: [
          { squashY: 0.7, stretchY: 1.25, squashXZ: 1.2, stretchXZ: 0.85 },
          { squashY: 0.8, stretchY: 1.15, squashXZ: 1.15, stretchXZ: 0.9 },
          { squashY: 0.88, stretchY: 1.08, squashXZ: 1.08, stretchXZ: 0.95 }
        ]
      },
      animation: {
        transitionDuration: 400,
        swapPause: 300
      },
      particles: {
        maxCount: 15,
        spawnRate: 3,
        minSize: 4,
        maxSize: 12,
        minSpeed: 2,
        maxSpeed: 8
      }
    };
    var ext = window.BLOW_CONFIG;
    if (!ext || typeof ext !== "object") return defaults;
    var merged = {};
    Object.keys(defaults).forEach(function (k) {
      if (defaults[k] && typeof defaults[k] === "object" && !Array.isArray(defaults[k]) &&
          ext[k] && typeof ext[k] === "object" && !Array.isArray(ext[k])) {
        merged[k] = Object.assign({}, defaults[k], ext[k]);
      } else {
        merged[k] = k in ext ? ext[k] : defaults[k];
      }
    });
    console.log("⚙️ BLOW_CONFIG merged from ar-config.js", merged);
    return merged;
  })();

  // ─── STATE ───
  var state = {
    realModel: null,
    fictionalModel: null,
    positionHolder: null,
    modelHolder: null,
    realGlbUrl: null,
    fictionalGlbUrl: null,
    itemName: null,
    realName: null,
    showingFictional: false,
    toggleCount: 0,
    progress: 0,
    currentCheckpoint: 0,
    isBouncing: false,
    isSwapping: false,
    baseModelY: 0,
    // Blow detection
    audioContext: null,
    analyser: null,
    micStream: null,
    freqData: null,
    floatFreqData: null,
    timeData: null,
    blowIntensity: 0,
    smoothedIntensity: 0,
    noiseFloor: 0,
    isCalibrating: false,
    calibrationSamples: [],
    micReady: false,
    // Rolling
    rollVelocity: 0,
    totalRotationX: 0,
    originZ: -2,
    totalDistance: 0
  };

  // ─── BLOW DETECTION (3DS-style) ───
  // Nintendo 3DS approach: detect sustained, loud, low-frequency broadband noise.
  // Three checks run every frame:
  //   1. Low-frequency energy ratio — wind energy is concentrated below ~500Hz
  //   2. Spectral flatness — wind is broadband noise (flat spectrum ≈ 1),
  //      speech has harmonic peaks (low flatness)
  //   3. Energy stability — wind amplitude is steady across frames,
  //      speech fluctuates with syllable rhythm
  var blowDetector = {
    // Ring buffer for energy stability (stores recent per-frame RMS values)
    _energyHistory: [],
    _energyHistorySize: 12, // ~200ms at 60fps

    init: function (onReady) {
      console.log("🎤 Initializing microphone (3DS-style blow detection)...");
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
        .then(function (stream) {
          state.micStream = stream;
          state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
          var source = state.audioContext.createMediaStreamSource(stream);

          // AnalyserNode — higher FFT for better frequency resolution
          state.analyser = state.audioContext.createAnalyser();
          state.analyser.fftSize = cfg.blow.fftSize;
          state.analyser.smoothingTimeConstant = 0.3;
          state.analyser.minDecibels = -90;
          state.analyser.maxDecibels = -10;
          source.connect(state.analyser);

          var binCount = state.analyser.frequencyBinCount;
          state.floatFreqData = new Float32Array(binCount);
          state.freqData = new Uint8Array(binCount);
          state.timeData = new Float32Array(cfg.blow.fftSize);

          // Calculate Hz per bin for logging
          var hzPerBin = state.audioContext.sampleRate / cfg.blow.fftSize;
          console.log("🎤 Mic ready. bins:", binCount, "hzPerBin:", hzPerBin.toFixed(1),
            "lowFreqCutoff:", (cfg.blow.lowFreqBins * hzPerBin).toFixed(0) + "Hz");

          blowDetector.calibrate(onReady);
        })
        .catch(function (err) {
          console.error("❌ Microphone access denied:", err);
          ui.setStatus("Microphone access denied. Please allow microphone.");
        });
    },

    calibrate: function (onReady) {
      state.isCalibrating = true;
      state.calibrationSamples = [];
      var startTime = performance.now();

      function sample() {
        if (performance.now() - startTime > cfg.blow.calibrationTime) {
          if (state.calibrationSamples.length > 0) {
            var sum = 0;
            for (var i = 0; i < state.calibrationSamples.length; i++) sum += state.calibrationSamples[i];
            state.noiseFloor = sum / state.calibrationSamples.length;
            // Set threshold just above noise floor
            var dynamicThreshold = state.noiseFloor + 0.02;
            if (dynamicThreshold > cfg.blow.threshold) {
              cfg.blow.threshold = dynamicThreshold;
            }
          }
          state.isCalibrating = false;
          state.micReady = true;
          console.log("🎤 Calibration done. Noise floor:", state.noiseFloor.toFixed(4),
            "Threshold:", cfg.blow.threshold.toFixed(4));
          if (onReady) onReady();
          return;
        }
        state.analyser.getByteFrequencyData(state.freqData);
        var raw = blowDetector.computeRawIntensity();
        state.calibrationSamples.push(raw);
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    },

    // Raw low-frequency intensity (0-1)
    computeRawIntensity: function () {
      var sum = 0;
      var bins = Math.min(cfg.blow.lowFreqBins, state.freqData.length);
      for (var i = 0; i < bins; i++) {
        sum += state.freqData[i];
      }
      return sum / (bins * 255);
    },

    // ── CHECK 1: Low-frequency energy ratio ──
    // Wind: >45% of total energy lives in the lowest bins (< ~500Hz)
    // Speech: energy spreads into mid/high frequencies (formants 300-3kHz)
    checkLowFreqRatio: function () {
      var binCount = state.freqData.length;
      var lowBins = cfg.blow.lowFreqBins;
      var lowSum = 0, totalSum = 0;
      for (var i = 0; i < binCount; i++) {
        var val = state.freqData[i];
        totalSum += val;
        if (i < lowBins) lowSum += val;
      }
      if (totalSum < 1) return false; // silence
      var ratio = lowSum / totalSum;
      this._debugLowFreqRatio = ratio;
      return ratio >= cfg.blow.lowFreqRatioMin;
    },

    // ── CHECK 2: Spectral flatness (Wiener entropy) ──
    checkSpectralFlatness: function () {
      state.analyser.getFloatFrequencyData(state.floatFreqData);
      var binCount = state.floatFreqData.length;
      var start = 1;
      var end = Math.min(binCount, 64);
      var n = end - start;
      if (n <= 0) return false;

      var logSum = 0;
      var linSum = 0;
      for (var i = start; i < end; i++) {
        var power = Math.pow(10, state.floatFreqData[i] / 10);
        if (power < 1e-12) power = 1e-12;
        logSum += Math.log(power);
        linSum += power;
      }
      var geoMean = Math.exp(logSum / n);
      var ariMean = linSum / n;
      if (ariMean < 1e-12) return false;
      var flatness = geoMean / ariMean;
      this._debugFlatness = flatness;
      return flatness >= cfg.blow.spectralFlatnessMin;
    },

    // ── CHECK 3: Energy stability ──
    checkEnergyStability: function () {
      state.analyser.getFloatTimeDomainData(state.timeData);
      var len = state.timeData.length;
      var energy = 0;
      for (var i = 0; i < len; i++) {
        energy += state.timeData[i] * state.timeData[i];
      }
      var rms = Math.sqrt(energy / len);

      this._energyHistory.push(rms);
      if (this._energyHistory.length > this._energyHistorySize) {
        this._energyHistory.shift();
      }
      if (this._energyHistory.length < 6) return true;

      var sum = 0, count = this._energyHistory.length;
      for (var j = 0; j < count; j++) sum += this._energyHistory[j];
      var mean = sum / count;
      if (mean < 0.005) { this._debugCV = -1; return false; }
      var variance = 0;
      for (var k = 0; k < count; k++) {
        var d = this._energyHistory[k] - mean;
        variance += d * d;
      }
      var stddev = Math.sqrt(variance / count);
      var cv = stddev / mean;
      this._debugCV = cv;
      return cv <= cfg.blow.energyStabilityMax;
    },

    // Debug counter to throttle logging
    _debugCounter: 0,
    _debugLowFreqRatio: 0,
    _debugFlatness: 0,
    _debugCV: 0,

    update: function () {
      if (!state.micReady || !state.analyser) return 0;
      state.analyser.getByteFrequencyData(state.freqData);
      var raw = blowDetector.computeRawIntensity();

      // Subtract noise floor
      var adjusted = Math.max(0, raw - state.noiseFloor);
      var normalized = Math.min(1, adjusted / (1 - state.noiseFloor + 0.001));

      // Apply amplitude threshold
      if (normalized < cfg.blow.threshold) normalized = 0;

      // 3DS-style triple validation: all three must pass
      if (normalized > 0) {
        var lowFreqOk = blowDetector.checkLowFreqRatio();
        var flatnessOk = blowDetector.checkSpectralFlatness();
        var stabilityOk = blowDetector.checkEnergyStability();
        if (!lowFreqOk || !flatnessOk || !stabilityOk) {
          normalized = 0;
        }
      } else {
        // Still update energy history even when quiet (for stability tracking)
        state.analyser.getFloatTimeDomainData(state.timeData);
        var len = state.timeData.length;
        var e = 0;
        for (var i = 0; i < len; i++) e += state.timeData[i] * state.timeData[i];
        this._energyHistory.push(Math.sqrt(e / len));
        if (this._energyHistory.length > this._energyHistorySize) this._energyHistory.shift();
      }

      // Exponential smoothing
      state.smoothedIntensity = cfg.blow.smoothing * normalized +
        (1 - cfg.blow.smoothing) * state.smoothedIntensity;

      state.blowIntensity = state.smoothedIntensity;
      return state.blowIntensity;
    }
  };

  // ─── UI HELPERS ───
  var ui = {
    elements: {},

    init: function () {
      this.elements = {
        hint: document.getElementById("ar-hint"),
        progressContainer: document.getElementById("blow-progress-container"),
        progressBar: document.getElementById("blow-progress-bar"),
        blowMeter: document.getElementById("blow-meter"),
        blowMeterFill: document.getElementById("blow-meter-fill"),
        blowMeterIcon: document.getElementById("blow-meter-icon"),
        blowPrompt: document.getElementById("blow-prompt"),
        toggleCount: document.getElementById("toggle-count"),
        itemName: document.getElementById("item-name-display"),
        status: document.getElementById("ar-status"),
        statusText: document.getElementById("status-text")
      };
      console.log("🎨 UI initialized");
    },

    setStatus: function (text) {
      var el = document.getElementById("pre-ar-status");
      if (el) el.textContent = text;
    },

    showUI: function () {
      var els = ["hint", "progressContainer", "blowMeter", "blowPrompt", "toggleCount"];
      for (var i = 0; i < els.length; i++) {
        var el = this.elements[els[i]];
        if (el) el.classList.remove("ar-ui-hidden");
      }
    },

    updateBlowMeter: function (intensity) {
      var fill = this.elements.blowMeterFill;
      var icon = this.elements.blowMeterIcon;
      if (fill) {
        if (intensity > 0.01) {
          fill.style.opacity = "1";
          // Color intensity: white → cyan → bright cyan
          var r = Math.round(255 - intensity * 178);
          var g = Math.round(255 - intensity * 47);
          var b = Math.round(255 - intensity * 30);
          fill.style.borderColor = "rgba(" + r + "," + g + "," + b + ", " + (0.4 + intensity * 0.6) + ")";
        } else {
          fill.style.opacity = "0";
        }
      }
      if (icon) {
        if (intensity > 0.05) {
          icon.classList.add("active");
        } else {
          icon.classList.remove("active");
        }
      }
    },

    updateProgress: function (progress) {
      var bar = this.elements.progressBar;
      if (bar) {
        bar.style.width = Math.min(100, progress) + "%";
      }
    },

    updateToggleCount: function (count) {
      var el = this.elements.toggleCount;
      if (el) {
        el.textContent = count + " / 3";
        el.classList.add("visible");
        el.classList.remove("pop");
        el.offsetWidth; // force reflow
        el.classList.add("pop");
      }
    },

    showItemName: function (name) {
      var el = this.elements.itemName;
      if (el) {
        el.textContent = "✨ " + name;
        el.classList.add("visible");
      }
    },

    flashCheckpoint: function () {
      var bar = this.elements.progressBar;
      if (bar) {
        bar.classList.add("checkpoint-flash");
        setTimeout(function () {
          bar.classList.remove("checkpoint-flash");
        }, 600);
      }
    },

    showCheckpointMessage: function (msg) {
      if (!msg) return;
      var el = document.getElementById("checkpoint-message");
      if (!el) {
        el = document.createElement("div");
        el.id = "checkpoint-message";
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.classList.remove("show");
      el.offsetWidth;
      el.classList.add("show");
      setTimeout(function () { el.classList.remove("show"); }, 2000);
    },


  };

  // ─── WIND PARTICLES ───
  var windParticles = {
    active: [],
    container: null,

    init: function () {
      this.container = document.getElementById("wind-particle-container");
    },

    spawn: function (intensity) {
      if (!this.container || this.active.length >= cfg.particles.maxCount) return;
      var count = Math.ceil(intensity * cfg.particles.spawnRate);
      for (var i = 0; i < count; i++) {
        if (this.active.length >= cfg.particles.maxCount) break;
        var p = document.createElement("div");
        p.className = "wind-particle";
        var size = cfg.particles.minSize + Math.random() * (cfg.particles.maxSize - cfg.particles.minSize);
        var duration = 1 + (1 - intensity) * 1.5;
        var delay = Math.random() * 0.3;
        p.style.width = size + "px";
        p.style.height = size + "px";
        p.style.left = (10 + Math.random() * 80) + "%";
        p.style.setProperty("--wind-duration", duration + "s");
        p.style.setProperty("--wind-delay", delay + "s");
        this.container.appendChild(p);
        this.active.push(p);
        var self = this;
        (function (particle) {
          setTimeout(function () {
            if (particle.parentNode) particle.parentNode.removeChild(particle);
            var idx = self.active.indexOf(particle);
            if (idx !== -1) self.active.splice(idx, 1);
          }, (duration + delay) * 1000 + 200);
        })(p);
      }
    }
  };



  // ─── MODEL HELPERS ───
  function setModelOpacity(entity, opacity) {
    if (!entity || !entity.object3D) return;
    entity.object3D.traverse(function (child) {
      if (child.isMesh && child.material) {
        var mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(function (mat) {
          if (mat) {
            mat.transparent = true;
            mat.opacity = opacity;
            mat.depthWrite = opacity > 0.95;
            mat.depthTest = true;
            child.renderOrder = Math.floor(opacity * 100);
            mat.needsUpdate = true;
          }
        });
      }
    });
    entity.object3D.visible = opacity > 0.01;
  }

  function setModelVisible(entity, visible) {
    if (entity) entity.setAttribute("visible", visible);
  }

  // ─── BOUNCE ANIMATION (from rotate) ───
  function bounceModel(triggerSwap, onComplete) {
    state.isBouncing = true;
    var b = cfg.bounce;
    var holder = document.getElementById("model-holder");
    if (!holder) { if (onComplete) onComplete(); return; }
    var pos = holder.getAttribute("position") || { x: 0, y: 0, z: 0 };
    state.baseModelY = pos.y;
    var bounceIdx = 0;

    function doBounce() {
      if (bounceIdx >= b.bounceCount) {
        holder.setAttribute("scale", "1 1 1");
        if (onComplete) onComplete();
        return;
      }
      var height = b.initialHeight * Math.pow(b.damping, bounceIdx);
      var ss = b.squashStretch[bounceIdx] || b.squashStretch[b.squashStretch.length - 1];
      var dur = b.bounceDuration;
      var isLastBounce = triggerSwap && bounceIdx === b.bounceCount - 1;
      var startTime = performance.now();
      var switchDone = false;

      function animate(now) {
        var elapsed = now - startTime;
        var t = Math.min(1, elapsed / dur);
        var y, sy, sxz;

        if (t < 0.5) {
          var up = t / 0.5;
          var ease = 1 - (1 - up) * (1 - up);
          y = state.baseModelY + height * ease;
          var sinVal = Math.sin(up * Math.PI);
          sy = 1 + (ss.stretchY - 1) * sinVal;
          sxz = 1 + (ss.stretchXZ - 1) * sinVal;
        } else {
          var down = (t - 0.5) / 0.5;
          var easeDown = down * down;
          y = state.baseModelY + height * (1 - easeDown);
          if (isLastBounce && down > 0.95 && !switchDone) {
            switchDone = true;
            doModelSwap();
          }
          if (down > 0.85) {
            var k = (down - 0.85) / 0.15;
            sy = 1 + (ss.squashY - 1) * k;
            sxz = 1 + (ss.squashXZ - 1) * k;
          } else {
            sy = 1; sxz = 1;
          }
        }

        var currentPos = holder.getAttribute("position");
        holder.setAttribute("position", { x: currentPos.x, y: y, z: currentPos.z });
        var activeModel = state.showingFictional ? state.fictionalModel : state.realModel;
        if (activeModel) {
          activeModel.setAttribute("scale", (0.5 * sxz) + " " + (0.5 * sy) + " " + (0.5 * sxz));
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          if (isLastBounce && !switchDone) {
            switchDone = true;
            doModelSwap();
          }
          holder.setAttribute("position", { x: currentPos.x, y: state.baseModelY, z: currentPos.z });
          // Settle squash
          settleSquash(activeModel, ss, function () {
            bounceIdx++;
            doBounce();
          });
        }
      }
      requestAnimationFrame(animate);
    }
    doBounce();
  }

  function settleSquash(model, ss, onDone) {
    var start = performance.now();
    var scale = 0.5;
    requestAnimationFrame(function frame(now) {
      var t = Math.min(1, (now - start) / 150);
      var ease = 1 - (1 - t) * (1 - t);
      var sy = scale * (ss.squashY + (1 - ss.squashY) * ease);
      var sxz = scale * (ss.squashXZ + (1 - ss.squashXZ) * ease);
      if (model) model.setAttribute("scale", sxz + " " + sy + " " + sxz);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        if (model) model.setAttribute("scale", scale + " " + scale + " " + scale);
        if (onDone) onDone();
      }
    });
  }

  // ─── MODEL SWAP ───
  function doModelSwap() {
    if (state.showingFictional) {
      setModelOpacity(state.fictionalModel, 0);
      setModelVisible(state.fictionalModel, false);
      setModelOpacity(state.realModel, 1);
      setModelVisible(state.realModel, true);
      state.showingFictional = false;
      ui.showItemName(state.realName || "Real Item");
      console.log("🔄 Switched to Real");
    } else {
      setModelOpacity(state.realModel, 0);
      setModelVisible(state.realModel, false);
      setModelOpacity(state.fictionalModel, 1);
      setModelVisible(state.fictionalModel, true);
      state.showingFictional = true;
      ui.showItemName(state.itemName || "Fictional Item");
      console.log("🔄 Switched to Fictional");
    }
    state.toggleCount++;
    ui.updateToggleCount(state.toggleCount);
    console.log("🔄 Toggle #" + state.toggleCount);

    if (state.toggleCount >= 3) {
      var btn = document.getElementById("back-to-main");
      if (btn && !btn.classList.contains("visible")) {
        btn.classList.add("visible");
        console.log("🏠 Back button shown after", state.toggleCount, "toggles");
      }
    }
  }

  // ─── ROLL MODEL BACK TO ORIGIN ───
  function rollModelBack(onComplete) {
    var posHolder = document.getElementById("position-holder");
    var modelHolder = document.getElementById("model-holder");
    if (!posHolder) { if (onComplete) onComplete(); return; }

    var pos = posHolder.getAttribute("position");
    var startZ = pos.z;
    var targetZ = state.originZ;
    var startTime = performance.now();
    var duration = cfg.rolling.rollInDuration;
    var startRotation = state.totalRotationX;
    var rollBackRotation = Math.abs(startZ - targetZ) / cfg.rolling.rollOutDistance * 360;

    function animate(now) {
      var t = Math.min(1, (now - startTime) / duration);
      var ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      var z = startZ + (targetZ - startZ) * ease;

      state.totalRotationX = startRotation + rollBackRotation * ease;

      var currentPos = posHolder.getAttribute("position");
      posHolder.setAttribute("position", { x: currentPos.x, y: currentPos.y, z: z });

      if (modelHolder) {
        var rot = modelHolder.getAttribute("rotation") || { x: 0, y: 0, z: 0 };
        modelHolder.setAttribute("rotation", { x: state.totalRotationX, y: rot.y, z: rot.z });
      }

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        posHolder.setAttribute("position", { x: currentPos.x, y: currentPos.y, z: targetZ });
        if (onComplete) onComplete();
      }
    }
    requestAnimationFrame(animate);
  }

  // ─── CHECKPOINT HANDLER ───
  function onCheckpoint(checkIdx) {
    console.log("🎯 Checkpoint " + (checkIdx + 1) + "/3 reached!");

    // Checkpoint message
    var msg = cfg.progress.messages[checkIdx];
    if (msg) ui.showCheckpointMessage(msg);

    // Flash progress bar
    ui.flashCheckpoint();

    // Vibrate (Android)
    if (navigator.vibrate) navigator.vibrate(50);

    var isFullProgress = checkIdx === cfg.progress.checkpoints.length - 1;

    // At final checkpoint: swap model in place, reset progress for next cycle
    if (isFullProgress) {
      doModelSwap();
      // Reset rotation so swapped model appears upright
      state.totalRotationX = 0;
      var holder = document.getElementById("model-holder");
      if (holder) {
        holder.setAttribute("rotation", { x: 0, y: 0, z: 0 });
      }
      // Reset progress and distance for next cycle
      state.progress = 0;
      state.totalDistance = 0;
      state.currentCheckpoint = 0;
      ui.updateProgress(0);
    }

    // Stop all motion
    state.isBouncing = false;
    state.isSwapping = false;
    state.rollVelocity = 0;
    console.log("⏭️ Checkpoint done. Toggle count:", state.toggleCount);
  }

  // ─── MAIN GAME LOOP ───
  function gameLoop() {
    if (state.isBouncing || state.isSwapping) {
      requestAnimationFrame(gameLoop);
      return;
    }

    var intensity = blowDetector.update();

    // Update UI
    ui.updateBlowMeter(intensity);

    // Wind particles
    if (intensity > 0.05) {
      windParticles.spawn(intensity);
    }

    var maxRotPerFrame = cfg.rolling.maxRotationSpeed / 60;

    // Rolling physics: accumulate velocity when blowing, friction when not
    if (intensity > 0) {
      // Accelerate
      state.rollVelocity += intensity * maxRotPerFrame * 0.5;
      if (state.rollVelocity > maxRotPerFrame) {
        state.rollVelocity = maxRotPerFrame;
      }
    } else {
      // Coast with friction (inertia)
      state.rollVelocity *= cfg.rolling.friction;
      if (state.rollVelocity < 0.01) state.rollVelocity = 0;
    }

    // Apply rotation continuously (smooth animation)
    if (state.rollVelocity > 0) {
      state.totalRotationX -= state.rollVelocity;
    }
    var holder = document.getElementById("model-holder");
    if (holder) {
      holder.setAttribute("rotation", { x: state.totalRotationX, y: 0, z: 0 });
    }

    // Translate model away from camera (only forward, never backward)
    var posHolder = document.getElementById("position-holder");
    if (posHolder && state.rollVelocity > 0) {
      var translateSpeed = (state.rollVelocity / maxRotPerFrame) * cfg.rolling.maxTranslateSpeed / 60;
      var pos = posHolder.getAttribute("position");
      posHolder.setAttribute("position", { x: pos.x, y: pos.y, z: pos.z - translateSpeed });
      // Accumulate total distance for progress
      state.totalDistance += translateSpeed;
    }

    // Progress derived from cumulative distance (never decreases within a cycle)
    var newProgress = Math.min(cfg.progress.target, (state.totalDistance / cfg.rolling.rollOutDistance) * cfg.progress.target);
    if (newProgress > state.progress) {
      state.progress = newProgress;
    }
    ui.updateProgress(state.progress);

    // Check checkpoints
    if (state.currentCheckpoint < cfg.progress.checkpoints.length) {
      var threshold = cfg.progress.checkpoints[state.currentCheckpoint];
      if (state.progress >= threshold) {
        state.isSwapping = true;
        var cpIdx = state.currentCheckpoint;
        state.currentCheckpoint++;
        onCheckpoint(cpIdx);
      }
    }

    requestAnimationFrame(gameLoop);
  }

  // ─── PRE-AR OVERLAY ───
  var overlay = {
    _safetyTimer: null,
    _dismissed: false,

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
      var el = document.getElementById("pre-ar-overlay");
      if (el) el.classList.add("is-hidden");

      // Show UI
      ui.showUI();

      // Start microphone + game loop
      blowDetector.init(function () {
        console.log("🎮 Starting game loop");
        requestAnimationFrame(gameLoop);
      });
    },

    bind: function (sceneEl) {
      var self = this;
      var btn = document.getElementById("enter-ar-button");
      if (btn) {
        btn.addEventListener("click", function () {
          if (btn.disabled) return;
          btn.disabled = true;
          btn.textContent = "Starting AR…";
          sceneEl.emit("runreality");
          self._safetyTimer = setTimeout(function () { self.dismissOverlay(); }, 5000);
        });
      }
      sceneEl.addEventListener("realityready", function () {
        self.dismissOverlay();
      });
      sceneEl.addEventListener("realityerror", function () {
        if (self._safetyTimer) {
          clearTimeout(self._safetyTimer);
          self._safetyTimer = null;
        }
        self._dismissed = false;
        var el = document.getElementById("pre-ar-overlay");
        if (el) el.classList.remove("is-hidden");
        if (btn) {
          btn.textContent = "AR Failed — Retry";
          btn.disabled = false;
        }
        self.setStatus("AR failed to start.\nPlease check camera permissions.");
      });
    }
  };

  // ─── SINGLE FINGER DRAG (move model position) ───
  function setupDrag() {
    var sceneEl = document.querySelector("a-scene");
    var posHolder = document.getElementById("position-holder");
    if (!sceneEl || !posHolder) return;
    var drag = { isActive: false, startX: 0, startY: 0, startMX: 0, startMZ: 0 };

    sceneEl.addEventListener("touchstart", function (e) {
      if (e.touches.length === 1 && !state.isBouncing) {
        var t = e.touches[0];
        var pos = posHolder.getAttribute("position");
        drag.isActive = true;
        drag.startX = t.clientX;
        drag.startY = t.clientY;
        drag.startMX = pos.x;
        drag.startMZ = pos.z;
      }
    });

    sceneEl.addEventListener("touchmove", function (e) {
      if (drag.isActive && e.touches.length === 1 && !state.isBouncing) {
        var t = e.touches[0];
        var dx = 0.005 * (t.clientX - drag.startX);
        var dz = 0.005 * (t.clientY - drag.startY);
        var pos = posHolder.getAttribute("position");
        posHolder.setAttribute("position", { x: drag.startMX + dx, y: pos.y, z: drag.startMZ + dz });
      }
    });

    sceneEl.addEventListener("touchend", function () {
      drag.isActive = false;
    });
  }

  // ─── A-FRAME COMPONENT ───
  AFRAME.registerComponent("blow-ar-interaction", {
    init: function () {
      var self = this;
      console.log("🎮 BlowItem AR Interaction initializing...");

      overlay.bind(this.el);
      ui.init();
      windParticles.init();
      ui.setStatus("Loading models...");

      // Parse parameters
      var params = (function () {
        if (TEST_MODE.enabled) {
          console.log("🧪 TEST MODE: Using local assets");
          return {
            realGlb: TEST_MODE.realGlb,
            fictionalGlb: TEST_MODE.fictionalGlb,
            itemName: TEST_MODE.itemName,
            realName: TEST_MODE.realName
          };
        }
        var p = new URLSearchParams(window.location.search);
        return {
          realGlb: p.get("real_glb"),
          fictionalGlb: p.get("fictional_glb"),
          itemName: p.get("item_name") || "Fictional Item",
          realName: p.get("real_name") || "Real Item"
        };
      })();

      if (!params.realGlb || !params.fictionalGlb) {
        console.error("❌ Missing model URL parameters");
        ui.setStatus("Error: No model URLs provided");
        return;
      }

      state.realGlbUrl = params.realGlb;
      state.fictionalGlbUrl = params.fictionalGlb;
      state.itemName = params.itemName;
      state.realName = params.realName;

      this.el.addEventListener("loaded", function () {
        console.log("📦 Scene loaded");
        state.progress = 0;
        state.currentCheckpoint = 0;
        state.showingFictional = false;
        state.toggleCount = 0;
        ui.updateToggleCount(0);
        self.loadModels();
        setupDrag();
      });
    },

    loadModels: function () {
      state.realModel = document.getElementById("realModel");
      state.fictionalModel = document.getElementById("fictionalModel");
      state.positionHolder = document.getElementById("position-holder");
      state.modelHolder = document.getElementById("model-holder");

      if (!state.realModel || !state.fictionalModel) {
        console.error("❌ Model entities not found!");
        return;
      }

      console.log("📦 Loading Real model:", state.realGlbUrl.substring(0, 60));
      console.log("📦 Loading Fictional model:", state.fictionalGlbUrl.substring(0, 60));

      state.realModel.setAttribute("gltf-model", state.realGlbUrl);
      state.fictionalModel.setAttribute("gltf-model", state.fictionalGlbUrl);

      state.realModel.addEventListener("model-loaded", function () {
        console.log("✅ Real model loaded");
        setModelOpacity(state.realModel, 1);
        setModelVisible(state.realModel, true);
        ui.setStatus("Blow on the mic to start! 🌬️");
        overlay.enableStart();
      });

      state.fictionalModel.addEventListener("model-loaded", function () {
        console.log("✅ Fictional model loaded");
        setModelVisible(state.fictionalModel, false);
        setModelOpacity(state.fictionalModel, 0);
      });

      state.realModel.addEventListener("model-error", function (e) {
        console.error("❌ Real model load error:", e);
        ui.setStatus("Error loading real model");
      });

      state.fictionalModel.addEventListener("model-error", function (e) {
        console.error("❌ Fictional model load error:", e);
        ui.setStatus("Error loading fictional model");
      });
    }
  });

})();
