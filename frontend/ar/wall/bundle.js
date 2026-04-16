(()=>{"use strict";

/* ============================================================
   Vibration helper (Android only — iOS not supported)
   ============================================================ */
function triggerVibration(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch(e) {}
  }
}

/* ============================================================
   Wall hint system
   ============================================================ */
const HintSystem = (function() {
  let inactivityTimer = null;
  let hintEl = null;

  function getEl() {
    if (!hintEl) hintEl = document.getElementById('wall-hint');
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
      show(cfg.inactivity, 3000);
    }, cfg.inactivityTimeout);
  }

  function stopInactivity() {
    clearTimeout(inactivityTimer);
  }

  return { show: show, hide: hide, resetInactivity: resetInactivity, stopInactivity: stopInactivity };
})();

console.log("✅ Wall AR Interaction loaded");

/* ============================================================
   Test mode config
   ============================================================ */
var testConfig = {
  enabled: true,
  realGlb: '../rotate/assets/realmodel.glb',
  fictionalGlb: '../rotate/assets/fictionalmodel.glb',
  itemName: 'Test Fictional Item',
  realName: 'Test Real Item'
};

/* ============================================================
   Merge WALL_CONFIG from ar-config.js
   ============================================================ */
var CONFIG = (function() {
  var defaults = {
    wall: { defaultPosition: [0, 1.5, -3], defaultScale: [3, 2, 1], opacity: 0.3, color: '#FFFFFF', edgeColor: 'rgba(255,255,255,0.6)', gridVisible: false },
    slam: { placeDistance: 2.5, autoOrient: true },
    joystick: { speed: 0.03, deadzone: 0.1 },
    portal: { openDuration: 1500, radius: 0.8, revealDelay: 300, modelEntryDuration: 800 },
    feedback: { confirmVibration: [100, 50, 200], portalVibration: [200, 100, 200, 100, 400], placeVibration: [50] },
    animation: { wallFadeDuration: 600, wallFadeInDuration: 400, modelScaleFrom: 0.01, modelScaleTo: 0.5, easing: 'easeOutBack' },
    hints: { initial: 'Point camera at wall, then tap Place', afterPlace: 'Fine-tune with controls, then confirm', inactivity: 'Point camera at wall and tap Place', initialDuration: 4000, inactivityTimeout: 12000 }
  };
  var ext = window.WALL_CONFIG;
  if (!ext || typeof ext !== 'object') return defaults;
  var merged = {};
  Object.keys(defaults).forEach(function(k) {
    if (defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k]) && ext[k] && typeof ext[k] === 'object' && !Array.isArray(ext[k])) {
      merged[k] = Object.assign({}, defaults[k], ext[k]);
    } else {
      merged[k] = k in ext ? ext[k] : defaults[k];
    }
  });
  console.log('⚙️ WALL_CONFIG merged', merged);
  return merged;
})();

/* ============================================================
   State machine: idle → dragging → confirmed → portal-opening → revealed → complete
   ============================================================ */
var state = {
  phase: 'scanning',  // scanning | adjusting | confirmed | portal-opening | revealed | complete
  realModel: null,
  fictionalModel: null,
  wallAnchor: null,
  portalRing: null,
  positionHolder: null,
  realGlbUrl: null,
  fictionalGlbUrl: null,
  itemName: null,
  realName: null,
  modelsLoaded: { real: false, fictional: false },
  wallPlaced: false,
  hasDragged: false,
  itemNameShown: false
};

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
      itemName: document.getElementById('item-name-display'),
      confirmBtn: document.getElementById('cta-btn')
    };
    console.log('🎨 UI initialized');
  },
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
  },
  showCta: function() {
    if (this.elements.confirmBtn) this.elements.confirmBtn.classList.add('visible');
  },
  hideCta: function() {
    if (this.elements.confirmBtn) {
      this.elements.confirmBtn.classList.remove('visible');
      this.elements.confirmBtn.classList.remove('reset-mode');
    }
  },
  setConfirmed: function() {
    // no-op — CTA button handles its own state
  }
};

