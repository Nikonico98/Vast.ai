(function () {
  "use strict";

  console.log("✅ BlowItem AR Interaction loaded (giggle mode)");

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
        lowFreqRatioMin: 0.03,
        spectralFlatnessMin: 0.02,
        energyStabilityMax: 0.85
      },
      giggle: {
        minBlowDuration: 300,
        cooldownDuration: 300,
        stage1: { wobbleDeg: 5, wobbleCycles: 3, wobblePeriod: 200, squashY: 0.95, stretchY: 1.05 },
        stage2: { wobbleDeg: 12, wobbleCycles: 5, wobblePeriod: 140, squashY: 0.85, stretchY: 1.2, jitter: 0.02 },
        stage3: { wobbleDeg: 15, wobblePeriod: 80, tremorDuration: 600, shrinkDuration: 150, popDuration: 350, popOvershoot: 1.15 }
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
        // Deep merge one level for giggle sub-objects (stage1, stage2, stage3)
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
    console.log("⚙️ BLOW_CONFIG merged", merged);
    return merged;
  })();

  // ─── BLOW STATES ───
  var BLOW_STATE = {
    IDLE: "idle",
    BLOWING: "blowing",
    GIGGLE_1: "giggle_1",
    COOLDOWN_1: "cooldown_1",
    GIGGLE_2: "giggle_2",
    COOLDOWN_2: "cooldown_2",
    GIGGLE_3: "giggle_3",
    TRANSFORMING: "transforming"
  };

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
    // Giggle state machine
    blowState: "idle",
    blowCount: 0,
    blowStartTime: 0,
    blowEndTime: 0,
    isBlowingNow: false,
    isAnimating: false
  };

  // ─── BLOW DETECTION (3DS-style) ───
  var blowDetector = {
    _energyHistory: [],
    _energyHistorySize: 12,

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

    computeRawIntensity: function () {
      var sum = 0;
      var bins = Math.min(cfg.blow.lowFreqBins, state.freqData.length);
      for (var i = 0; i < bins; i++) {
        sum += state.freqData[i];
      }
      return sum / (bins * 255);
    },

    checkLowFreqRatio: function () {
      var binCount = state.freqData.length;
      var lowBins = cfg.blow.lowFreqBins;
      var lowSum = 0, totalSum = 0;
      for (var i = 0; i < binCount; i++) {
        var val = state.freqData[i];
        totalSum += val;
        if (i < lowBins) lowSum += val;
      }
      if (totalSum < 1) return false;
      return (lowSum / totalSum) >= cfg.blow.lowFreqRatioMin;
    },

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
      return (geoMean / ariMean) >= cfg.blow.spectralFlatnessMin;
    },

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
      if (mean < 0.005) return false;
      var variance = 0;
      for (var k = 0; k < count; k++) {
        var d = this._energyHistory[k] - mean;
        variance += d * d;
      }
      var stddev = Math.sqrt(variance / count);
      return (stddev / mean) <= cfg.blow.energyStabilityMax;
    },

    update: function () {
      if (!state.micReady || !state.analyser) return 0;
      state.analyser.getByteFrequencyData(state.freqData);
      var raw = blowDetector.computeRawIntensity();

      var adjusted = Math.max(0, raw - state.noiseFloor);
      var normalized = Math.min(1, adjusted / (1 - state.noiseFloor + 0.001));

      if (normalized < cfg.blow.threshold) normalized = 0;

      if (normalized > 0) {
        var lowFreqOk = blowDetector.checkLowFreqRatio();
        var flatnessOk = blowDetector.checkSpectralFlatness();
        var stabilityOk = blowDetector.checkEnergyStability();
        if (!lowFreqOk || !flatnessOk || !stabilityOk) {
          normalized = 0;
        }
      } else {
        state.analyser.getFloatTimeDomainData(state.timeData);
        var len = state.timeData.length;
        var e = 0;
        for (var i = 0; i < len; i++) e += state.timeData[i] * state.timeData[i];
        this._energyHistory.push(Math.sqrt(e / len));
        if (this._energyHistory.length > this._energyHistorySize) this._energyHistory.shift();
      }

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
        blowPrompt: document.getElementById("blow-prompt"),
        itemName: document.getElementById("item-name-display"),
        stageDots: document.getElementById("stage-dots")
      };
      console.log("🎨 UI initialized");
    },

    setStatus: function (text) {
      var el = document.getElementById("pre-ar-status");
      if (el) el.textContent = text;
    },

    showUI: function () {
      var els = ["hint", "blowPrompt", "stageDots"];
      for (var i = 0; i < els.length; i++) {
        var el = this.elements[els[i]];
        if (el) el.classList.remove("ar-ui-hidden");
      }
    },

    updateStageDots: function (blowCount) {
      var dots = this.elements.stageDots;
      if (!dots) return;
      var spans = dots.querySelectorAll(".stage-dot");
      for (var i = 0; i < spans.length; i++) {
        if (i < blowCount) {
          spans[i].classList.add("filled");
          spans[i].classList.remove("pop");
          spans[i].offsetWidth; // force reflow
          spans[i].classList.add("pop");
        } else {
          spans[i].classList.remove("filled");
          spans[i].classList.remove("pop");
        }
      }
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
    console.log("🔄 Toggle #" + state.toggleCount);
  }

  // ─── GIGGLE ANIMATIONS ───
  var DEG2RAD = Math.PI / 180;

  // Smooth noise function — replaces jerky Math.random() with sine-based smooth noise
  function smoothNoise(time, seed) {
    return Math.sin(time * 7.13 + seed * 31.7) * 0.5 +
           Math.sin(time * 13.27 + seed * 17.3) * 0.3 +
           Math.sin(time * 23.41 + seed * 53.1) * 0.2;
  }

  // Ease-out cubic for smooth deceleration (like Rotate's bounce settle)
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // Settle animation: smoothly returns scale to base after wobble (like Rotate's post-bounce)
  function settleScale(activeModel, baseScale, duration, onComplete) {
    if (!activeModel) { if (onComplete) onComplete(); return; }
    var startScale = {
      x: activeModel.object3D.scale.x,
      y: activeModel.object3D.scale.y,
      z: activeModel.object3D.scale.z
    };
    var startTime = performance.now();
    function settle(now) {
      var elapsed = now - startTime;
      var t = Math.min(1, elapsed / duration);
      var ease = easeOutCubic(t);
      var sx = startScale.x + (baseScale - startScale.x) * ease;
      var sy = startScale.y + (baseScale - startScale.y) * ease;
      var sz = startScale.z + (baseScale - startScale.z) * ease;
      activeModel.object3D.scale.set(sx, sy, sz);
      if (t < 1) {
        requestAnimationFrame(settle);
      } else {
        activeModel.object3D.scale.set(baseScale, baseScale, baseScale);
        if (onComplete) onComplete();
      }
    }
    requestAnimationFrame(settle);
  }

  // Combined wobble + squash-stretch in a single rAF loop for smooth animation
  function wobbleAndSquash(opts, onComplete) {
    // opts: { deg, cycles, period, squashY, stretchY, jitter, bounceY }
    var holder = state.modelHolder;
    var activeModel = state.showingFictional ? state.fictionalModel : state.realModel;
    if (!holder) { if (onComplete) onComplete(); return; }
    var startTime = performance.now();
    var totalDuration = opts.cycles * opts.period;
    var baseScale = 0.5;
    var jitter = opts.jitter || 0;
    var bounceY = opts.bounceY || 0; // Y-axis bounce amplitude (like Rotate's vertical bounce)
    // Smooth jitter state — pre-generate seed for deterministic smooth noise
    var jitterSeedX = Math.random() * 100;
    var jitterSeedZ = Math.random() * 100 + 50;
    // Previous values for interpolation (lerp smoothing)
    var prevJX = 0, prevJZ = 0;
    var prevAngle = 0;
    var jitterLerp = 0.3; // Smoothing factor — higher for responsive but smooth feel
    var angleLerp = 0.4;  // Rotation smoothing — prevents micro-stutters
    // Remember base position for bounce
    var baseY = holder.object3D.position.y;

    function animate(now) {
      var elapsed = now - startTime;
      if (elapsed >= totalDuration) {
        // Smooth settle for ALL properties — rotation, position, and scale
        var settleStartRot = holder.object3D.rotation.z;
        var settleStartX = holder.object3D.position.x;
        var settleStartY = holder.object3D.position.y - baseY;
        var settleStartZ = holder.object3D.position.z;
        var settleStart = performance.now();
        var settleDur = 180; // Slightly longer for more visible ease
        function settleAll(now2) {
          var st = Math.min(1, (now2 - settleStart) / settleDur);
          // Smooth ease-out that decelerates naturally
          var ease = easeOutCubic(st);
          holder.object3D.rotation.z = settleStartRot * (1 - ease);
          holder.object3D.position.x = settleStartX * (1 - ease);
          holder.object3D.position.y = baseY + settleStartY * (1 - ease);
          holder.object3D.position.z = settleStartZ * (1 - ease);
          if (st < 1) {
            requestAnimationFrame(settleAll);
          } else {
            holder.object3D.rotation.z = 0;
            holder.object3D.position.x = 0;
            holder.object3D.position.y = baseY;
            holder.object3D.position.z = 0;
            // Settle scale smoothly (like Rotate's squash recovery)
            settleScale(activeModel, baseScale, 150, onComplete);
          }
        }
        requestAnimationFrame(settleAll);
        return;
      }

      var t = elapsed / totalDuration;
      // Improved envelope: fast cubic ease-in, smooth ease-out decay
      var envelope;
      if (t < 0.12) {
        // Quick ramp up — slightly faster attack for snappier feel
        var rampT = t / 0.12;
        envelope = rampT * rampT * (3 - 2 * rampT); // smoothstep
      } else {
        // Smooth decay using cosine for organic feel
        var decayT = (t - 0.12) / 0.88;
        envelope = Math.cos(decayT * Math.PI * 0.5);
      }
      envelope = Math.max(0, envelope);

      // Wobble rotation — smooth sine wave with lerp interpolation
      var phase = (elapsed / opts.period) * Math.PI * 2;
      var targetAngle = Math.sin(phase) * opts.deg * envelope * DEG2RAD;
      // Lerp rotation for sub-frame smoothness (prevents aliasing at high wobble speeds)
      prevAngle += (targetAngle - prevAngle) * angleLerp;
      holder.object3D.rotation.z = prevAngle;

      // Y-axis bounce — synced to wobble, like Rotate's vertical bounce physics
      if (bounceY > 0) {
        var bounceWave = Math.abs(Math.sin(phase * 0.5)); // Half freq, always positive
        holder.object3D.position.y = baseY + bounceY * bounceWave * envelope;
      }

      // Squash-stretch — synced with wobble, phase-shifted for organic motion
      if (activeModel && opts.squashY && opts.stretchY) {
        var squashWave = Math.sin(phase + Math.PI * 0.5); // 90° offset from wobble
        var sy, sxz;
        if (squashWave > 0) {
          sy = baseScale * (1 + (opts.stretchY - 1) * squashWave * envelope);
          sxz = baseScale * (1 - (opts.stretchY - 1) * squashWave * envelope * 0.5);
        } else {
          sy = baseScale * (1 + (opts.squashY - 1) * (-squashWave) * envelope);
          sxz = baseScale * (1 - (opts.squashY - 1) * (-squashWave) * envelope * 0.5);
        }
        activeModel.object3D.scale.set(sxz, sy, sxz);
      }

      // Jitter — smooth sine-based noise with lerp interpolation
      if (jitter > 0) {
        var jitterStrength = jitter * envelope;
        var timeSeconds = elapsed / 1000;
        // Generate smooth target positions using layered sine waves
        var targetJX = smoothNoise(timeSeconds, jitterSeedX) * jitterStrength;
        var targetJZ = smoothNoise(timeSeconds, jitterSeedZ) * jitterStrength;
        // Lerp for extra smoothness (prevents any discontinuity)
        prevJX += (targetJX - prevJX) * jitterLerp;
        prevJZ += (targetJZ - prevJZ) * jitterLerp;
        holder.object3D.position.x = prevJX;
        holder.object3D.position.z = prevJZ;
      }

      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  // Stage 1: light wobble + subtle squash-stretch + gentle bounce
  function playGiggle1(onComplete) {
    state.isAnimating = true;
    var s = cfg.giggle.stage1;
    wobbleAndSquash({
      deg: s.wobbleDeg,
      cycles: s.wobbleCycles,
      period: s.wobblePeriod,
      squashY: s.squashY,
      stretchY: s.stretchY,
      jitter: 0,
      bounceY: 0.03 // Subtle vertical bounce like Rotate's gentle oscillation
    }, function () {
      state.isAnimating = false;
      if (onComplete) onComplete();
    });
  }

  // Stage 2: vigorous wobble + strong squash-stretch + jitter + bounce
  function playGiggle2(onComplete) {
    state.isAnimating = true;
    var s = cfg.giggle.stage2;
    wobbleAndSquash({
      deg: s.wobbleDeg,
      cycles: s.wobbleCycles,
      period: s.wobblePeriod,
      squashY: s.squashY,
      stretchY: s.stretchY,
      jitter: s.jitter,
      bounceY: 0.08 // More visible vertical bounce for higher intensity
    }, function () {
      state.isAnimating = false;
      if (onComplete) onComplete();
    });
  }

  // Stage 3: intense tremor → grow big → swap → pop out new model
  function playTransform(onComplete) {
    state.isAnimating = true;
    var s = cfg.giggle.stage3;
    var holder = state.modelHolder;
    if (!holder) { state.isAnimating = false; if (onComplete) onComplete(); return; }

    // Phase 1: Intense tremor with jitter
    var tremorCycles = Math.floor(s.tremorDuration / s.wobblePeriod);
    wobbleAndSquash({
      deg: s.wobbleDeg,
      cycles: tremorCycles,
      period: s.wobblePeriod,
      squashY: 0.85,
      stretchY: 1.2,
      jitter: 0.03,
      bounceY: 0.12 // Strong vertical bounce during transform tremor
    }, function () {
      // Phase 2: Grow big (expand to overshoot scale) — smooth ease-out like Rotate
      var activeModel = state.showingFictional ? state.fictionalModel : state.realModel;
      var growStart = performance.now();
      var baseScale = 0.5;
      var growTarget = baseScale * s.popOvershoot;

      function grow(now) {
        var elapsed = now - growStart;
        var t = Math.min(1, elapsed / s.shrinkDuration);
        // Smooth ease-out cubic (like Rotate's bounce rise)
        var ease = easeOutCubic(t);
        var sc = baseScale + (growTarget - baseScale) * ease;
        if (activeModel) {
          activeModel.object3D.scale.set(sc, sc, sc);
        }
        if (t < 1) {
          requestAnimationFrame(grow);
        } else {
          // Phase 3: Swap model
          doModelSwap();

          // Phase 4: New model pops in with bounce-back settle (like Rotate's bounce)
          var newModel = state.showingFictional ? state.fictionalModel : state.realModel;
          if (newModel) newModel.object3D.scale.set(growTarget, growTarget, growTarget);
          var popStart = performance.now();

          function pop(now) {
            var elapsed = now - popStart;
            var t = Math.min(1, elapsed / s.popDuration);
            // Ease-out-back: bounce overshoot that settles (same as Rotate)
            var c1 = 1.70158;
            var c3 = c1 + 1;
            var ease = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
            var sc = growTarget + (baseScale - growTarget) * ease;
            if (sc < 0.01) sc = 0.01;
            if (newModel) {
              newModel.object3D.scale.set(sc, sc, sc);
            }
            if (t < 1) {
              requestAnimationFrame(pop);
            } else {
              // Smooth final settle (like Rotate's settle animation)
              settleScale(newModel, baseScale, 150, function () {
                holder.object3D.rotation.set(0, 0, 0);
                holder.object3D.position.set(0, 0, 0);
                state.isAnimating = false;
                if (onComplete) onComplete();
              });
            }
          }
          requestAnimationFrame(pop);
        }
      }
      requestAnimationFrame(grow);
    });
  }

  // ─── BLOW STATE MACHINE ───
  var BLOW_THRESHOLD = 0.03;

  function updateBlowStateMachine(intensity) {
    var now = performance.now();
    var wasBlowing = state.isBlowingNow;
    state.isBlowingNow = intensity > BLOW_THRESHOLD;

    // Detect blow start
    if (state.isBlowingNow && !wasBlowing) {
      state.blowStartTime = now;
    }
    // Detect blow end
    if (!state.isBlowingNow && wasBlowing) {
      state.blowEndTime = now;
    }

    // Don't process state transitions while animating
    if (state.isAnimating) return;

    var bs = state.blowState;
    var g = cfg.giggle;

    switch (bs) {
      case BLOW_STATE.IDLE:
        if (state.isBlowingNow && (now - state.blowStartTime) >= g.minBlowDuration) {
          state.blowState = BLOW_STATE.GIGGLE_1;
          state.blowCount = 1;
          ui.updateStageDots(1);
          console.log("🌬️ Blow 1 → GIGGLE_1");
          playGiggle1(function () {
            state.blowState = BLOW_STATE.COOLDOWN_1;
            console.log("⏸️ → COOLDOWN_1");
          });
        }
        break;

      case BLOW_STATE.COOLDOWN_1:
        if (state.isBlowingNow && state.blowStartTime > state.blowEndTime &&
            state.blowEndTime > 0 && (state.blowStartTime - state.blowEndTime) >= g.cooldownDuration &&
            (now - state.blowStartTime) >= g.minBlowDuration) {
          state.blowState = BLOW_STATE.GIGGLE_2;
          state.blowCount = 2;
          ui.updateStageDots(2);
          console.log("🌬️ Blow 2 → GIGGLE_2");
          playGiggle2(function () {
            state.blowState = BLOW_STATE.COOLDOWN_2;
            console.log("⏸️ → COOLDOWN_2");
          });
        }
        break;

      case BLOW_STATE.COOLDOWN_2:
        if (state.isBlowingNow && state.blowStartTime > state.blowEndTime &&
            state.blowEndTime > 0 && (state.blowStartTime - state.blowEndTime) >= g.cooldownDuration &&
            (now - state.blowStartTime) >= g.minBlowDuration) {
          state.blowState = BLOW_STATE.GIGGLE_3;
          state.blowCount = 3;
          ui.updateStageDots(3);
          console.log("🌬️ Blow 3 → TRANSFORM");
          playTransform(function () {
            // Reset cycle
            state.blowState = BLOW_STATE.IDLE;
            state.blowCount = 0;
            state.blowStartTime = 0;
            state.blowEndTime = 0;
            state.isBlowingNow = false;
            ui.updateStageDots(0);
            console.log("🔄 Cycle reset → IDLE");
          });
        }
        break;

      default:
        break;
    }
  }

  // ─── MAIN GAME LOOP ───
  function gameLoop() {
    var intensity = blowDetector.update();

    if (intensity > 0.05) {
      windParticles.spawn(intensity);
    }

    updateBlowStateMachine(intensity);

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

      ui.showUI();

      blowDetector.init(function () {
        console.log("🎮 Starting game loop (giggle mode)");
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
      if (e.touches.length === 1 && !state.isAnimating) {
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
      if (drag.isActive && e.touches.length === 1 && !state.isAnimating) {
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
      console.log("🎮 BlowItem AR Interaction initializing (giggle mode)...");

      overlay.bind(this.el);
      ui.init();
      windParticles.init();
      ui.setStatus("Loading models...");

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
        state.showingFictional = false;
        state.toggleCount = 0;
        state.blowCount = 0;
        state.blowState = BLOW_STATE.IDLE;
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
