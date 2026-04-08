window.BLOW_CONFIG = {
  blow: {
    fftSize: 512,              // FFT resolution (256 bins, ~86Hz/bin at 44100Hz)
    lowFreqBins: 6,            // Low-freq bins to sample (0-~516Hz at 512 FFT)
    threshold: 0.06,           // Minimum blow intensity to register (0-1)
    smoothing: 0.3,            // Exponential moving average coefficient (lower = smoother)
    calibrationTime: 2000,     // Ambient noise calibration duration (ms)
    decayRate: 0.15,           // Progress decay per frame when not blowing
    // 3DS-style wind detection thresholds
    lowFreqRatioMin: 0.03,     // CHECK 1: Min fraction of energy in low-freq bins (phone mics cut low-freq)
    spectralFlatnessMin: 0.02, // CHECK 2: Min spectral flatness (lowered for light blowing)
    energyStabilityMax: 0.85   // CHECK 3: Max coefficient of variation of RMS (raised for light blowing)
  },
  rolling: {
    maxRotationSpeed: 540,     // Max X-axis rotation degrees per second
    maxTranslateSpeed: 2.0,    // Max Z-axis translation units per second
    friction: 0.97,            // Velocity decay when not blowing (higher = more inertia)
    rollOutDistance: 3.0,      // Z distance model travels before swap
    rollInStartZ: 3.0,        // Z offset where incoming model starts
    rollInDuration: 800        // Ms for incoming model roll-in animation
  },
  progress: {
    target: 100,               // Progress needed to trigger swap
    blowMultiplier: 1.2,       // Progress gain per frame = intensity * multiplier
    decayRate: 0.08,           // Progress lost per frame when not blowing
    checkpoints: [33, 66, 100],
    messages: ["Keep blowing!", "Almost there!", null]
  },
  bounce: {
    initialHeight: 0.3,
    damping: 0.4,
    bounceDuration: 350,
    bounceCount: 3,
    squashStretch: [
      { squashY: 0.7,  stretchY: 1.25, squashXZ: 1.2,  stretchXZ: 0.85 },
      { squashY: 0.8,  stretchY: 1.15, squashXZ: 1.15, stretchXZ: 0.9  },
      { squashY: 0.88, stretchY: 1.08, squashXZ: 1.08, stretchXZ: 0.95 }
    ]
  },
  animation: {
    transitionDuration: 400,   // Model fade duration (ms)
    swapPause: 300             // Pause between roll-out and roll-in (ms)
  },
  particles: {
    maxCount: 15,              // Max wind particles on screen
    spawnRate: 3,              // Particles per frame at max intensity
    minSize: 4,                // Min particle size (px)
    maxSize: 12,               // Max particle size (px)
    minSpeed: 2,               // Min upward speed (px/frame)
    maxSpeed: 8                // Max upward speed (px/frame)
  }
};
