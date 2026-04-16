(()=>{"use strict";

/* ============================================================
   SafeCrackAudio — Metal friction dial + click unlock sounds
   with small-room reverb & delay for spatial depth
   ============================================================ */
const SafeCrackAudio = (function() {
  let ctx = null;
  let initialized = false;
  let masterGain = null;  // master volume
  let dryGain = null;    // direct signal
  let reverbGain = null; // wet reverb
  let delayGain = null;  // wet delay
  let reverbNode = null;
  let delayNode = null;
  let feedbackGain = null;
  let delayFilter = null;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctx;
  }

  /* Generate small-room impulse response (synthetic convolution reverb) */
  function _createRoomIR() {
    var sr = ctx.sampleRate;
    var duration = 0.6; // small room: short tail
    var len = Math.floor(sr * duration);
    var buf = ctx.createBuffer(2, len, sr);
    for (var ch = 0; ch < 2; ch++) {
      var data = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        // Exponential decay with early reflections
        var t = i / sr;
        var decay = Math.exp(-t * 8); // fast decay = small room
        // Early reflections: a few discrete taps
        var early = 0;
        if (i === Math.floor(sr * 0.012)) early = 0.4;  // ~12ms first reflection
        if (i === Math.floor(sr * 0.025)) early = 0.25;  // ~25ms
        if (i === Math.floor(sr * 0.041)) early = 0.15;  // ~41ms
        if (i === Math.floor(sr * 0.058)) early = 0.1;   // ~58ms wall bounce
        data[i] = ((Math.random() * 2 - 1) * decay + early) * (ch === 0 ? 1 : 0.95);
      }
    }
    return buf;
  }

  function init() {
    ensureCtx();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // --- Master volume (3x boost) ---
    masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(3.0, ctx.currentTime);
    masterGain.connect(ctx.destination);

    // --- Dry path ---
    dryGain = ctx.createGain();
    dryGain.gain.setValueAtTime(0.85, ctx.currentTime);
    dryGain.connect(masterGain);

    // --- Convolution reverb (small room) ---
    reverbNode = ctx.createConvolver();
    reverbNode.buffer = _createRoomIR();
    reverbGain = ctx.createGain();
    reverbGain.gain.setValueAtTime(0.3, ctx.currentTime); // reverb wet level
    // High-cut on reverb to simulate room absorption
    var reverbCut = ctx.createBiquadFilter();
    reverbCut.type = 'lowpass';
    reverbCut.frequency.setValueAtTime(4000, ctx.currentTime);
    reverbNode.connect(reverbCut);
    reverbCut.connect(reverbGain);
    reverbGain.connect(masterGain);

    // --- Feedback delay (subtle slapback echo) ---
    delayNode = ctx.createDelay(1.0);
    delayNode.delayTime.setValueAtTime(0.08, ctx.currentTime); // 80ms = close wall reflection
    feedbackGain = ctx.createGain();
    feedbackGain.gain.setValueAtTime(0.25, ctx.currentTime); // feedback amount
    delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.setValueAtTime(3000, ctx.currentTime); // each repeat gets darker
    delayGain = ctx.createGain();
    delayGain.gain.setValueAtTime(0.2, ctx.currentTime); // delay wet level
    // Delay feedback loop
    delayNode.connect(delayFilter);
    delayFilter.connect(feedbackGain);
    feedbackGain.connect(delayNode); // feedback loop
    delayNode.connect(delayGain);
    delayGain.connect(masterGain);

    initialized = true;
    console.log('🔊 SafeCrackAudio initialized (room reverb + delay)');
  }

  /* Get the effects bus input — all sounds route through this */
  function _getDest() {
    // Return a fan-out: dry + reverb + delay
    if (!dryGain) return ctx.destination;
    return dryGain;
  }

  /* Helper: filtered noise burst routed through effects */
  function _noise(startTime, duration, filterFreq, filterQ, volume, hpFreq) {
    if (!ctx) return;
    var sr = ctx.sampleRate;
    var len = Math.floor(sr * duration);
    var buf = ctx.createBuffer(1, len, sr);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(filterFreq, startTime);
    bp.Q.setValueAtTime(filterQ, startTime);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(hpFreq || 600, startTime);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    src.connect(bp);
    bp.connect(hp);
    hp.connect(gain);
    // Fan out to dry + reverb + delay
    gain.connect(_getDest());
    if (reverbNode) gain.connect(reverbNode);
    if (delayNode) gain.connect(delayNode);
    src.start(startTime);
    src.stop(startTime + duration);
  }

  /* --- DIAL TICK: precision safe-dial friction --- */
  function playTick(freq) {
    if (!initialized || !ctx) return;
    var now = ctx.currentTime;
    var t = Math.max(0, Math.min(1, (freq - 800) / 1600));

    // Primary: dry metallic friction (low Q = broadband, no pitch)
    var scrapeDur = 0.03 + t * 0.025;
    _noise(now, scrapeDur, 1800 + t * 1500, 1.2 + t * 1.0, 0.18 + t * 0.12, 500);

    // Secondary: higher band grit layer (adds texture, not pitch)
    _noise(now + 0.003, scrapeDur * 0.6, 4000 + t * 2000, 1.5, 0.06 + t * 0.05, 2000);
  }

  /* --- CHECKPOINT UNLOCK: "咔擦" click-latch sound --- */
  function playUnlockChord() {
    if (!initialized || !ctx) return;
    var now = ctx.currentTime;

    // "咔" — sharp dry click (wide bandwidth, low Q = no pitch)
    _noise(now, 0.012, 3000, 1.5, 0.6, 800);
    // Secondary transient layer for attack bite
    _noise(now + 0.003, 0.008, 6000, 2, 0.3, 3000);

    // "擦" — latch bolt sliding (wider band, gritty friction)
    var sr = ctx.sampleRate;
    var len = Math.floor(sr * 0.06);
    var buf = ctx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2500, now + 0.02);
    bp.frequency.exponentialRampToValueAtTime(1200, now + 0.08);
    bp.Q.setValueAtTime(2, now + 0.02);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(600, now + 0.02);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    src.connect(bp);
    bp.connect(hp);
    hp.connect(gain);
    gain.connect(_getDest());
    if (reverbNode) gain.connect(reverbNode);
    if (delayNode) gain.connect(delayNode);
    src.start(now + 0.02);
    src.stop(now + 0.1);
  }

  /* --- FINAL UNLOCK: heavy "咔擦" + bolt mechanism --- */
  function playFinalUnlock() {
    if (!initialized || !ctx) return;
    var now = ctx.currentTime;

    // Heavy "咔" — louder, deeper initial click
    _noise(now, 0.035, 3200, 10, 0.55, 1500);

    // Heavy "擦" — heavier latch engagement
    _noise(now + 0.04, 0.1, 2800, 6, 0.45, 800);

    // Second mechanical "咔擦" (double-action lock)
    _noise(now + 0.18, 0.03, 4000, 12, 0.45, 2000);
    _noise(now + 0.22, 0.08, 2500, 7, 0.35, 1000);

    // Heavy bolt sliding (low frequency metallic scrape)
    var sr = ctx.sampleRate;
    var len = Math.floor(sr * 0.35);
    var buf = ctx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, now + 0.35);
    bp.frequency.linearRampToValueAtTime(900, now + 0.7);
    bp.Q.setValueAtTime(3, now + 0.35);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(400, now + 0.35);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now + 0.35);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    src.connect(bp);
    bp.connect(hp);
    hp.connect(gain);
    gain.connect(_getDest());
    if (reverbNode) gain.connect(reverbNode);
    if (delayNode) gain.connect(delayNode);
    src.start(now + 0.35);
    src.stop(now + 0.72);

    // Deep resonant thud at the end (bolt hitting stop)
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now + 0.68);
    g.gain.setValueAtTime(0.25, now + 0.68);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    osc.connect(g);
    g.connect(_getDest());
    if (reverbNode) g.connect(reverbNode);
    if (delayNode) g.connect(delayNode);
    osc.start(now + 0.68);
    osc.stop(now + 0.88);
  }

  return { init: init, playTick: playTick, playUnlockChord: playUnlockChord, playFinalUnlock: playFinalUnlock };
})();

