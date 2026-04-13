window.BLOW_CONFIG = {
  blow: {
    fftSize: 512,              // FFT resolution (256 bins, ~86Hz/bin at 44100Hz)
    lowFreqBins: 6,            // Low-freq bins to sample (0-~516Hz at 512 FFT)
    threshold: 0.06,           // Minimum blow intensity to register (0-1)
    smoothing: 0.3,            // Exponential moving average coefficient (lower = smoother)
    calibrationTime: 2000,     // Ambient noise calibration duration (ms)
    // 3DS-style wind detection thresholds
    lowFreqRatioMin: 0.03,     // CHECK 1: Min fraction of energy in low-freq bins
    spectralFlatnessMin: 0.02, // CHECK 2: Min spectral flatness
    energyStabilityMax: 0.85   // CHECK 3: Max coefficient of variation of RMS
  },
  giggle: {
    minBlowDuration: 300,      // ms — blow must last this long to count as a discrete blow
    cooldownDuration: 300,     // ms — gap required between blows (blow must stop this long)
    stage1: {                  // Light tickle
      wobbleDeg: 5,            // Z-axis wobble amplitude (degrees)
      wobbleCycles: 3,         // Number of oscillation cycles
      wobblePeriod: 200,       // Duration per cycle (ms) — smoother than 150
      squashY: 0.95,           // Y-axis squash factor
      stretchY: 1.05           // Y-axis stretch factor
    },
    stage2: {                  // Vigorous tickle
      wobbleDeg: 12,
      wobbleCycles: 5,
      wobblePeriod: 140,       // Smoother than 100ms
      squashY: 0.85,
      stretchY: 1.2,
      jitter: 0.02             // Smooth sine-based X/Z position offset
    },
    stage3: {                  // Tickle → transform
      wobbleDeg: 15,
      wobblePeriod: 80,        // Smoother tremor (was 60)
      tremorDuration: 600,     // Slightly longer for build-up feel
      shrinkDuration: 150,     // Smoother grow (was 100)
      popDuration: 350,        // Bounce-back settle (was 300)
      popOvershoot: 1.15       // Overshoot scale before settling to 1.0
    }
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