/* ============================================================
   Model visibility helpers (same pattern as rotate)
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
   Portal reveal animation
   ============================================================ */
function runPortalReveal() {
  state.phase = 'portal-opening';
  console.log('🌀 Portal opening...');

  var portalRing = state.portalRing;
  var wallAnchor = state.wallAnchor;
  var posHolder = state.positionHolder;

  if (!portalRing || !wallAnchor) {
    console.error('❌ Portal elements missing');
    return;
  }

  // Position portal ring at same position as wall
  var wallPos = wallAnchor.getAttribute('position');
  var wallRot = wallAnchor.getAttribute('rotation');
  portalRing.setAttribute('position', { x: wallPos.x, y: wallPos.y, z: wallPos.z + 0.01 });
  portalRing.setAttribute('rotation', { x: wallRot.x, y: wallRot.y, z: wallRot.z });
  portalRing.setAttribute('visible', true);

  // Position model holder behind wall
  if (posHolder) {
    // Offset slightly behind the wall along its normal
    var radY = (wallRot.y || 0) * Math.PI / 180;
    var offsetZ = -0.3;
    posHolder.setAttribute('position', {
      x: wallPos.x - Math.sin(radY) * offsetZ,
      y: wallPos.y,
      z: wallPos.z + Math.cos(radY) * offsetZ
    });
  }

  // Flash overlay
  var flash = document.getElementById('portal-flash');
  if (flash) {
    flash.classList.add('active');
    setTimeout(function() { flash.classList.remove('active'); }, 600);
  }

  // Vibration
  triggerVibration(CONFIG.feedback.portalVibration);

  // Animate portal ring expanding
  var startTime = performance.now();
  var duration = CONFIG.portal.openDuration;
  var targetRadius = CONFIG.portal.radius;

  requestAnimationFrame(function animatePortal(now) {
    var elapsed = now - startTime;
    var t = Math.min(1, elapsed / duration);
    // Ease out cubic
    var eased = 1 - Math.pow(1 - t, 3);

    var currentRadius = targetRadius * eased;
    portalRing.setAttribute('radius-outer', currentRadius);
    portalRing.setAttribute('radius-inner', currentRadius * 0.85);

    // Keep wall visible — no opacity fade during portal

    if (t < 1) {
      requestAnimationFrame(animatePortal);
    } else {
      // Portal fully open — skip model reveal, go straight to complete
      setTimeout(function() { onRevealComplete(); }, CONFIG.portal.revealDelay);
    }
  });
}

/* ============================================================
   Reveal complete — fade wall fully, show back button
   ============================================================ */
function onRevealComplete() {
  state.phase = 'complete';
  console.log('🎉 Wall interaction complete!');

  // Show CTA as Reset for further tweaking
  var ctaBtn = document.getElementById('cta-btn');
  if (ctaBtn) {
    ctaBtn.textContent = '🔄 Reset';
    ctaBtn.classList.add('visible', 'reset-mode');
  }
}

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
    var hint = document.getElementById('ar-hint');
    if (hint) hint.classList.remove('ar-ui-hidden');
    // Enter scanning mode — show crosshair + place button
    enterScanningMode();
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
   Main A-Frame component: wall-ar-interaction
   ============================================================ */