/* ============================================================
   Flash overlay helper
   ============================================================ */
function triggerFlash(gold, duration) {
  const el = document.getElementById('flash-overlay');
  if (!el) return;
  el.classList.remove('active', 'gold');
  void el.offsetWidth;
  if (gold) el.classList.add('gold');
  el.classList.add('active');
  setTimeout(function() {
    el.classList.remove('active', 'gold');
  }, duration || 150);
}

/* ============================================================
   Vibration helper (Android only — iOS not supported)
   ============================================================ */
var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

function triggerVibration(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch(e) {}
  }
}

/* ============================================================
   Safecrack hint system
   ============================================================ */
const HintSystem = (function() {
  let inactivityTimer = null;
  let hintEl = null;

  function getEl() {
    if (!hintEl) hintEl = document.getElementById('safecrack-hint');
    return hintEl;
  }

  function show(text, duration) {
    const el = getEl();
    if (!el) return;
    el.textContent = text;
    el.classList.add('visible');
    if (duration) {
      setTimeout(function() { el.classList.remove('visible'); }, duration);
    }
  }

  function hide() {
    const el = getEl();
    if (el) el.classList.remove('visible');
  }

  function resetInactivity(cfg) {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(function() {
      show(cfg.hints.inactivity, 3000);
    }, cfg.hints.inactivityTimeout);
  }

  function stopInactivity() {
    clearTimeout(inactivityTimer);
  }

  return { show: show, hide: hide, resetInactivity: resetInactivity, stopInactivity: stopInactivity };
})();

/* ============================================================
   Tick scheduler — controls tick rate based on proximity
   ============================================================ */
const TickScheduler = (function() {
  let timer = null;
  let active = false;

  function start(distance, feedbackRange, cfg) {
    if (!active) return;
    clearTimeout(timer);
    const t = Math.max(0, Math.min(1, distance / feedbackRange));
    // t = 1 (far) → tickRate = 800ms, t = 0 (close) → tickRate = 80ms
    const tickRate = cfg.feedback.tickRateRange[1] +
      (cfg.feedback.tickRateRange[0] - cfg.feedback.tickRateRange[1]) * t;
    // pitch: t=1 (far) → 800Hz, t=0 (close) → 2400Hz
    const pitch = cfg.feedback.pitchRange[0] +
      (cfg.feedback.pitchRange[1] - cfg.feedback.pitchRange[0]) * (1 - t);

    SafeCrackAudio.playTick(pitch);

    timer = setTimeout(function() {
      start(distance, feedbackRange, cfg);
    }, tickRate);
  }

  function activate() { active = true; }
  function deactivate() { active = false; clearTimeout(timer); }
  function update(distance, feedbackRange, cfg) {
    if (!active) return;
    clearTimeout(timer);
    start(distance, feedbackRange, cfg);
  }

  return { activate: activate, deactivate: deactivate, update: update };
})();

