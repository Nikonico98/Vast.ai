window.BLOW_ANIMISM_CONFIG = {
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
  progress: {
    // Rate multipliers per zone (progress += intensity * dt * rateMultiplier)
    rateMultiplier: 0.15,          // Base fill rate per second at full intensity
    // Decay per zone (progress -= decay * dt when not blowing)
    decayRate: 0.04,               // Base decay per second
    // Non-linear zone thresholds and modifiers
    zones: {
      // 0-0.5: normal fill, normal decay
      normal:    { max: 0.5, fillMult: 1.0, decayMult: 1.0 },
      // 0.5-0.7: "resisting" — fill slower, decay faster (model fighting back)
      resisting: { max: 0.7, fillMult: 0.6, decayMult: 1.8 },
      // 0.7-1.0: "breaking" — fill fast, decay drops (point of no return)
      breaking:  { max: 1.0, fillMult: 2.0, decayMult: 0.3 }
    }
  },
  animation: {
    // Continuous animation parameters interpolated by progress
    // 0-20%: subtle tremor (instinctive micro-reaction)
    tremor: {
      yRotDeg: 1.5,        // Very subtle Y-axis tremor
      zRotDeg: 1.0,        // Z-axis micro-wobble
      period: 300,          // ms per cycle
      squashY: 0.98,
      stretchY: 1.02
    },
    // 20-50%: tickled wobble (trying to hold it in)
    tickle: {
      zRotDeg: 6,
      period: 220,
      squashY: 0.93,
      stretchY: 1.08,
      bounceY: 0.04
    },
    // 50-70%: resisting — strong twisting (fighting the urge)
    resist: {
      zRotDeg: 10,
      period: 160,
      squashY: 0.87,
      stretchY: 1.15,
      jitter: 0.015,
      bounceY: 0.07
    },
    // 70-90%: breaking — losing control
    breaking: {
      zRotDeg: 14,
      period: 120,
      squashY: 0.83,
      stretchY: 1.22,
      jitter: 0.025,
      bounceY: 0.1
    },
    // 90-100%: collapse — extreme shake before fall
    collapse: {
      zRotDeg: 18,
      period: 80,
      squashY: 0.8,
      stretchY: 1.25,
      jitter: 0.035,
      bounceY: 0.13
    },
    // Transform sequence after progress hits 100%
    transform: {
      fallDuration: 800,       // ms — model tips over
      fallAngleDeg: 90,        // Final X-axis rotation (fallen on side)
      shrinkDuration: 200,
      popDuration: 400,
      popOvershoot: 1.15
    }
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
