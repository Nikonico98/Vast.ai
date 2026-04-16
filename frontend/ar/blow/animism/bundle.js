(function () {
  "use strict";

  console.log("✅ BlowItem AR Interaction loaded (animism mode)");

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
        fftSize: 512, lowFreqBins: 6, threshold: 0.06, smoothing: 0.3,
        calibrationTime: 2000, lowFreqRatioMin: 0.03, spectralFlatnessMin: 0.02, energyStabilityMax: 0.85
      },
      progress: {
        rateMultiplier: 0.15, decayRate: 0.04,
        zones: {
          normal:    { max: 0.5, fillMult: 1.0, decayMult: 1.0 },
          resisting: { max: 0.7, fillMult: 0.6, decayMult: 1.8 },
          breaking:  { max: 1.0, fillMult: 2.0, decayMult: 0.3 }
        }
      },
      animation: {
        tremor:    { yRotDeg: 1.5, zRotDeg: 1.0, period: 300, squashY: 0.98, stretchY: 1.02 },
        tickle:    { zRotDeg: 6, period: 220, squashY: 0.93, stretchY: 1.08, bounceY: 0.04 },
        resist:    { zRotDeg: 10, period: 160, squashY: 0.87, stretchY: 1.15, jitter: 0.015, bounceY: 0.07 },
        breaking:  { zRotDeg: 14, period: 120, squashY: 0.83, stretchY: 1.22, jitter: 0.025, bounceY: 0.1 },
        collapse:  { zRotDeg: 18, period: 80, squashY: 0.8, stretchY: 1.25, jitter: 0.035, bounceY: 0.13 },
        transform: { fallDuration: 800, fallAngleDeg: 90, shrinkDuration: 200, popDuration: 400, popOvershoot: 1.15 }
      },
      particles: { maxCount: 15, spawnRate: 3, minSize: 4, maxSize: 12, minSpeed: 2, maxSpeed: 8 }
    };
    var ext = window.BLOW_ANIMISM_CONFIG;
    if (!ext || typeof ext !== "object") return defaults;
    // Simple two-level merge
    var merged = {};
    Object.keys(defaults).forEach(function (k) {
      if (defaults[k] && typeof defaults[k] === "object" && !Array.isArray(defaults[k]) &&
          ext[k] && typeof ext[k] === "object" && !Array.isArray(ext[k])) {
        var sub = {};
        Object.keys(defaults[k]).forEach(function (sk) {
          if (defaults[k][sk] && typeof defaults[k][sk] === "object" && !Array.isArray(defaults[k][sk]) &&
              ext[k][sk] && typeof ext[k][sk] === "object" && !Array.isArray(ext[k][sk])) {
            sub[sk] = Object.assign({}, defaults[k][sk], ext[k][sk]);
          } else {
            sub[sk] = sk in (ext[k] || {}) ? ext[k][sk] : defaults[k][sk];
          }
        });
        merged[k] = sub;
      } else {
        merged[k] = k in ext ? ext[k] : defaults[k];
      }
    });
    console.log("⚙️ BLOW_ANIMISM_CONFIG merged", merged);
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
    // Animism progress (0 to 1)
    progress: 0,
    isTransforming: false,
    lastFrameTime: 0
  };

  // ─── BLOW DETECTION (reused from materialism) ───
  var blowDetector = {
    _energyHistory: [],
    _energyHistorySize: 12,

    init: function (onReady) {
      console.log("🎤 Initializing microphone (animism blow detection)...");
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      })
        .then(function (stream) {
          state.micStream = stream;
          state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
          var source = state.audioContext.createMediaStreamSource(stream);
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
            var dynamicThreshold = state.noiseFloor + 0.02;
            if (dynamicThreshold > cfg.blow.threshold) cfg.blow.threshold = dynamicThreshold;
          }
          state.isCalibrating = false;
          state.micReady = true;
          console.log("🎤 Calibration done. Noise floor:", state.noiseFloor.toFixed(4));
          if (onReady) onReady();
          return;
        }
        state.analyser.getByteFrequencyData(state.freqData);
        state.calibrationSamples.push(blowDetector.computeRawIntensity());
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    },

    computeRawIntensity: function () {
      var sum = 0;
      var bins = Math.min(cfg.blow.lowFreqBins, state.freqData.length);
      for (var i = 0; i < bins; i++) sum += state.freqData[i];
      return sum / (bins * 255);
    },

    checkLowFreqRatio: function () {
      var binCount = state.freqData.length;
      var lowBins = cfg.blow.lowFreqBins;
      var lowSum = 0, totalSum = 0;
      for (var i = 0; i < binCount; i++) {
        totalSum += state.freqData[i];
        if (i < lowBins) lowSum += state.freqData[i];
      }
      return totalSum < 1 ? false : (lowSum / totalSum) >= cfg.blow.lowFreqRatioMin;
    },

    checkSpectralFlatness: function () {
      state.analyser.getFloatFrequencyData(state.floatFreqData);
      var start = 1, end = Math.min(state.floatFreqData.length, 64), n = end - start;
      if (n <= 0) return false;
      var logSum = 0, linSum = 0;
      for (var i = start; i < end; i++) {
        var power = Math.pow(10, state.floatFreqData[i] / 10);
        if (power < 1e-12) power = 1e-12;
        logSum += Math.log(power);
        linSum += power;
      }
      var ariMean = linSum / n;
      return ariMean < 1e-12 ? false : (Math.exp(logSum / n) / ariMean) >= cfg.blow.spectralFlatnessMin;
    },

    checkEnergyStability: function () {
      state.analyser.getFloatTimeDomainData(state.timeData);
      var len = state.timeData.length, energy = 0;
      for (var i = 0; i < len; i++) energy += state.timeData[i] * state.timeData[i];
      var rms = Math.sqrt(energy / len);
      this._energyHistory.push(rms);
      if (this._energyHistory.length > this._energyHistorySize) this._energyHistory.shift();
      if (this._energyHistory.length < 6) return true;
      var sum = 0, count = this._energyHistory.length;
      for (var j = 0; j < count; j++) sum += this._energyHistory[j];
      var mean = sum / count;
      if (mean < 0.005) return false;
      var variance = 0;
      for (var k = 0; k < count; k++) { var d = this._energyHistory[k] - mean; variance += d * d; }
      return (Math.sqrt(variance / count) / mean) <= cfg.blow.energyStabilityMax;
    },

    update: function () {
      if (!state.micReady || !state.analyser) return 0;
      state.analyser.getByteFrequencyData(state.freqData);
      var raw = this.computeRawIntensity();
      var adjusted = Math.max(0, raw - state.noiseFloor);
      var normalized = Math.min(1, adjusted / (1 - state.noiseFloor + 0.001));
      if (normalized < cfg.blow.threshold) normalized = 0;
      if (normalized > 0) {
        if (!this.checkLowFreqRatio() || !this.checkSpectralFlatness() || !this.checkEnergyStability()) {
          normalized = 0;
        }
      } else {
        state.analyser.getFloatTimeDomainData(state.timeData);
        var len = state.timeData.length, e = 0;
        for (var i = 0; i < len; i++) e += state.timeData[i] * state.timeData[i];
        this._energyHistory.push(Math.sqrt(e / len));
        if (this._energyHistory.length > this._energyHistorySize) this._energyHistory.shift();
      }
      state.smoothedIntensity = cfg.blow.smoothing * normalized + (1 - cfg.blow.smoothing) * state.smoothedIntensity;
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
        blowPrompt: document.getElementById("blow-prompt"),
        itemName: document.getElementById("item-name-display"),
        emotionBarContainer: document.getElementById("emotion-bar-container"),
        emotionBarFill: document.getElementById("emotion-bar-fill"),
        emotionBarLabel: document.getElementById("emotion-bar-label")
      };
    },

    setStatus: function (text) {
      var el = document.getElementById("pre-ar-status");
      if (el) el.textContent = text;
    },

    showUI: function () {
      var els = ["hint", "blowPrompt", "emotionBarContainer"];
      for (var i = 0; i < els.length; i++) {
        var el = this.elements[els[i]];
        if (el) el.classList.remove("ar-ui-hidden");
      }
    },

    updateEmotionBar: function (progress) {
      var fill = this.elements.emotionBarFill;
      var label = this.elements.emotionBarLabel;
      if (!fill) return;

      var pct = Math.min(100, Math.max(0, progress * 100));
      fill.style.width = pct + "%";

      // Gradient color by zone
      if (progress < 0.2) {
        fill.style.background = "linear-gradient(90deg, #6EC6B8, #7DD3C8)"; // calm teal
        if (label) label.textContent = "";
      } else if (progress < 0.5) {
        fill.style.background = "linear-gradient(90deg, #6EC6B8, #E8C547)"; // teal → warm yellow
        if (label) label.textContent = "";
      } else if (progress < 0.7) {
        fill.style.background = "linear-gradient(90deg, #E8C547, #E88D9D)"; // yellow → pink
        if (label) label.textContent = "It's resisting...";
      } else if (progress < 0.9) {
        fill.style.background = "linear-gradient(90deg, #E88D9D, #F0734A)"; // pink → hot orange
        if (label) label.textContent = "Almost there!";
      } else {
        fill.style.background = "linear-gradient(90deg, #F0734A, #FF4444)"; // hot orange → red
        if (label) label.textContent = "It can't hold on!";
      }
    },

    hideEmotionBar: function () {
      var c = this.elements.emotionBarContainer;
      if (c) c.classList.add("ar-ui-hidden");
    },

    showItemName: function (name) {
      var el = this.elements.itemName;
      if (el) {
        el.textContent = "✨ " + name;
        el.classList.add("visible");
        setTimeout(function () { el.classList.remove("visible"); }, 3000);
      }
    }
  };

  // ─── WIND PARTICLES ───
  var windParticles = {
    active: [],
    container: null,
    init: function () { this.container = document.getElementById("wind-particle-container"); },
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

  // ─── MODEL SWAP ───
  function doModelSwap() {
    if (state.showingFictional) {
      setModelOpacity(state.fictionalModel, 0);
      setModelVisible(state.fictionalModel, false);
      setModelOpacity(state.realModel, 1);
      setModelVisible(state.realModel, true);
      state.showingFictional = false;
      ui.showItemName(state.realName || "Real Item");
    } else {
      setModelOpacity(state.realModel, 0);
      setModelVisible(state.realModel, false);
      setModelOpacity(state.fictionalModel, 1);
      setModelVisible(state.fictionalModel, true);
      state.showingFictional = true;
      ui.showItemName(state.itemName || "Fictional Item");
    }
    state.toggleCount++;
  }

  // ─── SMOOTH NOISE ───
  var DEG2RAD = Math.PI / 180;
  function smoothNoise(time, seed) {
    return Math.sin(time * 7.13 + seed * 31.7) * 0.5 +
           Math.sin(time * 13.27 + seed * 17.3) * 0.3 +
           Math.sin(time * 23.41 + seed * 53.1) * 0.2;
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  // ─── PROGRESS SYSTEM ───
  function getZoneForProgress(p) {
    var z = cfg.progress.zones;
    if (p < z.normal.max) return z.normal;
    if (p < z.resisting.max) return z.resisting;
    return z.breaking;
  }

  function updateProgress(intensity, dtSeconds) {
    if (state.isTransforming) return;

    var zone = getZoneForProgress(state.progress);

    if (intensity > 0.03) {
      // Blowing — fill progress
      state.progress += intensity * dtSeconds * cfg.progress.rateMultiplier * zone.fillMult;
    } else {
      // Not blowing — decay
      state.progress -= dtSeconds * cfg.progress.decayRate * zone.decayMult;
    }

    state.progress = Math.max(0, Math.min(1, state.progress));

    ui.updateEmotionBar(state.progress);

    if (state.progress >= 1.0) {
      state.isTransforming = true;
      playTransform();
    }
  }

  // ─── CONTINUOUS ANIMATION (driven by progress) ───
  var animState = {
    jitterSeedX: Math.random() * 100,
    jitterSeedZ: Math.random() * 100 + 50,
    prevJX: 0, prevJZ: 0,
    prevRotZ: 0, prevRotY: 0
  };

  function lerp(a, b, t) { return a + (b - a) * t; }

  function getAnimParams(progress) {
    var anim = cfg.animation;
    // Blend between animation zones based on progress
    if (progress < 0.2) {
      var t = progress / 0.2;
      return {
        zRotDeg: lerp(0, anim.tremor.zRotDeg, t),
        yRotDeg: lerp(0, anim.tremor.yRotDeg || 0, t),
        period: anim.tremor.period,
        squashY: lerp(1, anim.tremor.squashY, t),
        stretchY: lerp(1, anim.tremor.stretchY, t),
        jitter: 0,
        bounceY: 0
      };
    } else if (progress < 0.5) {
      var t = (progress - 0.2) / 0.3;
      return {
        zRotDeg: lerp(anim.tremor.zRotDeg, anim.tickle.zRotDeg, t),
        yRotDeg: lerp(anim.tremor.yRotDeg || 0, 0, t),
        period: lerp(anim.tremor.period, anim.tickle.period, t),
        squashY: lerp(anim.tremor.squashY, anim.tickle.squashY, t),
        stretchY: lerp(anim.tremor.stretchY, anim.tickle.stretchY, t),
        jitter: 0,
        bounceY: lerp(0, anim.tickle.bounceY || 0, t)
      };
    } else if (progress < 0.7) {
      var t = (progress - 0.5) / 0.2;
      return {
        zRotDeg: lerp(anim.tickle.zRotDeg, anim.resist.zRotDeg, t),
        yRotDeg: 0,
        period: lerp(anim.tickle.period, anim.resist.period, t),
        squashY: lerp(anim.tickle.squashY, anim.resist.squashY, t),
        stretchY: lerp(anim.tickle.stretchY, anim.resist.stretchY, t),
        jitter: lerp(0, anim.resist.jitter || 0, t),
        bounceY: lerp(anim.tickle.bounceY || 0, anim.resist.bounceY || 0, t)
      };
    } else if (progress < 0.9) {
      var t = (progress - 0.7) / 0.2;
      return {
        zRotDeg: lerp(anim.resist.zRotDeg, anim.breaking.zRotDeg, t),
        yRotDeg: 0,
        period: lerp(anim.resist.period, anim.breaking.period, t),
        squashY: lerp(anim.resist.squashY, anim.breaking.squashY, t),
        stretchY: lerp(anim.resist.stretchY, anim.breaking.stretchY, t),
        jitter: lerp(anim.resist.jitter || 0, anim.breaking.jitter || 0, t),
        bounceY: lerp(anim.resist.bounceY || 0, anim.breaking.bounceY || 0, t)
      };
    } else {
      var t = (progress - 0.9) / 0.1;
      return {
        zRotDeg: lerp(anim.breaking.zRotDeg, anim.collapse.zRotDeg, t),
        yRotDeg: 0,
        period: lerp(anim.breaking.period, anim.collapse.period, t),
        squashY: lerp(anim.breaking.squashY, anim.collapse.squashY, t),
        stretchY: lerp(anim.breaking.stretchY, anim.collapse.stretchY, t),
        jitter: lerp(anim.breaking.jitter || 0, anim.collapse.jitter || 0, t),
        bounceY: lerp(anim.breaking.bounceY || 0, anim.collapse.bounceY || 0, t)
      };
    }
  }

  function applyContinuousAnimation(now) {
    if (state.isTransforming || state.progress <= 0) {
      // Reset to neutral when no progress
      var holder = state.modelHolder;
      if (holder && state.progress <= 0) {
        holder.object3D.rotation.set(0, 0, 0);
        holder.object3D.position.set(0, 0, 0);
        var activeModel = state.showingFictional ? state.fictionalModel : state.realModel;
        if (activeModel) activeModel.object3D.scale.set(0.5, 0.5, 0.5);
      }
      return;
    }

    var holder = state.modelHolder;
    var activeModel = state.showingFictional ? state.fictionalModel : state.realModel;
    if (!holder || !activeModel) return;

    var params = getAnimParams(state.progress);
    var timeMs = now;
    var timeSec = now / 1000;
    var baseScale = 0.5;

    // Z-axis wobble
    var phase = (timeMs / params.period) * Math.PI * 2;
    var targetRotZ = Math.sin(phase) * params.zRotDeg * DEG2RAD;
    animState.prevRotZ += (targetRotZ - animState.prevRotZ) * 0.4;
    holder.object3D.rotation.z = animState.prevRotZ;

    // Y-axis tremor (only in low progress — instinctive micro-reaction)
    if (params.yRotDeg > 0) {
      var yPhase = (timeMs / (params.period * 0.7)) * Math.PI * 2;
      var targetRotY = Math.sin(yPhase) * params.yRotDeg * DEG2RAD;
      animState.prevRotY += (targetRotY - animState.prevRotY) * 0.3;
      holder.object3D.rotation.y = animState.prevRotY;
    } else {
      animState.prevRotY *= 0.9; // Smooth fade out
      holder.object3D.rotation.y = animState.prevRotY;
    }

    // Squash-stretch
    var squashWave = Math.sin(phase + Math.PI * 0.5);
    var sy, sxz;
    if (squashWave > 0) {
      sy = baseScale * (1 + (params.stretchY - 1) * squashWave);
      sxz = baseScale * (1 - (params.stretchY - 1) * squashWave * 0.5);
    } else {
      sy = baseScale * (1 + (params.squashY - 1) * (-squashWave));
      sxz = baseScale * (1 - (params.squashY - 1) * (-squashWave) * 0.5);
    }
    activeModel.object3D.scale.set(sxz, sy, sxz);

    // Y bounce
    if (params.bounceY > 0) {
      var bounceWave = Math.abs(Math.sin(phase * 0.5));
      holder.object3D.position.y = params.bounceY * bounceWave;
    } else {
      holder.object3D.position.y *= 0.9;
    }

    // Jitter
    if (params.jitter > 0) {
      var targetJX = smoothNoise(timeSec, animState.jitterSeedX) * params.jitter;
      var targetJZ = smoothNoise(timeSec, animState.jitterSeedZ) * params.jitter;
      animState.prevJX += (targetJX - animState.prevJX) * 0.3;
      animState.prevJZ += (targetJZ - animState.prevJZ) * 0.3;
      holder.object3D.position.x = animState.prevJX;
      holder.object3D.position.z = animState.prevJZ;
    } else {
      animState.prevJX *= 0.9;
      animState.prevJZ *= 0.9;
      holder.object3D.position.x = animState.prevJX;
      holder.object3D.position.z = animState.prevJZ;
    }
  }

  // ─── TRANSFORM ANIMATION ───
  function playTransform() {
    console.log("🎭 Animism transform triggered!");
    var holder = state.modelHolder;
    var activeModel = state.showingFictional ? state.fictionalModel : state.realModel;
    if (!holder) return;

    var tf = cfg.animation.transform;
    var baseScale = 0.5;

    // Hide UI
    ui.hideEmotionBar();
    var prompt = document.getElementById("blow-prompt");
    if (prompt) prompt.classList.add("ar-ui-hidden");

    // Phase 1: Fall over (rotate X-axis to 90 degrees)
    var fallStart = performance.now();
    function fall(now) {
      var elapsed = now - fallStart;
      var t = Math.min(1, elapsed / tf.fallDuration);
      // Ease-in-out for dramatic fall
      var ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      holder.object3D.rotation.x = ease * tf.fallAngleDeg * DEG2RAD;
      // Slight z wobble during fall for organic feel
      holder.object3D.rotation.z = Math.sin(t * Math.PI * 3) * (1 - t) * 5 * DEG2RAD;

      if (t < 1) {
        requestAnimationFrame(fall);
      } else {
        // Phase 2: Grow big
        var growStart = performance.now();
        var growTarget = baseScale * tf.popOvershoot;
        function grow(now) {
          var elapsed = now - growStart;
          var t = Math.min(1, elapsed / tf.shrinkDuration);
          var ease = easeOutCubic(t);
          var sc = baseScale + (growTarget - baseScale) * ease;
          if (activeModel) activeModel.object3D.scale.set(sc, sc, sc);
          if (t < 1) {
            requestAnimationFrame(grow);
          } else {
            // Phase 3: Swap
            doModelSwap();
            // Phase 4: Reset rotation + pop in new model
            holder.object3D.rotation.set(0, 0, 0);
            holder.object3D.position.set(0, 0, 0);
            var newModel = state.showingFictional ? state.fictionalModel : state.realModel;
            if (newModel) newModel.object3D.scale.set(growTarget, growTarget, growTarget);
            var popStart = performance.now();
            function pop(now) {
              var elapsed = now - popStart;
              var t = Math.min(1, elapsed / tf.popDuration);
              var c1 = 1.70158, c3 = c1 + 1;
              var ease = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
              var sc = growTarget + (baseScale - growTarget) * ease;
              if (sc < 0.01) sc = 0.01;
              if (newModel) newModel.object3D.scale.set(sc, sc, sc);
              if (t < 1) {
                requestAnimationFrame(pop);
              } else {
                if (newModel) newModel.object3D.scale.set(baseScale, baseScale, baseScale);
                // Reset state for next cycle
                state.progress = 0;
                state.isTransforming = false;
                ui.updateEmotionBar(0);
                // Show back button
                var btn = document.getElementById("back-to-main");
                if (btn) btn.classList.add("visible");
                console.log("🔄 Animism cycle complete");
              }
            }
            requestAnimationFrame(pop);
          }
        }
        requestAnimationFrame(grow);
      }
    }
    requestAnimationFrame(fall);
  }

  // ─── MAIN GAME LOOP ───
  function gameLoop(now) {
    if (!state.lastFrameTime) state.lastFrameTime = now;
    var dt = Math.min(0.1, (now - state.lastFrameTime) / 1000); // cap at 100ms
    state.lastFrameTime = now;

    var intensity = blowDetector.update();

    if (intensity > 0.05) {
      windParticles.spawn(intensity);
    }

    updateProgress(intensity, dt);
    applyContinuousAnimation(now);

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
      if (btn) { btn.textContent = "Start AR"; btn.disabled = false; }
      this.setStatus("Model ready — tap to enter AR");
    },

    dismissOverlay: function () {
      if (this._dismissed) return;
      this._dismissed = true;
      if (this._safetyTimer) { clearTimeout(this._safetyTimer); this._safetyTimer = null; }
      var el = document.getElementById("pre-ar-overlay");
      if (el) el.classList.add("is-hidden");
      ui.showUI();
      blowDetector.init(function () {
        console.log("🎮 Starting animism game loop");
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
      sceneEl.addEventListener("realityready", function () { self.dismissOverlay(); });
      sceneEl.addEventListener("realityerror", function () {
        if (self._safetyTimer) { clearTimeout(self._safetyTimer); self._safetyTimer = null; }
        self._dismissed = false;
        var el = document.getElementById("pre-ar-overlay");
        if (el) el.classList.remove("is-hidden");
        if (btn) { btn.textContent = "AR Failed — Retry"; btn.disabled = false; }
        self.setStatus("AR failed to start.\nPlease check camera permissions.");
      });
    }
  };

  // ─── SINGLE FINGER DRAG ───
  function setupDrag() {
    var sceneEl = document.querySelector("a-scene");
    var posHolder = document.getElementById("position-holder");
    if (!sceneEl || !posHolder) return;
    var drag = { isActive: false, startX: 0, startY: 0, startMX: 0, startMZ: 0 };
    sceneEl.addEventListener("touchstart", function (e) {
      if (e.touches.length === 1 && !state.isTransforming) {
        var t = e.touches[0], pos = posHolder.getAttribute("position");
        drag.isActive = true; drag.startX = t.clientX; drag.startY = t.clientY;
        drag.startMX = pos.x; drag.startMZ = pos.z;
      }
    });
    sceneEl.addEventListener("touchmove", function (e) {
      if (drag.isActive && e.touches.length === 1 && !state.isTransforming) {
        var t = e.touches[0];
        var dx = 0.005 * (t.clientX - drag.startX);
        var dz = 0.005 * (t.clientY - drag.startY);
        var pos = posHolder.getAttribute("position");
        posHolder.setAttribute("position", { x: drag.startMX + dx, y: pos.y, z: drag.startMZ + dz });
      }
    });
    sceneEl.addEventListener("touchend", function () { drag.isActive = false; });
  }

  // ─── A-FRAME COMPONENT ───
  AFRAME.registerComponent("blow-animism-interaction", {
    init: function () {
      console.log("🎮 BlowItem AR Interaction initializing (animism mode)...");
      overlay.bind(this.el);
      ui.init();
      windParticles.init();
      ui.setStatus("Loading models...");

      var params = (function () {
        if (TEST_MODE.enabled) {
          return { realGlb: TEST_MODE.realGlb, fictionalGlb: TEST_MODE.fictionalGlb,
            itemName: TEST_MODE.itemName, realName: TEST_MODE.realName };
        }
        var p = new URLSearchParams(window.location.search);
        return { realGlb: p.get("real_glb"), fictionalGlb: p.get("fictional_glb"),
          itemName: p.get("item_name") || "Fictional Item", realName: p.get("real_name") || "Real Item" };
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

      var self = this;
      this.el.addEventListener("loaded", function () {
        state.showingFictional = false;
        state.toggleCount = 0;
        state.progress = 0;
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

      state.realModel.setAttribute("gltf-model", state.realGlbUrl);
      state.fictionalModel.setAttribute("gltf-model", state.fictionalGlbUrl);

      state.realModel.addEventListener("model-loaded", function () {
        console.log("✅ Real model loaded");
        setModelOpacity(state.realModel, 1);
        setModelVisible(state.realModel, true);
        ui.setStatus("Blow to tickle it! 🌬️");
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