/* ============================================================
   Glow controller — ring border & box-shadow
   ============================================================ */
function updateRingGlow(distance, feedbackRange, cfg) {
  const el = document.getElementById('ring-track');
  if (!el) return;
  if (distance > feedbackRange) {
    // Outside feedback range — dim
    el.style.borderColor = cfg.ringColor.base;
    el.style.boxShadow = 'none';
    return;
  }
  // t: 1 = at target, 0 = at edge of feedbackRange
  const t = Math.max(0, Math.min(1, 1 - distance / feedbackRange));
  // Interpolate border color
  const base = parseRGBA(cfg.ringColor.base);
  const bright = parseRGBA(cfg.ringColor.active);
  const r = Math.round(base.r + (bright.r - base.r) * t);
  const g = Math.round(base.g + (bright.g - base.g) * t);
  const b = Math.round(base.b + (bright.b - base.b) * t);
  const a = +(base.a + (bright.a - base.a) * t).toFixed(3);
  el.style.borderColor = 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';

  if (t > 0.15) {
    const glowSize = Math.round((t - 0.15) / 0.85 * 40);
    const glowAlpha = (0.9 * t).toFixed(2);
    el.style.boxShadow = '0 0 ' + glowSize + 'px rgba(147, 51, 234, ' + glowAlpha + '), 0 0 ' + Math.round(glowSize * 1.5) + 'px rgba(126, 87, 194, ' + (0.4 * t).toFixed(2) + '), inset 0 0 ' + Math.round(glowSize * 0.7) + 'px rgba(147, 51, 234, ' + (0.5 * t).toFixed(2) + ')';
  } else {
    el.style.boxShadow = 'none';
  }
}

/* ============================================================
   Utility functions (preserved from original)
   ============================================================ */
function parseRGBA(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 } : { r: 255, g: 255, b: 255, a: 1 };
}

function normalizeAngle(a) { return ((a % 360) + 360) % 360; }
function angleDist(a, b) {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(d, 360 - d);
}

console.log("✅ RotateItem AR Interaction loaded (Safecracking mode)");

/* ============================================================
   Test mode config
   ============================================================ */
var testConfig = {
  enabled: true,
  realGlb: 'assets/realmodel.glb',
  fictionalGlb: 'assets/fictionalmodel.glb',
  itemName: 'Test Fictional Item',
  realName: 'Test Real Item'
};

/* ============================================================
   Merge ROTATE_CONFIG from ar-config.js
   ============================================================ */
var CONFIG = (function() {
  var defaults = {
    checkpoint: { minAngle: 120, maxAngle: 300, totalChecks: 3, messages: [null, null, null], resetDelay: 300, tolerances: [15, 10, 5] },
    ringColor: { base: 'rgba(255, 255, 255, 0.15)', active: 'rgba(147, 51, 234, 1.0)', reached: 'rgba(126, 87, 194, 1.0)' },
    bounce: {
      initialHeight: 0.3, damping: 0.4, bounceDuration: 350, bounceCount: 3,
      squashStretch: [
        { squashY: 0.7, stretchY: 1.25, squashXZ: 1.2, stretchXZ: 0.85 },
        { squashY: 0.8, stretchY: 1.15, squashXZ: 1.15, stretchXZ: 0.9 },
        { squashY: 0.88, stretchY: 1.08, squashXZ: 1.08, stretchXZ: 0.95 }
      ]
    },
    animation: { transitionDuration: 100, rotationDuration: 200 },
    feedback: {
      feedbackRange: 60,
      tickRateRange: [800, 80],
      pitchRange: [800, 2400],
      tickDuration: 30,
      glowColors: { dim: 'rgba(255,255,255,0.15)', bright: 'rgba(208,188,255,0.9)', peak: 'rgba(126,87,194,1.0)' },
      flash: { duration: 150, finalDuration: 300 },
      vibration: { checkpoint: [200, 100, 200], final: [200, 100, 200, 100, 400] },
      hints: { initial: 'Slowly rotate to find the sweet spot', inactivity: 'Try rotating slowly...', initialDuration: 3000, inactivityTimeout: 15000 }
    }
  };
  var ext = window.ROTATE_CONFIG;
  if (!ext || typeof ext !== 'object') return defaults;
  var merged = {};
  Object.keys(defaults).forEach(function(k) {
    if (defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k]) && ext[k] && typeof ext[k] === 'object' && !Array.isArray(ext[k])) {
      merged[k] = Object.assign({}, defaults[k], ext[k]);
    } else {
      merged[k] = k in ext ? ext[k] : defaults[k];
    }
  });
  // Deep merge feedback sub-objects
  if (ext.feedback && defaults.feedback) {
    Object.keys(defaults.feedback).forEach(function(fk) {
      if (defaults.feedback[fk] && typeof defaults.feedback[fk] === 'object' && !Array.isArray(defaults.feedback[fk]) && ext.feedback[fk]) {
        merged.feedback[fk] = Object.assign({}, defaults.feedback[fk], ext.feedback[fk]);
      }
    });
  }
  console.log('⚙️ ROTATE_CONFIG merged (safecracking)', merged);
  return merged;
})();

