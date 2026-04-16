window.TRACK_ANIMISM_CONFIG = {
  debug: true,
  targetSize: 0.6,
  roam: {
    speed: 1.1,
    radius: 6,
    minY: 1,
    maxY: 5
  },
  track: {
    duration: 7000,           // Longer than materialism (model dodges, so harder)
    hitboxPadding: 0.5,
    cumulative: true,         // Progress accumulates, doesn't reset on miss
    decayRate: 0.05           // Slow decay per second when not aiming (0 = no decay)
  },
  gazeAware: {
    reactionDelay: 300,       // ms before model reacts to being aimed at
    behaviors: {
      // Weights for random behavior selection (must sum ~1.0)
      dodge:   0.5,           // Accelerate away from camera direction
      shy:     0.3,           // Shrink movement, hover in place nervously
      curious: 0.2            // Move closer to camera
    },
    dodge: {
      speedMultiplier: 2.5,   // How much faster when dodging
      deflectionAngle: 60     // Max random deflection degrees from away-vector
    },
    shy: {
      speedMultiplier: 0.3,   // Slow down significantly
      wobbleDeg: 3,           // Nervous wobble amplitude
      wobblePeriod: 400       // ms per wobble cycle
    },
    curious: {
      speedMultiplier: 0.8,
      approachDistance: 2.5,   // How close it comes before shying away
      minDistance: 1.5         // Won't come closer than this
    },
    behaviorDuration: 2000,   // ms before picking a new behavior
    transitionSmoothing: 0.05 // Lerp factor for behavior transitions
  },
  dissolve: {
    duration: 600
  },
  material: {
    metalness: 0.15,
    roughness: 0.85
  }
};