AFRAME.registerComponent('wall-ar-interaction', {
  init: function() {
    var self = this;
    console.log('🧱 Wall AR Interaction initializing...');

    preArOverlay.bind(this.el);
    ui.init();
    ui.setStatus('Loading models...', 'waiting');

    // Parse URL params or use test config
    var params = (function() {
      var sp = new URLSearchParams(window.location.search);
      if (testConfig.enabled && !sp.get('real_glb')) {
        return { realGlb: testConfig.realGlb, fictionalGlb: testConfig.fictionalGlb, interaction: 'Wall', itemName: testConfig.itemName, realName: testConfig.realName || 'Real Item' };
      }
      return {
        realGlb: sp.get('real_glb'),
        fictionalGlb: sp.get('fictional_glb'),
        interaction: sp.get('interaction') || 'Wall',
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

      state.wallAnchor = document.getElementById('wall-anchor');
      state.portalRing = document.getElementById('portal-ring');
      state.positionHolder = document.getElementById('position-holder');

      self.loadModels();
      setupJoystick();
      setupDepthSlider();
      setupRotationSlider();
      setupCtaButton();
      setupPlaceButton();
      // Wall starts hidden — user must place it via camera
      var wallAnchor = document.getElementById('wall-anchor');
      if (wallAnchor) wallAnchor.setAttribute('visible', false);
    });
  },

  loadModels: function() {
    state.realModel = document.getElementById('realModel');
    state.fictionalModel = document.getElementById('fictionalModel');
    if (!state.realModel || !state.fictionalModel) {
      console.error('❌ Model entities not found!');
      return;
    }
    console.log('📦 Loading Real model:', state.realGlbUrl);
    console.log('📦 Loading Fictional model:', state.fictionalGlbUrl);
    state.realModel.setAttribute('gltf-model', state.realGlbUrl);
    state.fictionalModel.setAttribute('gltf-model', state.fictionalGlbUrl);

    state.realModel.addEventListener('model-loaded', function() {
      console.log('✅ Real model loaded');
      state.modelsLoaded.real = true;
      // Real model stays hidden initially (fictional reveals through portal)
      setModelVisible(state.realModel, false);
      setModelOpacity(state.realModel, 0);
      checkAllModelsLoaded();
    });
    state.fictionalModel.addEventListener('model-loaded', function() {
      console.log('✅ Fictional model loaded');
      state.modelsLoaded.fictional = true;
      setModelVisible(state.fictionalModel, false);
      setModelOpacity(state.fictionalModel, 0);
      checkAllModelsLoaded();
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

function checkAllModelsLoaded() {
  if (state.modelsLoaded.real && state.modelsLoaded.fictional) {
    ui.setStatus('Models loaded ✨', 'waiting');
    preArOverlay.enableStart();
  }
}

/* ============================================================
   Place wall immediately at default position (used internally)
   ============================================================ */
function placeWallImmediately() {
  var wallAnchor = document.getElementById('wall-anchor');
  if (!wallAnchor) return;

  var defPos = CONFIG.wall.defaultPosition;
  wallAnchor.setAttribute('position', { x: defPos[0], y: defPos[1], z: defPos[2] });
  wallAnchor.setAttribute('rotation', { x: 0, y: 0, z: 0 });
  wallAnchor.setAttribute('visible', true);

  // Vibration feedback
  triggerVibration(CONFIG.feedback.placeVibration);

  // Update state
  state.wallPlaced = true;
  state.phase = 'adjusting';

  // Sync depth slider
  var depthSlider = document.getElementById('depth-slider');
  if (depthSlider) depthSlider.value = defPos[2];

  // Show controls
  showWallControls();
  ui.showCta();

  // Update subtitle
  var subtitle = document.getElementById('interaction-hint');
  if (subtitle) subtitle.textContent = CONFIG.hints.afterPlace;

  console.log('📍 Wall placed at default position');
}

/* ============================================================
   SLAM: Place wall using 8th Wall hitTest API
   ============================================================ */
var hitTestState = {
  scanning: false,
  scanAnimId: null,
  lastHit: null,        // latest hitTest result for preview
  hitCount: 0,          // consecutive frames with hits (for confidence)
  requiredHits: 3       // frames needed before showing preview
};

function placeWallFromHitTest() {
  var wallAnchor = document.getElementById('wall-anchor');
  if (!wallAnchor) return;

  // Use stored hit or do a fresh hitTest at screen center
  var hit = hitTestState.lastHit;
  if (!hit) {
    // Fallback: try one more hitTest
    try {
      var hitTypes = (CONFIG.slam && CONFIG.slam.hitTypes) || ['FEATURE_POINT', 'ESTIMATED_SURFACE', 'DETECTED_SURFACE'];
      var hits = XR8.XrController.hitTest(0.5, 0.5, hitTypes);
      if (hits.length > 0) hit = hits[0];
    } catch(e) {
      console.warn('⚠️ hitTest failed, using camera fallback', e);
    }
  }

  if (hit) {
    // === HitTest placement ===
    var pos = hit.position;
    var rot = hit.rotation; // quaternion {x,y,z,w} — surface normal orientation

    // Convert quaternion to Euler Y rotation for the wall
    // The hit rotation represents the surface normal orientation
    var q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    var euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    var wallRotY = euler.y * (180 / Math.PI);

    wallAnchor.setAttribute('position', { x: pos.x, y: pos.y, z: pos.z });
    wallAnchor.setAttribute('rotation', { x: 0, y: wallRotY, z: 0 });

    console.log('📍 Wall placed via hitTest:', hit.type, 'dist:', hit.distance.toFixed(2) + 'm', 'pos:', pos);

    // Position model holder behind wall along surface normal
    if (state.positionHolder) {
      var radY = wallRotY * Math.PI / 180;
      var offsetZ = -0.3;
      state.positionHolder.setAttribute('position', {
        x: pos.x - Math.sin(radY) * offsetZ,
        y: pos.y,
        z: pos.z + Math.cos(radY) * offsetZ
      });
    }

    // Sync sliders
    var depthSlider = document.getElementById('depth-slider');
    if (depthSlider) depthSlider.value = Math.max(-6, Math.min(0, pos.z));
    var depthVal = document.getElementById('depth-val');
    if (depthVal) depthVal.textContent = pos.z.toFixed(1);
    var rotSlider = document.getElementById('rotation-slider');
    if (rotSlider) rotSlider.value = ((wallRotY % 360) + 360) % 360;
    var rotVal = document.getElementById('rotation-val');
    if (rotVal) rotVal.textContent = Math.round(((wallRotY % 360) + 360) % 360) + '°';

  } else {
    // === Fallback: camera-forward placement ===
    console.log('📍 No hitTest result, using camera-forward fallback');
    placeWallFromCameraFallback();
    return;
  }

  wallAnchor.setAttribute('visible', true);

  // Fade wall in
  var wallPlane = document.getElementById('wall-plane');
  var wallEdge = document.getElementById('wall-edge');
  if (wallPlane) {
    wallPlane.setAttribute('material', 'opacity', 0);
    var fadeStart = performance.now();
    var fadeDuration = CONFIG.animation.wallFadeInDuration || 400;
    var targetOpacity = CONFIG.wall.opacity || 0.35;
    requestAnimationFrame(function fadeIn(now) {
      var t = Math.min(1, (now - fadeStart) / fadeDuration);
      var easedT = t * (2 - t);
      wallPlane.setAttribute('material', 'opacity', easedT * targetOpacity);
      if (wallEdge) wallEdge.setAttribute('material', 'opacity', easedT * 0.6);
      if (t < 1) requestAnimationFrame(fadeIn);
    });
  }

  // Vibration feedback
  triggerVibration(CONFIG.feedback.placeVibration);

  // Update state
  state.wallPlaced = true;
  state.phase = 'adjusting';

  // Stop scanning loop
  stopHitTestScanning();

  // Hide scanning UI, show control UI
  hideScanningUI();
  showWallControls();
  ui.showCta();
  HintSystem.show(CONFIG.hints.afterPlace, CONFIG.hints.initialDuration);
  HintSystem.resetInactivity(CONFIG.hints);

  var subtitle = document.getElementById('interaction-hint');
  if (subtitle) subtitle.textContent = CONFIG.hints.afterPlace;
}

/* ============================================================
   Camera-forward fallback (when hitTest unavailable)
   ============================================================ */
function placeWallFromCameraFallback() {
  var camera = document.getElementById('camera');
  var wallAnchor = document.getElementById('wall-anchor');
  if (!camera || !wallAnchor || !camera.object3D) return;

  var cam3D = camera.object3D;
  var slamCfg = CONFIG.slam || { placeDistance: 2.5 };

  var camPos = new THREE.Vector3();
  cam3D.getWorldPosition(camPos);
  var camQuat = new THREE.Quaternion();
  cam3D.getWorldQuaternion(camQuat);
  var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat).normalize();
  var placePos = new THREE.Vector3().copy(camPos).addScaledVector(forward, slamCfg.placeDistance);
  var wallRotY = Math.atan2(-forward.x, -forward.z) * (180 / Math.PI);

  wallAnchor.setAttribute('position', { x: placePos.x, y: placePos.y, z: placePos.z });
  wallAnchor.setAttribute('rotation', { x: 0, y: wallRotY, z: 0 });
  wallAnchor.setAttribute('visible', true);

  // Fade wall in
  var wallPlane = document.getElementById('wall-plane');
  var wallEdge = document.getElementById('wall-edge');
  if (wallPlane) {
    wallPlane.setAttribute('material', 'opacity', 0);
    var fadeStart = performance.now();
    var fadeDuration = CONFIG.animation.wallFadeInDuration || 400;
    var targetOpacity = CONFIG.wall.opacity || 0.35;
    requestAnimationFrame(function fadeIn(now) {
      var t = Math.min(1, (now - fadeStart) / fadeDuration);
      var easedT = t * (2 - t);
      wallPlane.setAttribute('material', 'opacity', easedT * targetOpacity);
      if (wallEdge) wallEdge.setAttribute('material', 'opacity', easedT * 0.6);
      if (t < 1) requestAnimationFrame(fadeIn);
    });
  }

  if (state.positionHolder) {
    var radY = wallRotY * Math.PI / 180;
    var offsetZ = -0.3;
    state.positionHolder.setAttribute('position', {
      x: placePos.x - Math.sin(radY) * offsetZ,
      y: placePos.y,
      z: placePos.z + Math.cos(radY) * offsetZ
    });
  }

  triggerVibration(CONFIG.feedback.placeVibration);
  state.wallPlaced = true;
  state.phase = 'adjusting';
  stopHitTestScanning();
  hideScanningUI();
  showWallControls();
  ui.showCta();
  HintSystem.show(CONFIG.hints.afterPlace, CONFIG.hints.initialDuration);
  HintSystem.resetInactivity(CONFIG.hints);

  var subtitle = document.getElementById('interaction-hint');
  if (subtitle) subtitle.textContent = CONFIG.hints.afterPlace;

  var depthSlider = document.getElementById('depth-slider');
  if (depthSlider) depthSlider.value = Math.max(-6, Math.min(0, placePos.z));
  var depthVal = document.getElementById('depth-val');
  if (depthVal) depthVal.textContent = placePos.z.toFixed(1);
  var rotSlider = document.getElementById('rotation-slider');
  if (rotSlider) rotSlider.value = ((wallRotY % 360) + 360) % 360;
  var rotVal = document.getElementById('rotation-val');
  if (rotVal) rotVal.textContent = Math.round(((wallRotY % 360) + 360) % 360) + '°';

  console.log('📍 Wall placed via camera fallback at', placePos);
}

/* ============================================================
   Continuous hitTest scanning loop (runs during scanning phase)
   ============================================================ */
function startHitTestScanning() {
  if (hitTestState.scanning) return;
  hitTestState.scanning = true;
  hitTestState.hitCount = 0;
  hitTestState.lastHit = null;

  var crosshair = document.getElementById('crosshair');

  function scanLoop() {
    if (!hitTestState.scanning || state.phase !== 'scanning') {
      hitTestState.scanAnimId = null;
      return;
    }

    try {
      var hitTypes = (CONFIG.slam && CONFIG.slam.hitTypes) || ['FEATURE_POINT', 'ESTIMATED_SURFACE', 'DETECTED_SURFACE'];
      var hits = XR8.XrController.hitTest(0.5, 0.5, hitTypes);
      if (hits.length > 0) {
        hitTestState.lastHit = hits[0];
        hitTestState.hitCount++;

        // Visual feedback: crosshair turns green when surface detected
        if (crosshair) {
          if (hits[0].type === 'DETECTED_SURFACE' || hits[0].type === 'ESTIMATED_SURFACE') {
            crosshair.classList.add('surface-detected');
          } else {
            crosshair.classList.add('point-detected');
            crosshair.classList.remove('surface-detected');
          }
        }
      } else {
        hitTestState.hitCount = 0;
        hitTestState.lastHit = null;
        if (crosshair) {
          crosshair.classList.remove('surface-detected', 'point-detected');
        }
      }
    } catch(e) {
      // hitTest not yet available (WASM not loaded), keep scanning
    }

    hitTestState.scanAnimId = requestAnimationFrame(scanLoop);
  }

  hitTestState.scanAnimId = requestAnimationFrame(scanLoop);
  console.log('🔍 hitTest scanning started');
}

function stopHitTestScanning() {
  hitTestState.scanning = false;
  if (hitTestState.scanAnimId) {
    cancelAnimationFrame(hitTestState.scanAnimId);
    hitTestState.scanAnimId = null;
  }
  hitTestState.lastHit = null;
  hitTestState.hitCount = 0;
}

/* ============================================================
   Scanning mode — show crosshair + place button + start hitTest
   ============================================================ */
function enterScanningMode() {
  state.phase = 'scanning';
  state.wallPlaced = false;

  // Hide wall
  var wallAnchor = document.getElementById('wall-anchor');
  if (wallAnchor) wallAnchor.setAttribute('visible', false);

  // Show scanning UI
  var crosshair = document.getElementById('crosshair');
  if (crosshair) {
    crosshair.classList.add('visible');
    crosshair.classList.remove('surface-detected', 'point-detected');
  }
  var placeBtn = document.getElementById('place-wall-btn');
  if (placeBtn) placeBtn.classList.add('visible');

  // Hide controls
  document.body.classList.add('wall-controls-hidden');
  ui.hideCta();

  // Start continuous hitTest scanning
  startHitTestScanning();

  // Show hint
  HintSystem.show(CONFIG.hints.initial, CONFIG.hints.initialDuration);
  HintSystem.resetInactivity(CONFIG.hints);

  console.log('🔍 Scanning mode — hitTest active');
}

function hideScanningUI() {
  var crosshair = document.getElementById('crosshair');
  if (crosshair) {
    crosshair.classList.remove('visible', 'surface-detected', 'point-detected');
  }
  var placeBtn = document.getElementById('place-wall-btn');
  if (placeBtn) placeBtn.classList.remove('visible');
}

/* ============================================================
   Setup Place Wall button
   ============================================================ */
function setupPlaceButton() {
  var btn = document.getElementById('place-wall-btn');
  if (!btn) return;
  btn.addEventListener('click', function() {
    if (state.phase !== 'scanning') return;
    placeWallFromHitTest();
  });
  console.log('✅ Place Wall button setup complete');
}

/* ============================================================
   Show / Hide wall controls
   ============================================================ */
function showWallControls() {
  document.body.classList.remove('wall-controls-hidden');
  var zones = ['joystick-zone', 'depth-zone', 'rotation-zone'];
  zones.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.style.opacity = '1'; el.style.pointerEvents = 'auto'; }
  });
}

function hideWallControls() {
  var zones = ['joystick-zone', 'depth-zone', 'rotation-zone'];
  zones.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; }
  });
}