/* ============================================================
   Game state
   ============================================================ */
var state = {
  initialRotationY: null,
  currentRotationY: 0,
  rotationProgress: 0,
  hasStarted: false,
  itemNameShown: false,
  realModel: null,
  fictionalModel: null,
  positionHolder: null,
  realGlbUrl: null,
  fictionalGlbUrl: null,
  itemName: null,
  realName: null,
  currentCheck: 0,
  handleNumber: 0,
  currentCheckpointAngle: 0,
  startCheckpointDistance: 0,
  showingFictional: false,
  checkpointLocked: false,
  firstRevealDone: false,
  isBouncing: false,
  baseModelY: 0,
  toggleCount: 0,
  lastFeedbackActive: false  // track if we were in feedback range
};

/* ============================================================
   Checkpoint generation (no triangle, no visual marker)
   ============================================================ */
function generateCheckpoint() {
  var minAngle = CONFIG.checkpoint.minAngle;
  var maxAngle = CONFIG.checkpoint.maxAngle || 300;
  var currentAngle = normalizeAngle(ringDrag.currentRotation);
  var angle = 0, tries = 0;
  do {
    angle = Math.round(Math.random() * 360);
    tries++;
    var d = angleDist(currentAngle, angle);
  } while ((d < minAngle || d > maxAngle) && tries < 200);

  state.currentCheckpointAngle = angle;
  state.startCheckpointDistance = angleDist(currentAngle, angle);
  console.log('🎯 Checkpoint target: ' + angle + '° (distance: ' + Math.round(state.startCheckpointDistance) + '° from ' + Math.round(currentAngle) + '°)');
  return angle;
}

/* ============================================================
   Drag state for model position
   ============================================================ */
var dragState = { isActive: false, startX: 0, startY: 0, startModelX: 0, startModelZ: 0 };

/* ============================================================
   UI module
   ============================================================ */
var ui = {
  elements: {},
  init: function() {
    this.elements = {
      hint: document.getElementById('ar-hint'),
      interactionType: document.getElementById('interaction-type'),
      interactionHint: document.getElementById('interaction-hint'),
      status: document.getElementById('ar-status'),
      statusText: document.getElementById('status-text'),
      itemName: document.getElementById('item-name-display')
    };
    console.log('🎨 UI initialized');
  },
  show: function() {},
  setStatus: function(text, cls) {
    cls = cls || 'waiting';
    if (this.elements.status) {
      this.elements.status.className = cls;
      this.elements.status.classList.remove('ar-ui-hidden');
    }
    if (this.elements.statusText) this.elements.statusText.textContent = text;
  },
  showItemName: function(name) {
    if (this.elements.itemName) {
      this.elements.itemName.textContent = '✨ ' + name;
      this.elements.itemName.classList.add('visible');
    }
  }
};

/* ============================================================
   Model visibility helpers
   ============================================================ */
function setModelOpacity(el, opacity) {
  if (!el || !el.object3D) return;
  el.object3D.traverse(function(obj) {
    if (obj.isMesh && obj.material) {
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(function(mat) {
        if (mat) {
          mat.transparent = true;
          mat.opacity = opacity;
          mat.depthWrite = opacity > 0.95;
          mat.depthTest = true;
          obj.renderOrder = Math.floor(100 * opacity);
          mat.needsUpdate = true;
        }
      });
    }
  });
  el.object3D.visible = !(opacity <= 0.01);
}

function setModelVisible(el, vis) {
  if (el) el.setAttribute('visible', vis);
}

/* ============================================================
   Toggle real/fictional model
   ============================================================ */
function toggleModel() {
  if (state.showingFictional) {
    setModelOpacity(state.fictionalModel, 0);
    setModelVisible(state.fictionalModel, false);
    setModelOpacity(state.realModel, 1);
    setModelVisible(state.realModel, true);
    state.showingFictional = false;
    ui.showItemName(state.realName || 'Real Item');
    state.itemNameShown = true;
  } else {
    setModelOpacity(state.realModel, 0);
    setModelVisible(state.realModel, false);
    setModelOpacity(state.fictionalModel, 1);
    setModelVisible(state.fictionalModel, true);
    state.showingFictional = true;
    ui.showItemName(state.itemName || 'Fictional Item');
    state.itemNameShown = true;
  }
  state.toggleCount++;
  console.log('🔄 Toggle #' + state.toggleCount);
  if (state.toggleCount >= 3) {
    var btn = document.getElementById('back-to-main');
    if (btn && !btn.classList.contains('visible')) {
      btn.classList.add('visible');
      console.log('🏠 Back button shown after ' + state.toggleCount + ' toggles');
    }
  }
}

/* ============================================================
   Handle number display
   ============================================================ */
