/**
 * Ambient Soundscape Engine (P2-2)
 * Uses Web Audio API to generate procedural ambient sounds per world type.
 * No external audio files required.
 */

const WORLD_SOUND_PROFILES = {
  Historical: {
    // Warm low drone + gentle crackling fire texture
    baseFreq: 110,
    baseType: "triangle",
    harmonic: 220,
    harmonicType: "sine",
    harmonicGain: 0.06,
    filterFreq: 400,
    filterQ: 1,
    lfoRate: 0.15,
    lfoDepth: 8,
    noiseGain: 0.012,
    noiseFilter: 600,
    masterGain: 0.08,
  },
  Overlaid: {
    // Ethereal shimmering pad
    baseFreq: 174.61, // F3
    baseType: "sine",
    harmonic: 261.63, // C4
    harmonicType: "sine",
    harmonicGain: 0.07,
    filterFreq: 800,
    filterQ: 3,
    lfoRate: 0.4,
    lfoDepth: 12,
    noiseGain: 0.008,
    noiseFilter: 1200,
    masterGain: 0.07,
  },
  Alternate: {
    // Subtle electronic pulse, slightly unsettling
    baseFreq: 146.83, // D3
    baseType: "sawtooth",
    harmonic: 196, // G3
    harmonicType: "triangle",
    harmonicGain: 0.04,
    filterFreq: 350,
    filterQ: 5,
    lfoRate: 0.25,
    lfoDepth: 6,
    noiseGain: 0.015,
    noiseFilter: 500,
    masterGain: 0.06,
  },
  SciFi_Earth: {
    // Futuristic low hum with data-stream texture
    baseFreq: 82.41, // E2
    baseType: "sawtooth",
    harmonic: 164.81, // E3
    harmonicType: "square",
    harmonicGain: 0.03,
    filterFreq: 300,
    filterQ: 8,
    lfoRate: 0.6,
    lfoDepth: 4,
    noiseGain: 0.01,
    noiseFilter: 400,
    masterGain: 0.06,
  },
  SciFi_Galaxy: {
    // Deep space drone with distant shimmer
    baseFreq: 55, // A1
    baseType: "sine",
    harmonic: 82.41, // E2
    harmonicType: "sine",
    harmonicGain: 0.08,
    filterFreq: 250,
    filterQ: 2,
    lfoRate: 0.08,
    lfoDepth: 3,
    noiseGain: 0.018,
    noiseFilter: 800,
    masterGain: 0.07,
  },
  Fantasy: {
    // Magical tinkling with warm pad
    baseFreq: 196, // G3
    baseType: "sine",
    harmonic: 293.66, // D4
    harmonicType: "triangle",
    harmonicGain: 0.06,
    filterFreq: 900,
    filterQ: 2,
    lfoRate: 0.3,
    lfoDepth: 15,
    noiseGain: 0.005,
    noiseFilter: 1500,
    masterGain: 0.07,
  },
};

class AmbientSound {
  constructor() {
    this.ctx = null;
    this.nodes = [];
    this.masterGain = null;
    this.isPlaying = false;
    this.isMuted = false;
    this.currentWorld = null;
    this.fadeTime = 1.5; // seconds for fade in/out
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  start(world) {
    if (this.isPlaying && this.currentWorld === world) return;

    // If already playing different world, stop first
    if (this.isPlaying) {
      this._stopImmediate();
    }

    this._ensureContext();

    const profile = WORLD_SOUND_PROFILES[world] || WORLD_SOUND_PROFILES.Fantasy;
    this.currentWorld = world;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Master gain (with fade-in)
    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0, now);
    this.masterGain.gain.linearRampToValueAtTime(
      this.isMuted ? 0 : profile.masterGain,
      now + this.fadeTime,
    );
    this.masterGain.connect(ctx.destination);

    // Base oscillator
    const baseOsc = ctx.createOscillator();
    baseOsc.type = profile.baseType;
    baseOsc.frequency.setValueAtTime(profile.baseFreq, now);
    const baseGain = ctx.createGain();
    baseGain.gain.setValueAtTime(0.15, now);

    // LFO for vibrato on base
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(profile.lfoRate, now);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(profile.lfoDepth, now);
    lfo.connect(lfoGain);
    lfoGain.connect(baseOsc.frequency);
    lfo.start(now);

    baseOsc.connect(baseGain);
    baseGain.connect(this.masterGain);
    baseOsc.start(now);

    // Harmonic oscillator
    const harmOsc = ctx.createOscillator();
    harmOsc.type = profile.harmonicType;
    harmOsc.frequency.setValueAtTime(profile.harmonic, now);
    const harmGain = ctx.createGain();
    harmGain.gain.setValueAtTime(profile.harmonicGain, now);
    harmOsc.connect(harmGain);
    harmGain.connect(this.masterGain);
    harmOsc.start(now);

    // Filtered noise for texture
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(profile.noiseFilter, now);
    noiseFilter.Q.setValueAtTime(1, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(profile.noiseGain, now);

    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noiseSrc.start(now);

    // Store references for cleanup
    this.nodes = [baseOsc, harmOsc, lfo, noiseSrc];
    this.isPlaying = true;
  }

  stop() {
    if (!this.isPlaying || !this.ctx) return;

    const now = this.ctx.currentTime;

    // Fade out
    if (this.masterGain) {
      this.masterGain.gain.linearRampToValueAtTime(0, now + this.fadeTime);
    }

    // Schedule stop after fade
    setTimeout(() => this._stopImmediate(), this.fadeTime * 1000 + 100);
    this.isPlaying = false;
  }

  _stopImmediate() {
    for (const node of this.nodes) {
      try { node.stop(); } catch (_) { /* already stopped */ }
    }
    this.nodes = [];
    if (this.masterGain) {
      try { this.masterGain.disconnect(); } catch (_) {}
      this.masterGain = null;
    }
    this.isPlaying = false;
    this.currentWorld = null;
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      const profile = WORLD_SOUND_PROFILES[this.currentWorld] || WORLD_SOUND_PROFILES.Fantasy;
      this.masterGain.gain.linearRampToValueAtTime(
        this.isMuted ? 0 : profile.masterGain,
        now + 0.3,
      );
    }
    return this.isMuted;
  }
}

// Singleton
const ambientSound = new AmbientSound();
export default ambientSound;