/* ============================================================
   Virtual Joystick — controls wall X/Y position
   ============================================================ */
function setupJoystick() {
  var zone = document.getElementById('joystick-zone');
  var base = document.getElementById('joystick-base');
  var thumb = document.getElementById('joystick-thumb');
  var wallAnchor = document.getElementById('wall-anchor');
  if (!zone || !base || !thumb || !wallAnchor) return;

  var baseRadius = 60; // half of 120px
  var thumbRadius = 22;
  var maxDist = baseRadius - thumbRadius;
  var deadzone = CONFIG.joystick ? CONFIG.joystick.deadzone : 0.1;
  var speed = CONFIG.joystick ? CONFIG.joystick.speed : 0.03;
  var joyX = 0, joyY = 0;
  var active = false;
  var animId = null;
  var baseCenterX = 0, baseCenterY = 0;

  // Block propagation
  ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup'].forEach(function(evt) {
    zone.addEventListener(evt, function(e) { e.stopPropagation(); });
  });

  function getBaseCenter() {
    var rect = base.getBoundingClientRect();
    baseCenterX = rect.left + rect.width / 2;
    baseCenterY = rect.top + rect.height / 2;
  }

  function updateThumb(dx, dy) {
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) {
      dx = dx / dist * maxDist;
      dy = dy / dist * maxDist;
      dist = maxDist;
    }
    thumb.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';

    // Normalize to [-1, 1]
    var norm = dist / maxDist;
    if (norm < deadzone) {
      joyX = 0;
      joyY = 0;
    } else {
      var scale = (norm - deadzone) / (1 - deadzone);
      joyX = (dx / maxDist) * scale;
      joyY = (dy / maxDist) * scale;
    }
  }

  function animLoop() {
    if (!active) return;
    if (state.phase !== 'adjusting') { animId = null; return; }

    var pos = wallAnchor.getAttribute('position');
    wallAnchor.setAttribute('position', {
      x: pos.x + joyX * speed,
      y: pos.y - joyY * speed,  // screen Y is inverted
      z: pos.z
    });

    animId = requestAnimationFrame(animLoop);
  }

  zone.addEventListener('touchstart', function(e) {
    if (state.phase !== 'adjusting') return;
    e.preventDefault();
    active = true;
    getBaseCenter();
    var touch = e.touches[0];
    updateThumb(touch.clientX - baseCenterX, touch.clientY - baseCenterY);
    if (!animId) animId = requestAnimationFrame(animLoop);
  });

  zone.addEventListener('touchmove', function(e) {
    if (!active) return;
    e.preventDefault();
    var touch = e.touches[0];
    updateThumb(touch.clientX - baseCenterX, touch.clientY - baseCenterY);
  });

  zone.addEventListener('touchend', function(e) {
    active = false;
    joyX = 0;
    joyY = 0;
    thumb.style.transform = 'translate(-50%, -50%)';
    if (animId) { cancelAnimationFrame(animId); animId = null; }
  });

  // Mouse support for desktop testing
  var mouseDown = false;
  zone.addEventListener('mousedown', function(e) {
    if (state.phase !== 'adjusting') return;
    mouseDown = true;
    active = true;
    getBaseCenter();
    updateThumb(e.clientX - baseCenterX, e.clientY - baseCenterY);
    if (!animId) animId = requestAnimationFrame(animLoop);
  });
  window.addEventListener('mousemove', function(e) {
    if (!mouseDown) return;
    updateThumb(e.clientX - baseCenterX, e.clientY - baseCenterY);
  });
  window.addEventListener('mouseup', function() {
    if (!mouseDown) return;
    mouseDown = false;
    active = false;
    joyX = 0;
    joyY = 0;
    thumb.style.transform = 'translate(-50%, -50%)';
    if (animId) { cancelAnimationFrame(animId); animId = null; }
  });

  console.log('✅ Joystick setup complete');
}