function updateHandleNumber(num) {
  var el = document.getElementById('handle-number');
  if (el) {
    el.textContent = num;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
}

/* ============================================================
   Reset ring to dim
   ============================================================ */
function resetRingGlow() {
  var el = document.getElementById('ring-track');
  if (el) {
    el.style.borderColor = CONFIG.ringColor.base;
    el.style.boxShadow = 'none';
  }
}

/* ============================================================
   Ring drag state
   ============================================================ */
var ringDrag = { isActive: false, lastAngle: 0, currentRotation: 0 };

/* ============================================================
   Progressive vibration — intensifies as ring nears checkpoint
   ============================================================ */
var ProximityVibrator = (function() {
  var timer = null;
  var active = false;

  function start(dist, feedbackRange) {
    if (!active) return;
    clearTimeout(timer);
    // t: 0 = at edge of range, 1 = at target
    var t = Math.max(0, Math.min(1, 1 - dist / feedbackRange));
    if (t < 0.15) {
      return;
    }
    // Android: pulsed vibration
    var vibDur = Math.round(10 + t * 40);
    var pause = Math.round(500 - t * 440);
    triggerVibration(vibDur);
    timer = setTimeout(function() {
      start(dist, feedbackRange);
    }, vibDur + pause);
  }

  function activate() { active = true; }
  function deactivate() {
    active = false;
    clearTimeout(timer);
  }
  function update(dist, feedbackRange) {
    if (!active) return;
    clearTimeout(timer);
    start(dist, feedbackRange);
  }

  return { activate: activate, deactivate: deactivate, update: update };
})();

/* ============================================================
   Process rotation — core safecracking logic
   ============================================================ */
function processRotation(angle) {
  if (state.isBouncing) return;
  var holder = document.getElementById('model-holder');
  if (!holder) return;

  var rot = holder.getAttribute('rotation') || { x: 0, y: 0, z: 0 };
  holder.setAttribute('rotation', { x: rot.x, y: angle, z: rot.z });

  if (!state.hasStarted && Math.abs(angle) > 1) {
    state.hasStarted = true;
    console.log('🔄 Rotation started');
    HintSystem.hide();
  }

  state.currentRotationY = angle;

  // Safecracking feedback
  if (state.checkpointLocked || state.isBouncing) return;
  if (state.startCheckpointDistance <= 0) return;

  var dist = angleDist(normalizeAngle(ringDrag.currentRotation), state.currentCheckpointAngle);
  var feedbackRange = CONFIG.feedback.feedbackRange;
  var tolerance = CONFIG.checkpoint.tolerances[state.currentCheck] || 5;

  // Update ring glow
  updateRingGlow(dist, feedbackRange, CONFIG);

  // Tick scheduling + progressive vibration
  if (dist <= feedbackRange) {
    if (!state.lastFeedbackActive) {
      state.lastFeedbackActive = true;
      TickScheduler.activate();
      ProximityVibrator.activate();
    }
    TickScheduler.update(dist, feedbackRange, CONFIG);
    ProximityVibrator.update(dist, feedbackRange);
    HintSystem.resetInactivity(CONFIG.feedback);
  } else {
    if (state.lastFeedbackActive) {
      state.lastFeedbackActive = false;
      TickScheduler.deactivate();
      ProximityVibrator.deactivate();
    }
  }

  // Checkpoint reached?
  if (dist <= tolerance) {
    reachCheckpoint();
  }
}

/* ============================================================
   Checkpoint reached — trigger feedback + bounce
   ============================================================ */
function reachCheckpoint() {
  if (state.checkpointLocked) return;
  state.checkpointLocked = true;

  TickScheduler.deactivate();
  ProximityVibrator.deactivate();
  state.lastFeedbackActive = false;

  var idx = state.currentCheck;
  var isFinal = (idx === 2);
  console.log('🎯 Checkpoint ' + (idx + 1) + '/3 reached!');

  // Audio feedback — always play 咔擦 click, final also plays bolt mechanism
  SafeCrackAudio.playUnlockChord();
  if (isFinal) {
    SafeCrackAudio.playFinalUnlock();
  }

  // Vibration
  if (isFinal) {
    triggerVibration(CONFIG.feedback.vibration.final);
  } else {
    triggerVibration(CONFIG.feedback.vibration.checkpoint);
  }

  // Ring reached color
  var ringEl = document.getElementById('ring-track');
  if (ringEl) {
    ringEl.style.borderColor = CONFIG.ringColor.reached;
    ringEl.style.boxShadow = '0 0 30px rgba(147, 51, 234, 0.8), inset 0 0 15px rgba(147, 51, 234, 0.4)';
  }

  // Star burst
  var burst = document.getElementById('sprite-burst-overlay');
  if (burst) {
    burst.classList.remove('active');
    void burst.offsetWidth;
    burst.classList.add('active');
    setTimeout(function() {
      burst.classList.remove('active');
      burst.style.opacity = '0';
      burst.style.visibility = 'hidden';
    }, 1200);
  }

  // Handle number
  state.handleNumber = idx + 1;
  updateHandleNumber(state.handleNumber);

  // Bounce animation + model swap
  doBounce(isFinal, function() {
    if (isFinal) {
      state.currentCheck = 0;
      state.handleNumber = 0;
      updateHandleNumber(0);
      state.firstRevealDone = true;
    } else {
      state.currentCheck++;
    }
    setTimeout(function() {
      generateCheckpoint();
      state.checkpointLocked = false;
      state.isBouncing = false;
      resetRingGlow();
      console.log('⏭️ Ready for checkpoint ' + (state.currentCheck + 1) + '/3 (target: ' + state.currentCheckpointAngle + '°)');
    }, CONFIG.checkpoint.resetDelay);
  });
}

/* ============================================================
   Bounce animation (preserved from original)
   ============================================================ */
function doBounce(doSwap, callback) {
  state.isBouncing = true;
  var cfg = CONFIG.bounce;
  var holder = document.getElementById('model-holder');
  if (!holder) { if (callback) callback(); return; }
  var pos = holder.getAttribute('position') || { x: 0, y: 0, z: 0 };
  state.baseModelY = pos.y;
  var bounceIdx = 0;

  function nextBounce() {
    if (bounceIdx >= cfg.bounceCount) {
      holder.setAttribute('scale', '1 1 1');
      if (callback) callback();
      return;
    }
    var height = cfg.initialHeight * Math.pow(cfg.damping, bounceIdx);
    var ss = cfg.squashStretch[bounceIdx] || cfg.squashStretch[cfg.squashStretch.length - 1];
    var dur = cfg.bounceDuration;
    var isLast = doSwap && bounceIdx === cfg.bounceCount - 1;
    var startTime = performance.now();
    state._switchDone = false;

    requestAnimationFrame(function animate(now) {
      var elapsed = now - startTime;
      var progress = Math.min(1, elapsed / dur);
      var y, sy, sxz;

      if (progress < 0.5) {
        var t = progress / 0.5;
        var ease = 1 - (1 - t) * (1 - t);
        y = state.baseModelY + height * ease;
        var sinT = Math.sin(t * Math.PI);
        sy = 1 + (ss.stretchY - 1) * sinT;
        sxz = 1 + (ss.stretchXZ - 1) * sinT;
      } else {
        var t2 = (progress - 0.5) / 0.5;
        var ease2 = t2 * t2;
        y = state.baseModelY + height * (1 - ease2);
        if (isLast && t2 > 0.95 && !state._switchDone) {
          state._switchDone = true;
          toggleModel();
        }
        if (t2 > 0.85) {
          var k = (t2 - 0.85) / 0.15;
          sy = 1 + (ss.squashY - 1) * k;
          sxz = 1 + (ss.squashXZ - 1) * k;
        } else {
          sy = 1; sxz = 1;
        }
      }

      var curPos = holder.getAttribute('position');
      holder.setAttribute('position', { x: curPos.x, y: y, z: curPos.z });
      var activeModel = state.showingFictional ? state.fictionalModel : state.realModel;
      if (activeModel) activeModel.setAttribute('scale', (0.5 * sxz) + ' ' + (0.5 * sy) + ' ' + (0.5 * sxz));

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        if (isLast && !state._switchDone) {
          state._switchDone = true;
          toggleModel();
        }
        holder.setAttribute('position', { x: curPos.x, y: state.baseModelY, z: curPos.z });
        // Settle animation
        settleModel(activeModel, ss, function() {
          bounceIdx++;
          nextBounce();
        });
      }
    });
  }
  nextBounce();
}

