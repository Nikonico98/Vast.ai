window.RUB_CONFIG = {
  debug: true,
  // Hidden mark placement
  mark: {
    radius: 0.04,             // World-space radius of the circular mark on model surface
    color: "#FFD700",         // Gold color when revealed
    glowColor: "#FFA500",     // Glow pulse color
    opacity: 0.0,             // Initially invisible
    revealOpacity: 0.85,      // Opacity when found
    pulseSpeed: 1.5           // Glow pulse Hz
  },
  // Rub detection
  rub: {
    minMoveSpeed: 30,         // Minimum px/frame to count as rubbing (not just tapping)
    sampleInterval: 50,       // ms between rub samples
    touchRadius: 0.12         // World-space radius of touch influence
  },
  // Cold-hot feedback
  feedback: {
    zones: [
      { maxDist: 0.08, label: "Burning!",   color: "#FF1744", haptic: 80, xpMult: 3.0 },
      { maxDist: 0.20, label: "Hot!",       color: "#FF9100", haptic: 50, xpMult: 2.0 },
      { maxDist: 0.40, label: "Warm...",     color: "#FFD740", haptic: 30, xpMult: 1.2 },
      { maxDist: 0.70, label: "Cool",        color: "#42A5F5", haptic: 0,  xpMult: 0.5 },
      { maxDist: Infinity, label: "Cold",    color: "#90CAF9", haptic: 0,  xpMult: 0.2 }
    ]
  },
  // XP / progress
  xp: {
    threshold: 100,           // XP needed to trigger transformation
    perRub: 5,                // Base XP per valid rub frame (was 1, now 5x faster)
    decayRate: 0,             // XP decay per second when not rubbing (0 = no decay)
    counterPosition: "left"   // "left" or "right" bottom corner
  },
  // Star dust particles
  particles: {
    count: 5,                 // Particles per rub event
    size: 0.015,              // Particle size
    speed: 1.5,               // Fly speed toward counter (units/s)
    color: "#FFD54F",
    trailLength: 3,
    lifetime: 800             // ms per particle
  },
  // Mark sparkle particles (golden shimmer at mark location)
  sparkle: {
    count: 3,
    size: 0.008,
    lifetime: 500,
    color: "#FFD54F",
    driftDistance: 0.05
  },
  // Model swap
  swap: {
    delay: 500,
    flashDuration: 400
  },
  // Material
  material: {
    metalness: 0.15,
    roughness: 0.85
  }
};