/* ============================================================
   Depth slider — controls wall Z position
   ============================================================ */
function setupDepthSlider() {
  var slider = document.getElementById('depth-slider');
  var valEl = document.getElementById('depth-val');
  var wallAnchor = document.getElementById('wall-anchor');
  var zone = document.getElementById('depth-zone');
  if (!slider || !wallAnchor) return;

  // Block propagation
  if (zone) {
    ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup'].forEach(function(evt) {
      zone.addEventListener(evt, function(e) { e.stopPropagation(); });
    });
  }

  slider.addEventListener('input', function() {
    if (state.phase !== 'adjusting') return;
    var z = parseFloat(slider.value);
    var pos = wallAnchor.getAttribute('position');
    wallAnchor.setAttribute('position', { x: pos.x, y: pos.y, z: z });
    if (valEl) valEl.textContent = z.toFixed(1);
  });

  console.log('✅ Depth slider setup complete');
}

/* ============================================================
   Rotation slider — controls wall Y rotation
   ============================================================ */
function setupRotationSlider() {
  var slider = document.getElementById('rotation-slider');
  var valEl = document.getElementById('rotation-val');
  var wallAnchor = document.getElementById('wall-anchor');
  var zone = document.getElementById('rotation-zone');
  if (!slider || !wallAnchor) return;

  // Block propagation
  if (zone) {
    ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup'].forEach(function(evt) {
      zone.addEventListener(evt, function(e) { e.stopPropagation(); });
    });
  }

  slider.addEventListener('input', function() {
    if (state.phase !== 'adjusting') return;
    var rot = parseFloat(slider.value);
    wallAnchor.setAttribute('rotation', { x: 0, y: rot, z: 0 });
    if (valEl) valEl.textContent = rot.toFixed(0) + '°';
  });

  console.log('✅ Rotation slider setup complete');
}