function settleModel(model, ss, callback) {
  var startTime = performance.now();
  var baseScale = 0.5;
  requestAnimationFrame(function settle(now) {
    var elapsed = now - startTime;
    var t = Math.min(1, elapsed / 150);
    var ease = 1 - (1 - t) * (1 - t);
    var sy = baseScale * (ss.squashY + (1 - ss.squashY) * ease);
    var sxz = baseScale * (ss.squashXZ + (1 - ss.squashXZ) * ease);
    if (model) model.setAttribute('scale', sxz + ' ' + sy + ' ' + sxz);
    if (t < 1) {
      requestAnimationFrame(settle);
    } else {
      if (model) model.setAttribute('scale', baseScale + ' ' + baseScale + ' ' + baseScale);
      if (callback) callback();
    }
  });
}

/* ============================================================
   Angle calculation for ring drag
   ============================================================ */
function getAngle(x, y, el) {
  var rect = el.getBoundingClientRect();
  var cx = rect.left + rect.width / 2;
  var cy = rect.top + rect.width / 2;
  return Math.atan2(y - cy, x - cx) * (180 / Math.PI);
}

/* ============================================================
   Update ring visual rotation
   ============================================================ */
function rotateRingUI(angle) {
  var container = document.getElementById('ring-container');
  var numEl = document.getElementById('handle-number');
  if (container) {
    container.style.transform = 'translate(-50%, -50%) rotate(' + (-angle) + 'deg)';
    if (numEl) numEl.style.transform = 'rotate(' + angle + 'deg)';
  }
}

/* ============================================================
   A-Frame components
   ============================================================ */
AFRAME.registerComponent('rotation-monitor', {
  schema: { enabled: { type: 'boolean', default: true } },
  tick: function() {}
});

/* ============================================================
   Pre-AR overlay controller
   ============================================================ */
var preArOverlay = {
  _safetyTimer: null,
  _dismissed: false,
  setStatus: function(text) {
    var el = document.getElementById('pre-ar-status');
    if (el) el.textContent = text;
  },
  enableStart: function() {
    var btn = document.getElementById('enter-ar-button');
    if (btn) { btn.textContent = 'Start AR'; btn.disabled = false; }
    this.setStatus('Model ready — tap to enter AR');
  },
  dismissOverlay: function() {
    if (this._dismissed) return;
    this._dismissed = true;
    if (this._safetyTimer) { clearTimeout(this._safetyTimer); this._safetyTimer = null; }
    var overlay = document.getElementById('pre-ar-overlay');
    if (overlay) overlay.classList.add('is-hidden');
    var ring = document.getElementById('ring-container');
    if (ring) ring.classList.remove('ar-ui-hidden');
    var hint = document.getElementById('ar-hint');
    if (hint) hint.classList.remove('ar-ui-hidden');
    generateCheckpoint();

    // Show initial safecracking hint
    HintSystem.show(CONFIG.feedback.hints.initial, CONFIG.feedback.hints.initialDuration);
    HintSystem.resetInactivity(CONFIG.feedback);
  },
  _showOverlay: function() {
    var overlay = document.getElementById('pre-ar-overlay');
    if (overlay) overlay.classList.remove('is-hidden');
    this._dismissed = false;
  },
  bind: function(sceneEl) {
    var self = this;
    self._dismissed = false;
    var btn = document.getElementById('enter-ar-button');
    if (!btn) return;
    btn.addEventListener('click', function() {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Starting AR…';

      // Initialize audio on user gesture (required for iOS)
      SafeCrackAudio.init();

      sceneEl.emit('runreality');
      if (self._safetyTimer) clearTimeout(self._safetyTimer);
      self._safetyTimer = setTimeout(function() { self.dismissOverlay(); }, 5000);
    });
    sceneEl.addEventListener('realityready', function() { self.dismissOverlay(); });
    sceneEl.addEventListener('realityerror', function() {
      if (self._safetyTimer) { clearTimeout(self._safetyTimer); self._safetyTimer = null; }
      self._showOverlay();
      btn.textContent = 'AR Failed — Retry';
      btn.disabled = false;
      self.setStatus('AR failed to start.\nPlease check camera permissions.');
    });
  }
};

/* ============================================================
   Main A-Frame component: rotate-ar-interaction
   ============================================================ */
AFRAME.registerComponent('rotate-ar-interaction', {
  init: function() {
    var self = this;
    console.log('🎮 RotateItem AR Interaction initializing (Safecracking)...');

    preArOverlay.bind(this.el);
    ui.init();
    ui.setStatus('Loading models...', 'waiting');

    // Parse URL params or use test config
    var params = (function() {
      var sp = new URLSearchParams(window.location.search);
      if (testConfig.enabled) {
        return { realGlb: testConfig.realGlb, fictionalGlb: testConfig.fictionalGlb, interaction: 'Rotate', itemName: testConfig.itemName, realName: testConfig.realName || 'Real Item' };
      }
      return {
        realGlb: sp.get('real_glb'),
        fictionalGlb: sp.get('fictional_glb'),
        interaction: sp.get('interaction') || 'Rotate',
        itemName: sp.get('item_name') || 'Fictional Item',
        realName: sp.get('real_name') || 'Real Item'
      };
    })();

    if (!params.realGlb || !params.fictionalGlb) {
      console.error('❌ Missing model URL parameters');
      ui.setStatus('Error: No model URLs provided', 'error');
      return;
    }

    state.realGlbUrl = params.realGlb;
    state.fictionalGlbUrl = params.fictionalGlb;
    state.itemName = params.itemName;
    state.realName = params.realName;

    this.el.addEventListener('loaded', function() {
      console.log('📦 Scene loaded');
      generateCheckpoint();
      state.currentCheck = 0;
      state.handleNumber = 0;
      state.showingFictional = false;
      state.firstRevealDone = false;

      self.loadModels();
      setupRingRotation();
      setupModelDrag();
      ui.show();
      resetRingGlow();
      updateHandleNumber(0);
      setupStarBlinks();
    });
  },

  loadModels: function() {
    state.realModel = document.getElementById('realModel');
    state.fictionalModel = document.getElementById('fictionalModel');
    if (!state.realModel || !state.fictionalModel) {
      console.error('❌ Model entities not found!');
      return;
    }
    console.log('📦 Loading Real model...');
    console.log('📦 Loading Fictional model...');
    state.realModel.setAttribute('gltf-model', state.realGlbUrl);
    state.fictionalModel.setAttribute('gltf-model', state.fictionalGlbUrl);

    state.realModel.addEventListener('model-loaded', function() {
      console.log('✅ Real model loaded');
      setModelOpacity(state.realModel, 1);
      setModelVisible(state.realModel, true);
      ui.setStatus('Turn the ring to rotate ✨', 'waiting');
      preArOverlay.enableStart();
    });
    state.fictionalModel.addEventListener('model-loaded', function() {
      console.log('✅ Fictional model loaded');
      setModelVisible(state.fictionalModel, false);
      setModelOpacity(state.fictionalModel, 0);
    });
    state.realModel.addEventListener('model-error', function(e) {
      console.error('❌ Real model load error:', e);
      ui.setStatus('Error loading real model', 'error');
    });
    state.fictionalModel.addEventListener('model-error', function(e) {
      console.error('❌ Fictional model load error:', e);
      ui.setStatus('Error loading fictional model', 'error');
    });
  }
});

/* ============================================================
   Ring rotation control setup
   ============================================================ */