/* ============================================================
   CTA button — toggles between Confirm and Reset
   ============================================================ */
function setupCtaButton() {
  var btn = document.getElementById('cta-btn');
  if (!btn) return;

  btn.addEventListener('click', function() {
    if (state.phase === 'adjusting') {
      // === CONFIRM ===
      state.phase = 'confirmed';
      console.log('✅ Wall alignment confirmed!');

      triggerVibration(CONFIG.feedback.confirmVibration);
      HintSystem.stopInactivity();
      HintSystem.hide();

      // Hide controls
      hideWallControls();

      // Log wall position/rotation
      var wallAnchor = document.getElementById('wall-anchor');
      if (wallAnchor) {
        var pos = wallAnchor.getAttribute('position');
        var rot = wallAnchor.getAttribute('rotation');
        console.log('📐 Wall position:', JSON.stringify(pos));
        console.log('📐 Wall rotation:', JSON.stringify(rot));
      }

      // Hide CTA, then start portal
      btn.classList.remove('visible');
      setTimeout(function() {
        runPortalReveal();
      }, 400);

    } else if (state.phase === 'complete') {
      // === RESET ===
      console.log('🔄 Resetting to scanning mode');

      // Hide item name
      if (ui.elements.itemName) ui.elements.itemName.classList.remove('visible');

      // Hide back button
      var backBtn = document.getElementById('back-to-main');
      if (backBtn) backBtn.classList.remove('visible');

      // Hide portal ring
      if (state.portalRing) state.portalRing.setAttribute('visible', false);

      // Hide models
      setModelVisible(state.realModel, false);
      setModelOpacity(state.realModel, 0);
      setModelVisible(state.fictionalModel, false);
      setModelOpacity(state.fictionalModel, 0);

      // Re-enter scanning mode
      enterScanningMode();
      btn.textContent = '✅ Confirm';
      btn.classList.remove('reset-mode');
    }
  });

  console.log('✅ CTA button setup complete');
}

})();