function setupRingRotation() {
  var container = document.getElementById('ring-container');
  var track = document.getElementById('ring-track');
  var handle = document.getElementById('ring-handle');
  if (!container || !track) { console.error('❌ Ring elements not found!'); return; }

  rotateRingUI(0);

  function onTouchStart(e) {
    if (state.isBouncing) return;
    e.preventDefault();
    e.stopPropagation();
    var touch = e.touches[0];
    ringDrag.isActive = true;
    ringDrag.lastAngle = getAngle(touch.clientX, touch.clientY, container);
    ringDrag.currentRotation = state.currentRotationY;
  }

  function onMouseDown(e) {
    if (state.isBouncing) return;
    e.preventDefault();
    ringDrag.isActive = true;
    ringDrag.lastAngle = getAngle(e.clientX, e.clientY, container);
    ringDrag.currentRotation = state.currentRotationY;
    container.style.cursor = 'grabbing';
  }

  track.addEventListener('touchstart', onTouchStart, { passive: false });
  if (handle) handle.addEventListener('touchstart', onTouchStart, { passive: false });

  document.addEventListener('touchmove', function(e) {
    if (!ringDrag.isActive || state.isBouncing) return;
    e.preventDefault();
    var touch = e.touches[0];
    var angle = getAngle(touch.clientX, touch.clientY, container);
    var delta = angle - ringDrag.lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    ringDrag.lastAngle = angle;
    ringDrag.currentRotation -= delta;
    rotateRingUI(ringDrag.currentRotation);
    processRotation(ringDrag.currentRotation);
  }, { passive: false });

  document.addEventListener('touchend', function() {
    if (ringDrag.isActive) { ringDrag.isActive = false; }
  });

  track.addEventListener('mousedown', onMouseDown);
  if (handle) handle.addEventListener('mousedown', onMouseDown);

  document.addEventListener('mousemove', function(e) {
    if (!ringDrag.isActive || state.isBouncing) return;
    var angle = getAngle(e.clientX, e.clientY, container);
    var delta = angle - ringDrag.lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    ringDrag.lastAngle = angle;
    ringDrag.currentRotation -= delta;
    rotateRingUI(ringDrag.currentRotation);
    processRotation(ringDrag.currentRotation);
  });

  document.addEventListener('mouseup', function() {
    if (ringDrag.isActive) {
      ringDrag.isActive = false;
      container.style.cursor = 'grab';
    }
  });

  console.log('✅ Ring rotation control setup complete');
}

/* ============================================================
   Model drag (position) setup
   ============================================================ */
function setupModelDrag() {
  var scene = document.querySelector('a-scene');
  var holder = document.getElementById('position-holder');
  if (!holder) { console.error('❌ Position holder not found!'); return; }
  state.positionHolder = holder;
  var ringContainer = document.getElementById('ring-container');

  function isInsideRing(touch) {
    if (!ringContainer) return false;
    var r = ringContainer.getBoundingClientRect();
    return touch.clientX >= r.left && touch.clientX <= r.right && touch.clientY >= r.top && touch.clientY <= r.bottom;
  }

  scene.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1 && !isInsideRing(e.touches[0]) && !ringDrag.isActive) {
      var touch = e.touches[0];
      var pos = holder.getAttribute('position');
      dragState.isActive = true;
      dragState.startX = touch.clientX;
      dragState.startY = touch.clientY;
      dragState.startModelX = pos.x;
      dragState.startModelZ = pos.z;
    }
  });

  scene.addEventListener('touchmove', function(e) {
    if (e.touches.length !== 1) { dragState.isActive = false; return; }
    if (!dragState.isActive) return;
    if (ringDrag.isActive) { dragState.isActive = false; return; }
    var touch = e.touches[0];
    var dx = 0.005 * (touch.clientX - dragState.startX);
    var dz = 0.005 * (touch.clientY - dragState.startY);
    var pos = holder.getAttribute('position');
    holder.setAttribute('position', { x: dragState.startModelX + dx, y: pos.y, z: dragState.startModelZ + dz });
  });

  scene.addEventListener('touchend', function() { dragState.isActive = false; });
  console.log('✅ Single finger drag control setup complete');
}

/* ============================================================
   Star blink particles (preserved from original)
   ============================================================ */
var starState = { blinkStars: [], blinkInterval: null, maxStars: 6 };

function spawnStar() {
  var container = document.getElementById('star-blink-container');
  if (!container || starState.blinkStars.length >= starState.maxStars) return;
  var el = document.createElement('div');
  el.className = 'star-blink';
  var sizes = ['star-sm', 'star-md', 'star-lg'];
  el.classList.add(sizes[Math.floor(Math.random() * sizes.length)]);
  var x, y;
  switch (Math.floor(Math.random() * 4)) {
    case 0: x = Math.random() * 90 + 5; y = Math.random() * 25 + 5; break;
    case 1: x = Math.random() * 90 + 5; y = Math.random() * 20 + 70; break;
    case 2: x = Math.random() * 20 + 3; y = Math.random() * 60 + 20; break;
    case 3: x = Math.random() * 20 + 75; y = Math.random() * 60 + 20; break;
  }
  el.style.left = x + '%';
  el.style.top = y + '%';
  var dur = 2 + Math.random() * 2;
  var delay = Math.random() * 1;
  el.style.setProperty('--star-duration', dur + 's');
  el.style.setProperty('--star-delay', delay + 's');
  container.appendChild(el);
  starState.blinkStars.push(el);
  setTimeout(function() {
    if (el.parentNode) el.parentNode.removeChild(el);
    var idx = starState.blinkStars.indexOf(el);
    if (idx !== -1) starState.blinkStars.splice(idx, 1);
  }, (dur + delay) * 1000 + 200);
}

function setupStarBlinks() {
  for (var i = 0; i < 3; i++) {
    setTimeout(spawnStar, 400 * i);
  }
  starState.blinkInterval = setInterval(spawnStar, 1500);
  console.log('✨ Floating star blinks started');
}

})();