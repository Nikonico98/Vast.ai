// ==========================================
// Imaginary World - Story Page Controller
// ==========================================
// Main page state machine and UI controller
// Location: frontend/js/story.js

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Gradient background for story 3D viewers
function _createStoryGradientBackground() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, canvas.height, canvas.width, 0);
  gradient.addColorStop(0.0, "#b89a60");
  gradient.addColorStop(0.3, "#c4a870");
  gradient.addColorStop(0.6, "#a09888");
  gradient.addColorStop(1.0, "#787878");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

import {
  $,
  $$,
  $$$,
  show,
  hide,
  toggle,
  addClass,
  removeClass,
  toggleClass,
  on,
  once,
  delay,
  compressImage,
  readFileAsDataURL,
  downloadFile,
  saveToStorage,
  loadFromStorage,
  removeFromStorage,
  appState,
} from "../app.js";

import {
  startJourney,
  feedbackStory,
  processFullPhotoEvent,
  checkJobStatus,
  waitFor3DModel,
  WORLD_NAMES,
  WORLD_ICONS,
} from "./story-api.js";

import { DualViewer, FullscreenViewer, MiniViewer } from "./dual-viewer.js";
import ambientSound from "./ambient-sound.js";

// ==========================================
// Page Constants
// ==========================================
const PAGES = {
  AUTH: "page-auth",
  STORY_HISTORY: "page-story-history",
  WORLD_SELECTION: "page-world-selection",
  STORY_BACKGROUND: "page-story-background",
  PHOTO_UPLOAD: "page-photo-upload",
  PROCESSING: "page-processing",
  EVENT_RESULT: "page-event-result",
  STORY_COMPLETE: "page-story-complete",
};

const PHOTOS_PER_STORY = CONFIG.PHOTOS_PER_STORY || 3;

// ==========================================
// Story Controller Class
// ==========================================
class StoryController {
  constructor() {
    // Authentication state
    this.isLoggedIn = false;
    this.isGuest = false;
    this.currentUser = null;
    this.userStories = [];

    // Current state
    this.currentPage = PAGES.AUTH;
    this.selectedWorld = null;
    this.journeyId = null;
    this.userFolderId = null;
    this.currentStory = null;
    this.currentPhotoIndex = 0;
    this.events = [];
    this.collectedItems = [];

    // Photo state
    this.selectedPhoto = null;
    this.selectedPhotoDataUrl = null;

    // Viewers
    this.dualViewer = null;
    this.fullscreenViewer = null;
    this.miniViewers = []; // Mini 3D viewers for collected items

    // Puzzle game state
    this.puzzleState = {
      tiles: [],
      moves: 0,
      startTime: null,
      timerInterval: null,
      solved: false,
      imageLoaded: false,
      removedTileIndex: 4,
    };
    this.puzzleFictionalImageUrl = null;
    this.puzzleImageReady = false;
    this._puzzleImg = null;
    this.puzzlePieceToOriginal = [];

    // Initialize
    this.init();
  }

  // ==========================================
  // Initialization
  // ==========================================

  init() {
    Logger.log("StoryController initializing...");

    // Initialize viewers
    this.initViewers();

    // Bind event handlers
    this.bindEvents();

    // Bind authentication events
    this.bindAuthEvents();

    // Bind network recovery handlers
    this.bindNetworkEvents();

    // Initialize text-to-speech narration
    this.initTTS();

    // Initialize language switcher & translation
    this.initTranslation();

    // Check authentication status first
    this.checkAuthStatus();

    Logger.log("StoryController initialized");
  }

  initViewers() {
    // Dual viewer for event result page
    this.dualViewer = new DualViewer({
      photoContainer: "viewer-photo-item",
      fictionalContainer: "viewer-fictional-item",
    });

    // Fullscreen viewer modal
    this.fullscreenViewer = new FullscreenViewer({
      container: "fullscreen-viewer",
      modal: "fullscreen-viewer-modal",
    });
  }

  // ==========================================
  // Text-to-Speech Narration
  // ==========================================

  initTTS() {
    this.ttsUtterance = null;
    this.ttsSpeaking = false;

    on("tts-story-btn", "click", () => {
      const content = $("story-content");
      const goal = $("goal-text");
      if (!content) return;
      let text = content.innerText || "";
      if (goal && goal.textContent) {
        text += ". Goal: " + goal.textContent;
      }
      this.toggleTTS("tts-story-btn", text);
    });

    on("tts-event-btn", "click", () => {
      const preview = $("story-preview-text");
      if (!preview) return;
      this.toggleTTS("tts-event-btn", preview.innerText || "");
    });
  }

  toggleTTS(btnId, text) {
    const btn = $(btnId);
    if (!btn || !text.trim()) return;

    // If already speaking from this button, stop
    if (this.ttsSpeaking && this._ttsActiveBtn === btnId) {
      this.stopTTS();
      return;
    }

    // Stop any other speech first
    this.stopTTS();

    const utterance = new SpeechSynthesisUtterance(text);
    // Match TTS language to current translation selection
    // EN → English, 简 → Mandarin (zh-CN), 繁 → Cantonese (zh-HK)
    const langMap = { en: "en-US", "zh-CN": "zh-CN", "zh-TW": "zh-HK" };
    utterance.lang = langMap[this._preferredLang] || "en-US";
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    // Pick the correct voice explicitly — iOS ignores utterance.lang if no voice is set
    const pickVoice = () => {
      const voices =
        this._cachedVoices && this._cachedVoices.length > 0
          ? this._cachedVoices
          : speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return null;

      const lang = this._preferredLang;
      if (lang === "zh-CN") {
        // Mandarin: match by voice name (Ting-Ting on iOS) or lang code
        return (
          voices.find((v) => /Ting-Ting/i.test(v.name)) ||
          voices.find(
            (v) =>
              /zh[_-](CN|Hans)/i.test(v.lang) &&
              !/HK|Hant|yue/i.test(v.lang) &&
              !/Sin-Ji|Cantonese/i.test(v.name),
          ) ||
          voices.find((v) => /cmn/i.test(v.lang))
        );
      } else if (lang === "zh-TW") {
        // Cantonese: match by voice name (Sin-Ji on iOS) or lang code
        return (
          voices.find((v) => /Sin-Ji/i.test(v.name)) ||
          voices.find((v) => /zh[_-]HK|yue/i.test(v.lang)) ||
          voices.find((v) => /Cantonese/i.test(v.name))
        );
      } else {
        return (
          voices.find((v) => v.lang === "en-US") ||
          voices.find((v) => /^en/i.test(v.lang))
        );
      }
    };

    const voice = pickVoice();
    if (voice) {
      utterance.voice = voice;
      console.log(`🗣️ TTS voice: ${voice.name} [${voice.lang}] for pref=${this._preferredLang}`);
    } else {
      console.warn(`⚠️ No matching voice for ${this._preferredLang}, falling back to lang=${utterance.lang}`);
    }

    utterance.onstart = () => {
      this.ttsSpeaking = true;
      this._ttsActiveBtn = btnId;
      btn.classList.add("speaking");
      const icon = btn.querySelector(".tts-icon");
      if (icon) icon.textContent = "⏸";
    };

    utterance.onend = () => {
      this._clearTTSState(btn);
    };

    utterance.onerror = () => {
      this._clearTTSState(btn);
    };

    this.ttsUtterance = utterance;
    speechSynthesis.speak(utterance);
  }

  stopTTS() {
    speechSynthesis.cancel();
    // Clear state on all TTS buttons
    const btns = $$$(".tts-btn");
    btns.forEach((b) => {
      b.classList.remove("speaking");
      const icon = b.querySelector(".tts-icon");
      if (icon) icon.textContent = "\ud83d\udd0a";
    });
    this.ttsSpeaking = false;
    this._ttsActiveBtn = null;
  }

  _clearTTSState(btn) {
    this.ttsSpeaking = false;
    this._ttsActiveBtn = null;
    if (btn) {
      btn.classList.remove("speaking");
      const icon = btn.querySelector(".tts-icon");
      if (icon) icon.textContent = "\ud83d\udd0a";
    }
  }

  // ==========================================
  // Translation (Language Switcher)
  // ==========================================

  initTranslation() {
    // Preload speech synthesis voices (iOS loads them asynchronously)
    this._voicesReady = false;
    this._cachedVoices = [];
    if (typeof speechSynthesis !== "undefined") {
      const loadVoices = () => {
        this._cachedVoices = speechSynthesis.getVoices();
        if (this._cachedVoices.length > 0) {
          this._voicesReady = true;
          console.log(
            "🗣️ Voices loaded:",
            this._cachedVoices.length,
            "| zh voices:",
            this._cachedVoices
              .filter((v) => /zh|cmn|yue/i.test(v.lang))
              .map((v) => `${v.name} [${v.lang}]`)
              .join(", "),
          );
        }
      };
      loadVoices();
      speechSynthesis.addEventListener("voiceschanged", loadVoices);
    }

    // Cache: key = "target:originalText" → translated text
    this._translationCache = {};
    // Store original English text for each target area
    this._originalTexts = {};
    // Store original HTML for elements that use innerHTML
    this._originalHtml = {};
    // Current language per area
    this._currentLang = {};

    // Restore saved preference
    const saved = localStorage.getItem("iw_lang");
    this._preferredLang = saved || "en";

    // Bind all lang switcher buttons
    const switchers = $$$(".lang-switcher");
    switchers.forEach((switcher) => {
      const target = switcher.dataset.target;
      this._currentLang[target] = this._preferredLang;

      const btns = switcher.querySelectorAll(".lang-btn");
      btns.forEach((btn) => {
        // Set initial active state from preference
        if (btn.dataset.lang === this._preferredLang) {
          btns.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        }
        btn.addEventListener("click", () => {
          const lang = btn.dataset.lang;
          this._preferredLang = lang;
          localStorage.setItem("iw_lang", lang);
          // Sync all switchers and translate
          this._syncAllSwitchers(lang);
        });
      });
    });

    // Bind TTS for processing story background
    on("tts-processing-btn", "click", () => {
      const bg = $("processing-story-text");
      const goal = $("processing-goal-text");
      let text = "";
      if (bg) text += bg.innerText || "";
      if (goal) text += ". " + (goal.innerText || "");
      if (text.trim()) this.toggleTTS("tts-processing-btn", text.trim());
    });

    // Bind TTS for event result page
    on("tts-result-btn", "click", () => {
      const el = $("event-story-text");
      if (!el) return;
      this.toggleTTS("tts-result-btn", el.innerText || "");
    });

    // Bind TTS for complete story page
    on("tts-complete-btn", "click", () => {
      const el = $("complete-story-content");
      if (!el) return;
      // Read only text from story sections, skip image captions
      const sections = el.querySelectorAll(".story-section");
      let text = "";
      sections.forEach((sec) => {
        const heading = sec.querySelector("strong");
        const para = sec.querySelector("p");
        if (heading) text += heading.textContent + ". ";
        if (para) text += para.textContent + " ";
      });
      this.toggleTTS("tts-complete-btn", text.trim());
    });
  }

  _syncAllSwitchers(lang) {
    const switchers = $$$(".lang-switcher");
    switchers.forEach((switcher) => {
      const target = switcher.dataset.target;
      this._currentLang[target] = lang;
      const btns = switcher.querySelectorAll(".lang-btn");
      btns.forEach((b) => {
        b.classList.toggle("active", b.dataset.lang === lang);
      });
      this.switchLanguage(target, lang);
    });
  }

  switchLanguage(target, lang) {
    this._currentLang[target] = lang;

    // Cancel running typewriter to prevent English chars appending after translation
    if (target === "event-preview" && this.typewriterInterval) {
      clearInterval(this.typewriterInterval);
      this.typewriterInterval = null;
      const typingCursor = $$(".typing-cursor");
      if (typingCursor) typingCursor.classList.add("hidden");
    }

    // Map target to DOM element and original text key
    const mapping = {
      story: { textEl: "story-content", goalEl: "goal-text" },
      "processing-story": { textEl: "processing-story-text", goalEl: "processing-goal-text" },
      "event-preview": { textEl: "story-preview-text" },
      "event-result": { textEl: "event-story-text" },
      "complete-story": { textEl: "complete-story-content", preserveImages: true },
    };

    const config = mapping[target];
    if (!config) return;

    const textEl = $(config.textEl);
    if (!textEl) return;

    // Save original English text if not stored
    if (!this._originalTexts[config.textEl]) {
      this._originalTexts[config.textEl] = textEl.innerText;
      this._originalHtml[config.textEl] = textEl.innerHTML;
    }

    // Goal text (story page only)
    const goalEl = config.goalEl ? $(config.goalEl) : null;
    if (goalEl && !this._originalTexts[config.goalEl]) {
      this._originalTexts[config.goalEl] = goalEl.innerText;
    }

    if (lang === "en") {
      // Restore original English (use HTML if available to preserve formatting)
      if (this._originalHtml[config.textEl]) {
        textEl.innerHTML = this._originalHtml[config.textEl];
      } else {
        textEl.textContent = this._originalTexts[config.textEl];
      }
      if (goalEl) goalEl.textContent = this._originalTexts[config.goalEl];
      return;
    }

    // Translate main text
    if (config.preserveImages) {
      this._translateCompleteStory(config.textEl, textEl, lang);
    } else {
      this._translateElement(config.textEl, textEl, lang);
    }

    // Translate goal if applicable
    if (goalEl) {
      this._translateElement(config.goalEl, goalEl, lang);
    }
  }

  async _translateElement(key, el, lang) {
    const original = this._originalTexts[key];
    if (!original || !original.trim()) return;

    const cacheKey = `${lang}:${original}`;

    // Check cache
    if (this._translationCache[cacheKey]) {
      el.textContent = this._translationCache[cacheKey];
      return;
    }

    // Show loading state: dim text + add shimmer class
    el.classList.add("translating");

    // Show loading state on the switcher buttons for this area
    const container = el.closest(".result-section, .story-container, .story-preview-section");
    const loadingBtns = container
      ? container.querySelectorAll(`.lang-btn[data-lang="${lang}"]`)
      : [];
    loadingBtns.forEach((b) => b.classList.add("loading"));

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: original, target: lang }),
      });

      if (!res.ok) throw new Error(`Translation failed (${res.status})`);

      const data = await res.json();
      if (data.translated) {
        this._translationCache[cacheKey] = data.translated;
        // Only apply if user hasn't switched away
        if (this._currentLang[this._findTarget(key)] === lang) {
          el.textContent = data.translated;
        }
      }
    } catch (err) {
      console.error("Translation error:", err);
      // Revert to English on failure so user sees something
      if (this._originalHtml[key]) {
        el.innerHTML = this._originalHtml[key];
      } else {
        el.textContent = original;
      }
      // Brief visual error pulse
      el.classList.add("translate-error");
      setTimeout(() => el.classList.remove("translate-error"), 1500);
    } finally {
      el.classList.remove("translating");
      loadingBtns.forEach((b) => b.classList.remove("loading"));
    }
  }

  /**
   * Translate complete story as one block while preserving embedded images.
   * Extracts text from <strong> and <p> elements, sends as one blob,
   * then applies translated text back to those elements, keeping <figure>s intact.
   */
  async _translateCompleteStory(key, el, lang) {
    // Collect original text segments with delimiters
    const sections = el.querySelectorAll(".story-section");
    const textParts = [];
    sections.forEach((sec) => {
      const heading = sec.querySelector("strong");
      const para = sec.querySelector("p");
      if (heading) textParts.push(heading.textContent);
      if (para) textParts.push(para.textContent);
    });

    const original = textParts.join("\n---\n");
    if (!original.trim()) return;

    const cacheKey = `${lang}:complete-story:${original}`;

    if (this._translationCache[cacheKey]) {
      this._applyCompleteStoryTranslation(el, this._translationCache[cacheKey]);
      return;
    }

    el.classList.add("translating");
    const container = el.closest(".complete-story");
    const loadingBtns = container
      ? container.querySelectorAll(`.lang-btn[data-lang="${lang}"]`)
      : [];
    loadingBtns.forEach((b) => b.classList.add("loading"));

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: original, target: lang }),
      });

      if (!res.ok) throw new Error(`Translation failed (${res.status})`);

      const data = await res.json();
      if (data.translated) {
        this._translationCache[cacheKey] = data.translated;
        if (this._currentLang["complete-story"] === lang) {
          this._applyCompleteStoryTranslation(el, data.translated);
        }
      }
    } catch (err) {
      console.error("Complete story translation error:", err);
      el.classList.add("translate-error");
      setTimeout(() => el.classList.remove("translate-error"), 1500);
    } finally {
      el.classList.remove("translating");
      loadingBtns.forEach((b) => b.classList.remove("loading"));
    }
  }

  /**
   * Apply translated text to story sections, preserving image figures.
   * Translated text uses "---" as delimiter between segments.
   */
  _applyCompleteStoryTranslation(el, translated) {
    const parts = translated.split(/\n?---\n?/);
    const sections = el.querySelectorAll(".story-section");
    let partIndex = 0;
    sections.forEach((sec) => {
      const heading = sec.querySelector("strong");
      const para = sec.querySelector("p");
      if (heading && partIndex < parts.length) {
        heading.textContent = parts[partIndex++].trim();
      }
      if (para && partIndex < parts.length) {
        para.textContent = parts[partIndex++].trim();
      }
    });
  }

  _findTarget(key) {
    if (key === "story-content" || key === "goal-text") return "story";
    if (key === "processing-story-text" || key === "processing-goal-text") return "processing-story";
    if (key === "story-preview-text") return "event-preview";
    if (key === "event-story-text") return "event-result";
    if (key === "complete-story-content") return "complete-story";
    return "";
  }

  // Save original text when content is dynamically set
  setOriginalText(key, text) {
    this._originalTexts[key] = text;
    // Save HTML version for elements with rich content
    const el = $(key);
    if (el) this._originalHtml[key] = el.innerHTML;
    // Auto-translate if current language is not English
    const target = this._findTarget(key);
    if (target && this._preferredLang !== "en") {
      if (el) this._translateElement(key, el, this._preferredLang);
    }
  }

  // ==========================================
  // Event Binding
  // ==========================================

  bindEvents() {
    // World selection
    this.bindWorldSelection();

    // Story background page
    this.bindStoryBackground();

    // Photo upload page
    this.bindPhotoUpload();

    // Event result page
    this.bindEventResult();

    // Story complete page
    this.bindStoryComplete();

    // Fullscreen viewer
    this.bindFullscreenViewer();

    // Back buttons
    this.bindBackButtons();

    // Collapsible processing steps
    this.bindProcessingStepsToggle();

    // Collapsible sections on event result page
    this.bindCollapsibleSections();

    // Ambient sound toggle
    this.bindAmbientToggle();
  }

  // ==========================================
  // Authentication Events
  // ==========================================

  bindAuthEvents() {
    // Tab switching
    const authTabs = $$$(".auth-tab");
    authTabs.forEach((tab) => {
      on(tab, "click", () => {
        const tabName = tab.dataset.tab;
        this.switchAuthTab(tabName);
      });
    });

    // Login form
    const loginForm = $("login-form");
    if (loginForm) {
      on(loginForm, "submit", async (e) => {
        e.preventDefault();
        await this.handleLogin();
      });
    }

    // Register form
    const registerForm = $("register-form");
    if (registerForm) {
      on(registerForm, "submit", async (e) => {
        e.preventDefault();
        await this.handleRegister();
      });
    }

    // Guest button
    on("guest-btn", "click", async () => {
      await this.handleGuestLogin();
    });

    // Logout button (story history page)
    on("logout-btn", "click", async () => {
      await this.handleLogout();
    });

    // Logout buttons on all other pages
    const headerLogoutBtns = $$$(".header-logout");
    headerLogoutBtns.forEach((btn) => {
      on(btn, "click", async () => {
        await this.handleLogout();
      });
    });

    // New story button
    on("new-story-btn", "click", () => {
      this.clearStoredState();
      this.resetToFirstPage();
      this.navigateTo(PAGES.WORLD_SELECTION);
    });
  }

  // ==========================================
  // Network Recovery
  // ==========================================

  bindNetworkEvents() {
    this._isOffline = false;

    window.addEventListener("offline", () => {
      this._isOffline = true;
      Logger.warn("Network lost — offline");
      this.showNetworkBanner(false);
    });

    window.addEventListener("online", () => {
      Logger.log("Network restored — online");
      this._isOffline = false;
      this.showNetworkBanner(true);
      this.handleNetworkRecovery();
    });

    // Also recover when tab becomes visible again (e.g. user switches back)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !this._isOffline && navigator.onLine) {
        Logger.log("Tab became visible, checking state...");
        this.handleNetworkRecovery();
      }

      // Check if AR interaction was completed (written by 8th Wall AR pages)
      if (document.visibilityState === "visible") {
        this.checkARCompletion();
      }
    });
  }

  /**
   * Check if the AR experience wrote a completion signal to localStorage.
   * If so, enable the continue button and clean up.
   */
  checkARCompletion() {
    try {
      const raw = localStorage.getItem("iw_ar_completed");
      if (!raw) return;

      const data = JSON.parse(raw);
      // Only act on recent signals (within last 5 minutes)
      if (Date.now() - data.timestamp > 5 * 60 * 1000) {
        localStorage.removeItem("iw_ar_completed");
        return;
      }

      Logger.log("AR interaction completed:", data.interaction);
      localStorage.removeItem("iw_ar_completed");

      // Enable the continue button
      const continueBtn = $("continue-adventure-btn");
      if (continueBtn) {
        continueBtn.disabled = false;
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  showNetworkBanner(isOnline) {
    // Remove existing banner if any
    const existing = document.getElementById("network-banner");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "network-banner";
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      padding: 8px 16px; text-align: center; font-size: 0.85rem; font-weight: 600;
      transition: opacity 0.3s ease;
    `;

    if (isOnline) {
      banner.style.background = "#2ecc71";
      banner.style.color = "#fff";
      banner.textContent = "✅ Network restored — recovering...";
      // Auto-hide after 3s
      setTimeout(() => {
        if (banner.parentNode) {
          banner.style.opacity = "0";
          setTimeout(() => banner.remove(), 300);
        }
      }, 3000);
    } else {
      banner.style.background = "#e74c3c";
      banner.style.color = "#fff";
      banner.textContent = "⚠️ Network lost — your progress is saved locally";
    }

    document.body.prepend(banner);
  }

  async handleNetworkRecovery() {
    if (!this.journeyId) return;

    // Only auto-recover on pages where network interruption causes a stuck state
    if (this.currentPage === PAGES.PROCESSING) {
      Logger.log("Network recovery: on PROCESSING page, reloading journey from server...");
      try {
        const response = await fetch(`/api/stories/${this.journeyId}`);
        const data = await response.json();
        if (data.success && data.journey) {
          this.loadExistingJourney(data.journey);
        }
      } catch (error) {
        Logger.warn("Network recovery fetch failed, will retry on next online event");
      }
    }
  }

  switchAuthTab(tabName) {
    // Update tab buttons
    const tabs = $$$(".auth-tab");
    tabs.forEach((tab) => {
      if (tab.dataset.tab === tabName) {
        addClass(tab, "active");
      } else {
        removeClass(tab, "active");
      }
    });

    // Update forms
    const loginForm = $("login-form");
    const registerForm = $("register-form");

    if (tabName === "login") {
      addClass(loginForm, "active");
      removeClass(registerForm, "active");
    } else {
      removeClass(loginForm, "active");
      addClass(registerForm, "active");
    }

    // Clear errors
    const loginError = $("login-error");
    const registerError = $("register-error");
    if (loginError) loginError.textContent = "";
    if (registerError) registerError.textContent = "";
  }

  async checkAuthStatus() {
    try {
      const response = await fetch("/api/auth/me");
      
      // Handle server errors gracefully
      if (!response.ok) {
        Logger.warn("Auth check failed, showing login page");
        this.navigateTo(PAGES.AUTH);
        return;
      }
      
      const data = await response.json();

      if (data.logged_in) {
        this.isLoggedIn = true;
        this.isGuest = false;
        this.currentUser = data.user;
        await this.loadUserStories();
        // Try restore: URL hash → saved state → default
        if (!this.restoreFromHash() && !await this.restoreFromSavedState()) {
          this.navigateTo(PAGES.STORY_HISTORY);
        }
      } else if (data.is_guest) {
        this.isLoggedIn = false;
        this.isGuest = true;
        // Try restore: URL hash → saved state → default
        if (!this.restoreFromHash() && !await this.restoreFromSavedState()) {
          this.navigateTo(PAGES.WORLD_SELECTION);
        }
      } else {
        // Auto-restore session from localStorage persistence
        if (await this.tryAutoRestore()) return;
        this.navigateTo(PAGES.AUTH);
      }
    } catch (error) {
      Logger.error("Failed to check auth status:", error);
      // Try auto-restore on network errors too
      if (await this.tryAutoRestore()) return;
      this.navigateTo(PAGES.AUTH);
    }
  }

  async tryAutoRestore() {
    const savedAuth = loadFromStorage("iw_auth_state");
    if (!savedAuth) return false;

    Logger.log("Attempting auto-restore from localStorage:", savedAuth.type);

    try {
      if (savedAuth.type === "guest") {
        // Restore guest session with saved guest_id and user_folder_id
        const storyState = loadFromStorage("iw_story_state");
        const body = { guest_id: savedAuth.guest_id };
        if (storyState && storyState.userFolderId) {
          body.user_folder_id = storyState.userFolderId;
        }
        const res = await fetch("/api/auth/guest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const guestData = await res.json();
        if (guestData.success) {
          this.isGuest = true;
          Logger.log("Guest session auto-restored:", guestData.guest_id);
          if (!this.restoreFromHash() && !(await this.restoreFromSavedState())) {
            this.navigateTo(PAGES.WORLD_SELECTION);
          }
          return true;
        }
      } else if (savedAuth.type === "user") {
        // Auto-login with saved username
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: savedAuth.username }),
        });
        const loginData = await res.json();
        if (loginData.success) {
          this.isLoggedIn = true;
          this.currentUser = loginData.user;
          Logger.log("User session auto-restored:", loginData.user.username);
          await this.loadUserStories();
          if (!this.restoreFromHash() && !(await this.restoreFromSavedState())) {
            this.navigateTo(PAGES.STORY_HISTORY);
          }
          return true;
        }
      }
    } catch (error) {
      Logger.warn("Auto-restore failed:", error);
    }

    // Auto-restore failed, clear invalid auth state
    removeFromStorage("iw_auth_state");
    return false;
  }

  async handleLogin() {
    const username = $("login-username").value.trim();
    const errorDiv = $("login-error");

    errorDiv.textContent = "";

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();

      if (data.success) {
        this.isLoggedIn = true;
        this.isGuest = false;
        this.currentUser = data.user;
        saveToStorage("iw_auth_state", { type: "user", username: data.user.username });
        await this.loadUserStories();
        this.navigateTo(PAGES.STORY_HISTORY);
      } else {
        errorDiv.textContent = data.error || "Login failed";
      }
    } catch (error) {
      errorDiv.textContent = "Network error. Please try again.";
      Logger.error("Login error:", error);
    }
  }

  async handleRegister() {
    const username = $("register-username").value.trim();
    const displayName = $("register-display-name").value.trim();
    const errorDiv = $("register-error");

    errorDiv.textContent = "";

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          display_name: displayName || username,
        }),
      });

      const data = await response.json();

      if (data.success) {
        this.isLoggedIn = true;
        this.isGuest = false;
        this.currentUser = data.user;
        saveToStorage("iw_auth_state", { type: "user", username: data.user.username });
        this.userStories = []; // New user has no stories
        this.navigateTo(PAGES.STORY_HISTORY);
      } else {
        errorDiv.textContent = data.error || "Registration failed";
      }
    } catch (error) {
      errorDiv.textContent = "Network error. Please try again.";
      Logger.error("Register error:", error);
    }
  }

  async handleGuestLogin() {
    try {
      const response = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`Guest login failed with status ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        this.isLoggedIn = false;
        this.isGuest = true;
        saveToStorage("iw_auth_state", { type: "guest", guest_id: data.guest_id });
        this.clearStoredState();
        this.resetToFirstPage();
        this.navigateTo(PAGES.WORLD_SELECTION);
      } else {
        throw new Error(data.error || "Guest login failed");
      }
    } catch (error) {
      Logger.error("Guest login error:", error);
    }
  }

  async handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (error) {
      Logger.error("Logout error:", error);
    }

    this.isLoggedIn = false;
    this.isGuest = false;
    this.currentUser = null;
    this.userStories = [];
    removeFromStorage("iw_auth_state");
    this.clearStoredState();
    this.resetToFirstPage();
    this.navigateTo(PAGES.AUTH);
  }

  async loadUserStories() {
    try {
      const response = await fetch("/api/stories");
      const data = await response.json();

      if (data.success) {
        this.userStories = data.stories || [];
        this.renderStoryHistory();
      }
    } catch (error) {
      Logger.error("Failed to load stories:", error);
      this.userStories = [];
    }
  }

  renderStoryHistory() {
    const storyList = $("story-list");
    const welcomeText = $("welcome-text");

    // Update welcome text
    if (welcomeText && this.currentUser) {
      welcomeText.textContent = `👋 Welcome back, ${this.currentUser.display_name}!`;
    }

    if (!storyList) return;

    if (this.userStories.length === 0) {
      storyList.innerHTML = `
        <div class="story-list-empty">
          <p>You haven't created any stories yet.</p>
          <p>Click "Start New Story" to begin your adventure!</p>
        </div>
      `;
      return;
    }

    const worldIcons = {
      Historical: "🏛️",
      Overlaid: "🎭",
      Alternate: "🔀",
      SciFi_Earth: "🌍",
      SciFi_Galaxy: "🚀",
      Fantasy: "✨",
    };

    storyList.innerHTML = this.userStories
      .map((story) => {
        const icon = worldIcons[story.imaginary_world] || "📖";
        const statusClass = story.status === "completed" ? "" : "active";
        const statusText =
          story.status === "completed" ? "Completed" : "In Progress";
        const actionBtn =
          story.status === "completed"
            ? `<button class="story-card-btn primary" data-journey="${story.journey_id}" data-action="view">View</button>`
            : `<button class="story-card-btn primary" data-journey="${story.journey_id}" data-action="continue">Continue</button>`;

        const date = new Date(story.updated_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });

        return `
        <div class="story-card">
          <div class="story-card-header">
            <span class="story-card-icon">${icon}</span>
            <span class="story-card-title">${story.title || "Untitled Story"}</span>
            <span class="story-card-status ${statusClass}">${statusText}</span>
          </div>
          <div class="story-card-meta">
            📅 ${date} · Progress ${story.progress}/${story.total_events}
          </div>
          <div class="story-card-background">${story.story_background || ""}</div>
          <div class="story-card-actions">
            ${actionBtn}
            <button class="story-card-btn secondary" data-journey="${story.journey_id}" data-action="restart">Start Over</button>
          </div>
        </div>
      `;
      })
      .join("");

    // Bind story card actions
    const actionBtns = storyList.querySelectorAll(".story-card-btn");
    actionBtns.forEach((btn) => {
      on(btn, "click", () => {
        const journeyId = btn.dataset.journey;
        const action = btn.dataset.action;
        this.handleStoryAction(journeyId, action);
      });
    });
  }

  async handleStoryAction(journeyId, action) {
    if (action === "restart") {
      // Start fresh - go to world selection
      this.clearStoredState();
      this.resetToFirstPage();
      this.navigateTo(PAGES.WORLD_SELECTION);
    } else if (action === "continue" || action === "view") {
      // Load existing story
      try {
        const response = await fetch(`/api/stories/${journeyId}`);
        const data = await response.json();

        if (data.success && data.journey) {
          this.loadExistingJourney(data.journey);
        } else {
          Logger.error("Failed to load story:", data.error);
          alert(data.error || "Failed to load story. Please try again.");
        }
      } catch (error) {
        Logger.error("Failed to load story:", error);
        alert("Network error. Please try again.");
      }
    }
  }

  loadExistingJourney(journey) {
    // Restore journey state
    this.journeyId = journey.journey_id;
    this.userFolderId = journey.user_id;
    this.selectedWorld = journey.imaginary_world;
    
    // Get story content from the LAST node (the accepted story, not the first generated one)
    const lastNode = journey.nodes?.[journey.nodes.length - 1] || {};
    this.currentStory = {
      storyBackground: journey.story_background,
      goal: journey.goal,
      title: journey.titles?.[journey.titles.length - 1] || journey.world_label,
      storyHtml: lastNode.story_html || `<p>${journey.story_background}</p>`,
      storyPlain: lastNode.story_background || journey.story_background,
    };
    this.events = journey.events || [];
    this.currentPhotoIndex = this.events.length;

    // Rebuild collectedItems from all existing events
    this.collectedItems = this.events.map((e) => ({
      name: e.fictional_item_or_character || e.item_or_character,
      imageUrl: e.fictional_image_url,
      modelUrl: e.fictional_3d_url,
      glbUrl: e.fictional_3d_url,
    }));

    // --- Recovery: Check for in-flight processing (explicit marker) ---
    const processingState = loadFromStorage("iw_processing_state");
    if (processingState && processingState.journeyId === journey.journey_id) {
      Logger.log("Processing state marker found, attempting recovery...");
      this.handleProcessingRecovery(journey, processingState);
      return;
    }

    // --- Recovery: Implicit detection of pending 3D on latest event ---
    if (this.events.length > 0) {
      const latestEvent = this.events[this.events.length - 1];
      if (this.isEvent3DPending(latestEvent)) {
        Logger.log("Detected pending 3D on latest event (no marker), resuming...");
        this.resumeProcessing(latestEvent, this.events.length - 1);
        return;
      }
    }

    // Check if user was on EVENT_RESULT page before refresh
    const savedState = loadFromStorage("iw_story_state");
    const savedPage = savedState?.currentPage;

    // Determine which page to show
    if (journey.status === "completed" || this.events.length >= PHOTOS_PER_STORY || savedPage === PAGES.STORY_COMPLETE) {
      // Show completed page with all collected items
      this.buildCompleteStory();
      this.buildCollectionGrid();
      this.navigateTo(PAGES.STORY_COMPLETE);
    } else if (this.events.length > 0) {
      // Check if user was viewing an event result before refresh
      if (savedPage === PAGES.EVENT_RESULT) {
        // Still viewing the result of the last event — index should be events.length - 1
        // (continueAdventure will increment it when user clicks Continue)
        this.currentPhotoIndex = this.events.length - 1;
        const lastEvent = this.events[this.events.length - 1];
        const eventData = this.mapBackendEvent(lastEvent, this.events.length - 1);
        this.showEventResult(eventData);
      } else {
        // In progress - go to photo upload for next event
        this.navigateTo(PAGES.PHOTO_UPLOAD);
        this.updatePhotoUploadPage();
      }
    } else {
      // Just started - show story background
      this.navigateTo(PAGES.STORY_BACKGROUND);
      this.displayStory(this.currentStory);
    }
  }

  // ==========================================
  // Processing Recovery (after page refresh)
  // ==========================================

  /**
   * Check if an event's 3D generation is still pending.
   * Returns true if there are 3D job IDs but no corresponding 3D URLs.
   */
  isEvent3DPending(event) {
    if (!event) return false;
    const photo3dPending = event.photo_3d_job_id && !event.photo_3d_url;
    const fictional3dPending = event.fictional_3d_job_id && !event.fictional_3d_url;
    return photo3dPending || fictional3dPending;
  }

  /**
   * Convert a backend event object to the frontend eventData format
   * expected by showEventResult().
   */
  mapBackendEvent(backendEvent, eventIndex) {
    return {
      index: eventIndex,
      event: {
        ...backendEvent,
        // Frontend property aliases (showEventResult uses these names)
        eventId: backendEvent.event_id,
        eventIndex: backendEvent.event_index,
        storyText: backendEvent.event_text,
        photoPlace: backendEvent.photo_place,
        photoPlaceCategory: backendEvent.photo_place_category,
        photoItemName: backendEvent.photo_item_name || backendEvent.photo_item,
        photoItemCategory: backendEvent.photo_item_category,
        fictionalItemName: backendEvent.fictional_item_name || backendEvent.fictional_item_or_character,
        fictionalLocation: backendEvent.fictional_location || backendEvent.location,
        photoImageUrl: backendEvent.photo_image_url,
        fictionalImageUrl: backendEvent.fictional_image_url,
        arInteraction: backendEvent.ar_interaction,
      },
      photoModelUrl: backendEvent.photo_3d_url || null,
      fictionalModelUrl: backendEvent.fictional_3d_url || null,
    };
  }

  /**
   * Handle recovery when an explicit processing state marker is found.
   * Determines whether the backend event was created and routes accordingly.
   */
  async handleProcessingRecovery(journey, processingState) {
    const prevCount = processingState.previousEventCount || 0;
    const currentCount = (journey.events || []).length;

    if (currentCount > prevCount) {
      // Backend created the new event while we were processing
      const latestEvent = journey.events[currentCount - 1];

      if (this.isEvent3DPending(latestEvent)) {
        // 3D still processing - resume polling
        Logger.log("Recovery: event created, 3D still pending - resuming polling");
        this.resumeProcessing(latestEvent, currentCount - 1);
      } else {
        // 3D completed (or no 3D needed) - show event result directly
        Logger.log("Recovery: event created, 3D complete - showing result");
        removeFromStorage("iw_processing_state");
        this.currentPhotoIndex = currentCount - 1;
        const eventData = this.mapBackendEvent(latestEvent, currentCount - 1);
        this.showEventResult(eventData);
        this.saveState();
      }
    } else {
      // No new event yet - photo_event POST may have been interrupted
      // Clear marker and go to photo upload for retry
      Logger.log("Recovery: event not yet created, returning to photo upload");
      removeFromStorage("iw_processing_state");
      this.currentPhotoIndex = currentCount;
      this.navigateTo(PAGES.PHOTO_UPLOAD);
      this.updatePhotoUploadPage();
    }
  }

  /**
   * Resume 3D model polling for an event that has pending 3D jobs.
   * Shows the processing page with completed early steps and polls for 3D.
   */
  async resumeProcessing(backendEvent, eventIndex) {
    Logger.log("Resuming processing for event", eventIndex + 1);

    // Set up state
    this.currentPhotoIndex = eventIndex;

    // Navigate to processing page
    this.navigateTo(PAGES.PROCESSING);

    // Reset processing steps UI
    this.resetProcessingSteps();

    // Show photo echo from backend URL (original photo data is lost after refresh)
    if (backendEvent.photo_image_url) {
      this.selectedPhotoDataUrl = backendEvent.photo_image_url;
      this.showPhotoEcho();
    }

    // Mark completed steps (analyze, event, fictional-image are already done)
    this.updateProcessingStep("analyze", "Photo analyzed", {
      status: "completed",
      photoPlace: backendEvent.photo_place,
      photoItem: backendEvent.photo_item_name || backendEvent.photo_item,
    });

    // Brief delay for visual transition
    await delay(300);

    this.updateProcessingStep("event", "Event generated", {
      status: "completed",
      fictionalItem: backendEvent.fictional_item_name || backendEvent.fictional_item_or_character,
      fictionalLocation: backendEvent.fictional_location || backendEvent.location,
      storyText: backendEvent.event_text,
    });

    if (backendEvent.fictional_image_url) {
      this.updateProcessingStep("fictional-image", "Image generated", {
        status: "completed",
        progress: 100,
        fictionalImageUrl: backendEvent.fictional_image_url,
        fictionalItemName: backendEvent.fictional_item_name || backendEvent.fictional_item_or_character,
      });
    }

    // Note: showStoryPreview is already triggered by updateProcessingStep("event", ...)
    // via the typewriteStepDetails callback, so we don't call it again here.

    // Get job IDs
    const photoJobId = backendEvent.photo_3d_job_id;
    const fictionalJobId = backendEvent.fictional_3d_job_id;

    try {
      // If SKIP_3D_GENERATION, go straight to result
      if (CONFIG.SKIP_3D_GENERATION) {
        this.updateProcessingStep("3d-photo", "Skipped", { status: "completed", progress: 100 });
        this.updateProcessingStep("3d-fictional", "Skipped", { status: "completed", progress: 100 });
        removeFromStorage("iw_processing_state");
        const eventData = this.mapBackendEvent(backendEvent, eventIndex);
        await delay(1000);
        this.showEventResult(eventData);
        this.saveState();
        return;
      }

      // Quick status check - maybe both already completed since last load
      let photoModelUrl = backendEvent.photo_3d_url || null;
      let fictionalModelUrl = backendEvent.fictional_3d_url || null;

      if (photoJobId && !photoModelUrl) {
        try {
          const status = await checkJobStatus(photoJobId);
          if (status.status === "completed" && status.glbUrl) {
            photoModelUrl = status.glbUrl;
          }
        } catch (e) { /* will poll */ }
      }
      if (fictionalJobId && !fictionalModelUrl) {
        try {
          const status = await checkJobStatus(fictionalJobId);
          if (status.status === "completed" && status.glbUrl) {
            fictionalModelUrl = status.glbUrl;
          }
        } catch (e) { /* will poll */ }
      }

      const photoDone = !photoJobId || photoModelUrl;
      const fictionalDone = !fictionalJobId || fictionalModelUrl;

      // If both already complete, skip to result immediately
      if (photoDone && fictionalDone) {
        Logger.log("Recovery: both 3D models already complete");
        this.updateProcessingStep("3d-photo", "Complete!", { status: "completed", progress: 100 });
        this.updateProcessingStep("3d-fictional", "Complete!", { status: "completed", progress: 100 });
        this.updateOverallProgress(100);
        removeFromStorage("iw_processing_state");

        const eventData = this.mapBackendEvent(backendEvent, eventIndex);
        eventData.photoModelUrl = photoModelUrl;
        eventData.fictionalModelUrl = fictionalModelUrl;

        await delay(1000);
        this.showEventResult(eventData);
        this.saveState();
        return;
      }

      // Still pending - poll for 3D models
      Logger.log("Recovery: polling for pending 3D models...");

      const photoPromise = (photoJobId && !photoModelUrl)
        ? waitFor3DModel(photoJobId, (step, progress) => {
            this.updateProcessingStep("3d-photo", "Generating 3D model...", {
              status: "active",
              progress: progress,
            });
          }).then((url) => {
            this.updateProcessingStep("3d-photo", "Complete!", {
              status: "completed",
              progress: 100,
            });
            return url;
          })
        : Promise.resolve(photoModelUrl).then((url) => {
            this.updateProcessingStep("3d-photo", url ? "Complete!" : "Skipped", {
              status: "completed",
              progress: 100,
            });
            return url;
          });

      const fictionalPromise = (fictionalJobId && !fictionalModelUrl)
        ? waitFor3DModel(fictionalJobId, (step, progress) => {
            this.updateProcessingStep("3d-fictional", "Generating 3D model...", {
              status: "active",
              progress: progress,
            });
          }).then((url) => {
            this.updateProcessingStep("3d-fictional", "Complete!", {
              status: "completed",
              progress: 100,
            });
            return url;
          })
        : Promise.resolve(fictionalModelUrl).then((url) => {
            this.updateProcessingStep("3d-fictional", url ? "Complete!" : "Skipped", {
              status: "completed",
              progress: 100,
            });
            return url;
          });

      const [finalPhotoUrl, finalFictionalUrl] = await Promise.all([
        photoPromise,
        fictionalPromise,
      ]);

      // Clear processing state
      removeFromStorage("iw_processing_state");

      // Build event data
      const eventData = this.mapBackendEvent(backendEvent, eventIndex);
      eventData.photoModelUrl = finalPhotoUrl;
      eventData.fictionalModelUrl = finalFictionalUrl;

      // Update progress
      this.updateOverallProgress(100);

      // Play cinematic reveal transition, then show result
      await this.playRevealTransition();

      this.showEventResult(eventData);
      this.saveState();
    } catch (error) {
      Logger.error("Recovery polling failed:", error);
      removeFromStorage("iw_processing_state");
      this.showProcessingError("Processing recovery failed: " + error.message);
    }
  }

  // ==========================================
  // World Selection
  // ==========================================

  bindWorldSelection() {
    const worldCards = $$$(".world-card");
    worldCards.forEach((card) => {
      on(card, "click", () => {
        const worldKey = card.dataset.world;
        this.selectWorld(worldKey);
      });
    });
  }

  bindStoryBackground() {
    // Regenerate story
    on("regenerate-story-btn", "click", () => {
      this.regenerateStory();
    });

    // Accept story
    on("accept-story-btn", "click", () => {
      this.acceptStory();
    });
  }

  bindPhotoUpload() {
    const photoInput = $("photo-input");
    const uploadBox = $("upload-box");

    // Click upload box triggers file input (native camera/gallery selection on mobile)
    if (uploadBox) {
      on(uploadBox, "click", () => {
        photoInput.click();
      });
    }

    // File selected (from camera or gallery)
    on(photoInput, "change", async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this.handlePhotoSelected(file);
      }
    });

    // Retake photo
    on("retake-photo-btn", "click", () => {
      this.clearPhotoPreview();
    });

    // Process photo (new button)
    on("process-photo-btn", "click", () => {
      this.confirmPhoto();
    });
  }

  bindEventResult() {
    // Continue adventure
    on("continue-adventure-btn", "click", () => {
      this.continueAdventure();
    });

    // Fullscreen buttons
    const fullscreenBtns = $$$(".fullscreen-btn");
    fullscreenBtns.forEach((btn) => {
      on(btn, "click", () => {
        const viewerType = btn.dataset.viewer;
        this.openFullscreen(viewerType);
      });
    });
  }

  bindStoryComplete() {
    // New adventure
    on("new-adventure-btn", "click", () => {
      this.startNewAdventure();
    });

    // Share story
    on("share-story-btn", "click", () => {
      this.shareStory();
    });
  }

  bindFullscreenViewer() {
    // Close fullscreen
    on("close-fullscreen-btn", "click", () => {
      this.closeFullscreen();
    });

    // Download model
    on("download-model-btn", "click", () => {
      this.downloadCurrentModel();
    });
  }

  bindBackButtons() {
    const backBtns = $$$(".back-btn");
    backBtns.forEach((btn) => {
      on(btn, "click", () => {
        const target = btn.dataset.target;
        if (target) {
          this.navigateTo(target);
        }
      });
    });
  }

  // ==========================================
  // Navigation
  // ==========================================

  /**
   * Restore page from URL hash if present.
   * Called after authentication to enable returning from AR to the correct page.
   * @returns {boolean} true if a valid hash was found and navigation occurred
   */
  restoreFromHash() {
    const hash = window.location.hash.replace("#", "");
    if (hash && Object.values(PAGES).includes(hash)) {
      // Pages that require server data to render - must go through restoreFromSavedState()
      const dataRequiredPages = [
        PAGES.PROCESSING,
        PAGES.EVENT_RESULT,
        PAGES.STORY_COMPLETE,
        PAGES.STORY_BACKGROUND,
        PAGES.PHOTO_UPLOAD,
      ];
      if (dataRequiredPages.includes(hash)) {
        Logger.log("Hash points to data-dependent page, deferring to state restore:", hash);
        return false;
      }
      Logger.log("Restoring page from URL hash:", hash);
      this.navigateTo(hash);
      return true;
    }
    return false;
  }

  async restoreFromSavedState() {
    const state = loadFromStorage("iw_story_state");
    if (!state || !state.journeyId) return false;

    Logger.log("Found saved state, restoring journey:", state.journeyId);

    try {
      // Fetch fresh journey data from server (more reliable than stale localStorage)
      const response = await fetch(`/api/stories/${state.journeyId}`);
      const data = await response.json();

      if (data.success && data.journey) {
        this.loadExistingJourney(data.journey);
        Logger.log("Journey restored from server");
        return true;
      }
    } catch (error) {
      Logger.warn("Failed to restore journey from server:", error);
    }

    // Fallback: restore from localStorage if server fetch fails
    this.restoreState();
    if (this.journeyId) {
      // If we were on the processing page, can't resume without server data
      if (this.currentPage === PAGES.PROCESSING) {
        Logger.warn("Cannot resume processing without server data, going to photo upload");
        removeFromStorage("iw_processing_state");
        this.navigateTo(PAGES.PHOTO_UPLOAD);
        this.updatePhotoUploadPage();
      } else if (this.currentPage === PAGES.STORY_COMPLETE) {
        // Rebuild complete page DOM before navigating
        this.buildCompleteStory();
        this.buildCollectionGrid();
        this.navigateTo(PAGES.STORY_COMPLETE);
      } else {
        this.navigateTo(this.currentPage);
      }
      Logger.log("Journey restored from localStorage");
      return true;
    }

    return false;
  }

  navigateTo(pageId) {
    // Stop any TTS narration when leaving a page
    this.stopTTS();

    // Hide all pages
    const pages = $$$(".page");
    pages.forEach((page) => {
      removeClass(page, "active");
      removeClass(page, "has-category-badge");
    });

    // Show target page
    const targetPage = $(pageId);
    if (targetPage) {
      addClass(targetPage, "active");
      this.currentPage = pageId;

      // Update URL hash for deep-linking (e.g. returning from AR)
      if (window.location.hash !== `#${pageId}`) {
        window.history.replaceState(null, "", `#${pageId}`);
      }

      // Update app state
      appState.set("currentPage", pageId);

      // Update page-specific UI elements
      if (pageId === PAGES.PHOTO_UPLOAD) {
        this.updatePhotoUploadPage();
      }

      // Ambient sound disabled on processing page
      ambientSound.stop();
      this.showAmbientToggle(false);

      // Update global category badge visibility
      this.updateGlobalCategoryBadge(pageId);

      // Update journey progress mini-widget
      this.updateJourneyWidget(pageId);

      // Auto-save state on page navigation (only when journey is active)
      if (this.journeyId) {
        this.saveState();
      }

      Logger.log("Navigated to:", pageId);
    } else {
      Logger.error("Page not found:", pageId);
    }
  }

  updatePhotoUploadPage() {
    // Update event counter
    const currentEventNum = $("current-event-num");
    if (currentEventNum) {
      currentEventNum.textContent = this.currentPhotoIndex + 1;
    }

    // Clear any previous photo preview
    this.clearPhotoPreview();
  }

  // ==========================================
  // Global Category Badge
  // ==========================================

  updateGlobalCategoryBadge(pageId) {
    const badge = $("global-category-badge");
    const icon = $("global-category-icon");
    const name = $("global-category-name");
    const targetPage = $(pageId);

    if (!badge) return;

    // Pages that should show the category badge (when a world is selected)
    const pagesWithBadge = [
      PAGES.STORY_BACKGROUND,
      PAGES.PHOTO_UPLOAD,
      PAGES.PROCESSING,
      PAGES.EVENT_RESULT,
      PAGES.STORY_COMPLETE,
    ];

    const shouldShow = pagesWithBadge.includes(pageId) && this.selectedWorld;

    if (shouldShow) {
      // Update badge content
      if (icon) icon.textContent = WORLD_ICONS[this.selectedWorld] || "🌍";
      if (name) name.textContent = WORLD_NAMES[this.selectedWorld] || this.selectedWorld;

      // Show badge
      removeClass(badge, "hidden");

      // Add padding class to page
      if (targetPage) addClass(targetPage, "has-category-badge");
    } else {
      // Hide badge
      addClass(badge, "hidden");
    }
  }

  // ==========================================
  // World Selection
  // ==========================================

  async selectWorld(worldKey) {
    Logger.log("World selected:", worldKey);
    this.selectedWorld = worldKey;

    // Update title
    const worldTitle = $("current-world-title");
    if (worldTitle) {
      worldTitle.textContent = WORLD_NAMES[worldKey] || worldKey;
    }

    // Navigate to story background
    this.navigateTo(PAGES.STORY_BACKGROUND);

    // Show loading state
    this.setStoryLoading(true);

    try {
      // Start journey
      const journey = await startJourney(worldKey);

      this.journeyId = journey.journeyId;
      this.userFolderId = journey.userFolderId;
      this.currentStory = journey;

      // Display story
      this.displayStory(journey);

      // Save state
      this.saveState();
    } catch (error) {
      Logger.error("Failed to start journey:", error);
      this.showStoryError(error.message);
    }
  }

  // ==========================================
  // Story Display
  // ==========================================

  setStoryLoading(loading) {
    const storyContent = $("story-content");
    const goalText = $("goal-text");
    const regenerateBtn = $("regenerate-story-btn");
    const acceptBtn = $("accept-story-btn");

    if (loading) {
      // 🔄 Show loading state for story content
      const worldLoadingText = {
        Historical: "Unearthing a forgotten chapter...",
        Overlaid: "Weaving fiction into reality...",
        Alternate: "Exploring a divergent timeline...",
        SciFi_Earth: "Compiling future Earth scenario...",
        SciFi_Galaxy: "Receiving interstellar broadcast...",
        Fantasy: "The oracle is speaking...",
      };
      const loadingMsg = worldLoadingText[this.selectedWorld] || "Generating story background...";
      storyContent.innerHTML =
        `<p class="loading-text">${loadingMsg}</p>`;

      // 🔄 Show loading state for goal with animation
      if (goalText) {
        goalText.innerHTML = "⏳ Loading goal...";
        goalText.style.fontStyle = "italic";
        goalText.style.opacity = "0.7";
        goalText.style.animation = "pulse 1.5s ease-in-out infinite";
      }

      // 🚫 Disable buttons during generation
      if (regenerateBtn) {
        regenerateBtn.disabled = true;
        regenerateBtn.style.opacity = "0.5";
        regenerateBtn.style.cursor = "not-allowed";
      }
      if (acceptBtn) {
        acceptBtn.disabled = true;
        acceptBtn.style.opacity = "0.5";
        acceptBtn.style.cursor = "not-allowed";
      }
    } else {
      // ✅ Reset goal text styling when loading complete
      if (goalText) {
        goalText.style.fontStyle = "normal";
        goalText.style.opacity = "1";
        goalText.style.animation = "none";
      }

      // ✅ Re-enable buttons after generation
      if (regenerateBtn) {
        regenerateBtn.disabled = false;
        regenerateBtn.style.opacity = "1";
        regenerateBtn.style.cursor = "pointer";
      }
      if (acceptBtn) {
        acceptBtn.disabled = false;
        acceptBtn.style.opacity = "1";
        acceptBtn.style.cursor = "pointer";
      }
    }
  }

  displayStory(journey) {
    const storyContent = $("story-content");
    const worldTitle = $("current-world-title");
    const worldSetting = $("world-setting");
    const worldIcon = $("world-type-icon");
    const goalText = $("goal-text");
    const progressCount = $("progress-count");

    // Display story HTML
    storyContent.innerHTML =
      journey.storyHtml || `<p>${journey.storyPlain}</p>`;

    // Update world type icon
    if (worldIcon) {
      worldIcon.textContent = WORLD_ICONS[this.selectedWorld] || "🌍";
    }

    // Update world type title
    if (worldTitle) {
      worldTitle.textContent =
        WORLD_NAMES[this.selectedWorld] || this.selectedWorld;
    }

    // Update world setting (from story details or title)
    if (worldSetting) {
      const setting =
        journey.storyDetails?.setting ||
        journey.title ||
        "An amazing world awaits...";
      worldSetting.textContent = setting;
    }

    // Update goal
    if (goalText) {
      goalText.textContent =
        journey.goal || "Complete 3 events to unlock the story ending!";
    }

    // Register original text for translation
    this.setOriginalText("story-content", storyContent.innerText);
    this.setOriginalText("goal-text", goalText?.textContent || "");

    // Update progress count
    if (progressCount) {
      progressCount.textContent = `0/${PHOTOS_PER_STORY}`;
    }

    // Update progress bar
    this.updateProgressBar(0);

    this.setStoryLoading(false);
  }

  updateProgressBar(completed) {
    const progressBarFill = $("progress-bar-fill");
    const progressPercent = $("progress-percent");
    const progressCount = $("progress-count");
    const total = PHOTOS_PER_STORY;
    const percent = Math.round((completed / total) * 100);

    if (progressBarFill) {
      progressBarFill.style.width = `${percent}%`;
    }
    if (progressPercent) {
      progressPercent.textContent = `${percent}%`;
    }
    if (progressCount) {
      progressCount.textContent = `${completed}/${total}`;
    }

    // Update timeline nodes
    for (let i = 1; i <= total; i++) {
      const node = $(`timeline-node-${i}`);
      if (node) {
        if (i <= completed) {
          addClass(node, "completed");
        } else if (i === completed + 1) {
          addClass(node, "active");
        } else {
          removeClass(node, "completed");
          removeClass(node, "active");
        }
      }
    }
  }

  showStoryError(message) {
    const storyContent = $("story-content");
    storyContent.innerHTML = `
            <p class="error-text" style="color: #e74c3c;">
                ❌ Error: ${message}<br>
                <small>Please try again or select a different world.</small>
            </p>
        `;
    this.setStoryLoading(false);
  }

  // ==========================================
  // Story Actions
  // ==========================================

  async regenerateStory() {
    if (!this.journeyId) {
      Logger.error("No journey ID");
      return;
    }

    Logger.log("Regenerating story...");
    this.setStoryLoading(true);

    try {
      const journey = await feedbackStory(this.journeyId, "reject");
      this.currentStory = {
        ...this.currentStory,
        ...journey,
      };
      this.displayStory(this.currentStory);
      this.saveState();
    } catch (error) {
      Logger.error("Failed to regenerate story:", error);
      this.showStoryError(error.message);
    }
  }

  async acceptStory() {
    if (!this.journeyId) {
      Logger.error("No journey ID");
      return;
    }

    Logger.log("Accepting story...");

    try {
      await feedbackStory(this.journeyId, "accept");

      // Reset photo index
      this.currentPhotoIndex = 0;
      this.events = [];

      // Update story context mini
      this.updateStoryContextMini();

      // Update progress bar
      this.updateProgressBar();

      // Navigate to photo upload
      this.navigateTo(PAGES.PHOTO_UPLOAD);

      // Save state
      this.saveState();
    } catch (error) {
      Logger.error("Failed to accept story:", error);
      alert("Failed to start adventure. Please try again.");
    }
  }

  // ==========================================
  // Photo Upload
  // ==========================================

  updateStoryContextMini() {
    const contextMini = $("story-context-mini");
    if (contextMini && this.currentStory) {
      // Show a hint based on photo index
      const hints = [
        "Find your first magical item to begin the adventure...",
        "Search for the second item to continue your journey...",
        "Discover the final item to complete your quest...",
      ];
      contextMini.textContent = hints[this.currentPhotoIndex] || hints[0];
    }
  }

  updateProgressBar() {
    const steps = $$$(".progress-step");
    steps.forEach((step, index) => {
      removeClass(step, "active");
      removeClass(step, "completed");

      if (index < this.currentPhotoIndex) {
        addClass(step, "completed");
      } else if (index === this.currentPhotoIndex) {
        addClass(step, "active");
      }
    });
  }

  async handlePhotoSelected(file) {
    Logger.log("Photo selected:", file.name, `(${(file.size / 1024).toFixed(0)}KB)`);

    // Compress image before storing (resize to 1024px max, JPEG 0.8 quality)
    const compressed = await compressImage(file, 1024, 0.8);
    this.selectedPhoto = compressed;

    // Read as data URL for preview
    this.selectedPhotoDataUrl = await readFileAsDataURL(compressed);

    // Show preview
    this.showPhotoPreview();
  }

  showPhotoPreview() {
    const previewContainer = $("photo-preview-container");
    const previewImage = $("photo-preview");
    const uploadPlaceholder = $("upload-placeholder");
    const processBtn = $("process-photo-btn");
    const retakeBtn = $("retake-photo-btn");

    if (previewImage && this.selectedPhotoDataUrl) {
      previewImage.src = this.selectedPhotoDataUrl;
    }

    // Hide upload placeholder, show preview
    if (uploadPlaceholder) {
      hide(uploadPlaceholder);
    }

    if (previewContainer) {
      show(previewContainer);
    }

    // Enable process button, show retake button
    if (processBtn) {
      processBtn.disabled = false;
    }

    if (retakeBtn) {
      retakeBtn.style.display = "flex";
    }
  }

  clearPhotoPreview() {
    const previewContainer = $("photo-preview-container");
    const previewImage = $("photo-preview");
    const uploadPlaceholder = $("upload-placeholder");
    const photoInput = $("photo-input");
    const processBtn = $("process-photo-btn");
    const retakeBtn = $("retake-photo-btn");

    // Clear state
    this.selectedPhoto = null;
    this.selectedPhotoDataUrl = null;

    // Clear input
    if (photoInput) {
      photoInput.value = "";
    }

    // Clear preview image
    if (previewImage) {
      previewImage.src = "";
    }

    // Toggle visibility
    if (previewContainer) {
      hide(previewContainer);
    }

    if (uploadPlaceholder) {
      show(uploadPlaceholder);
    }

    // Disable process button, hide retake button
    if (processBtn) {
      processBtn.disabled = true;
    }

    if (retakeBtn) {
      retakeBtn.style.display = "none";
    }
  }

  async confirmPhoto() {
    if (!this.selectedPhoto) {
      Logger.error("No photo selected");
      return;
    }

    // Guard: prevent uploading beyond the event limit
    if (this.events.length >= PHOTOS_PER_STORY) {
      Logger.error(`Already have ${this.events.length}/${PHOTOS_PER_STORY} events, cannot upload more`);
      this.showStoryComplete();
      return;
    }

    Logger.log("Confirming photo upload...");

    // Save processing state for refresh recovery BEFORE starting
    saveToStorage("iw_processing_state", {
      journeyId: this.journeyId,
      selectedWorld: this.selectedWorld,
      photoIndex: this.currentPhotoIndex,
      previousEventCount: this.events.length,
      startedAt: Date.now(),
    });
    this.saveState();

    // Navigate to processing page
    this.navigateTo(PAGES.PROCESSING);

    // Show user photo echo-back with world filter
    this.showPhotoEcho();

    // Reset processing steps UI
    this.resetProcessingSteps();

    try {
      // Process full photo event
      const result = await processFullPhotoEvent(
        this.journeyId,
        this.selectedPhoto,
        (step, message, details) =>
          this.updateProcessingStep(step, message, details),
        this.selectedWorld,
      );

      // Clear processing state (completed successfully)
      removeFromStorage("iw_processing_state");

      // Store event
      const eventData = {
        index: this.currentPhotoIndex,
        event: result.event,
        photoModelUrl: result.photoModelUrl,
        fictionalModelUrl: result.fictionalModelUrl,
      };
      this.events.push(eventData);

      // Add to collected items
      this.collectedItems.push({
        name: result.event.photoItemName,
        imageUrl: result.event.photoImageUrl,
        modelUrl: result.photoModelUrl,
        type: "photo",
      });

      if (result.fictionalModelUrl) {
        this.collectedItems.push({
          name: result.event.fictionalItemName,
          imageUrl: result.event.fictionalImageUrl,
          modelUrl: result.fictionalModelUrl,
          type: "fictional",
        });
      }

      // Update overall progress to 100%
      this.updateOverallProgress(100);

      // Play cinematic reveal transition, then show result
      await this.playRevealTransition();

      // Show event result
      this.showEventResult(eventData);

      // Save state
      this.saveState();
    } catch (error) {
      Logger.error("Photo processing failed:", error);
      // Clear processing state on error
      removeFromStorage("iw_processing_state");
      this.showProcessingError(error.message);
    }
  }

  // ==========================================
  // Processing UI
  // ==========================================

  bindProcessingStepsToggle() {
    const header = $("steps-toggle-header");
    if (!header) return;
    header.addEventListener("click", () => {
      const container = header.closest(".processing-steps-container");
      if (container) container.classList.toggle("collapsed");
    });
  }

  bindCollapsibleSections() {
    document.addEventListener("click", (e) => {
      const header = e.target.closest("[data-toggle='collapsible']");
      if (!header) return;
      const section = header.closest(".collapsible-section");
      if (section) section.classList.toggle("collapsed");
    });
  }

  bindAmbientToggle() {
    const btn = $("ambient-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const muted = ambientSound.toggleMute();
      btn.textContent = muted ? "🔇" : "🔊";
      btn.classList.toggle("muted", muted);
    });
  }

  showAmbientToggle(visible) {
    const btn = $("ambient-toggle");
    if (btn) btn.classList.toggle("visible", visible);
  }

  // ==========================================
  // Journey Progress Mini-Widget (P3)
  // ==========================================

  updateJourneyWidget(pageId) {
    const widget = $("journey-progress-widget");
    if (!widget) return;

    // Show on pages that are part of the active journey
    const widgetPages = [
      PAGES.PHOTO_UPLOAD,
      PAGES.PROCESSING,
      PAGES.EVENT_RESULT,
    ];

    const shouldShow = widgetPages.includes(pageId) && this.journeyId;

    if (!shouldShow) {
      addClass(widget, "hidden");
      return;
    }

    // Build dots
    const dotsContainer = $("journey-dots");
    if (dotsContainer) {
      dotsContainer.innerHTML = "";
      for (let i = 0; i < PHOTOS_PER_STORY; i++) {
        const dot = document.createElement("span");
        dot.className = "journey-dot";
        if (i < this.events.length) {
          dot.classList.add("completed");
          dot.title = `Event ${i + 1}: Done`;
        } else if (i === this.currentPhotoIndex) {
          dot.classList.add("active");
          dot.title = `Event ${i + 1}: In progress`;
        } else {
          dot.classList.add("upcoming");
          dot.title = `Event ${i + 1}`;
        }
        dotsContainer.appendChild(dot);
      }
    }

    // Build collected item thumbnails (fictional items only)
    const itemsContainer = $("journey-items");
    if (itemsContainer) {
      itemsContainer.innerHTML = "";
      for (const item of this.collectedItems) {
        if (!item.imageUrl || item.type === "photo") continue;
        const img = document.createElement("img");
        img.className = "journey-item-thumb";
        img.src = item.imageUrl;
        img.alt = item.name || "Collected item";
        img.title = item.name || "Collected item";
        itemsContainer.appendChild(img);
      }
    }

    removeClass(widget, "hidden");
  }

  updateStepsMiniProgress(percent) {
    const miniProgress = $("steps-mini-progress");
    if (miniProgress) miniProgress.textContent = `${Math.round(percent)}%`;
  }

  resetProcessingSteps() {
    // Reset processing progress tracker
    this.processingProgress = 0;

    // World badge subtitle: show goal instead of technical text
    const processingText = $$(".processing-text");
    if (processingText) {
      const goal = this.currentStory?.goal || "";
      processingText.innerHTML = goal ? `🎯 ${goal}` : "Processing your photo...";
      processingText.style.color = ""; // Reset color
    }

    // Activate world badge based on selected world
    this.activateWorldBadge(this.selectedWorld);

    const steps = [
      "step-analyze",
      "step-event",
      "step-fictional-image",
      "step-3d-photo",
      "step-3d-fictional",
    ];
    steps.forEach((stepId) => {
      const step = $(stepId);
      if (step) {
        step.dataset.status = "pending";
        const icon = step.querySelector(".step-status-icon");
        if (icon) icon.textContent = "⏸️";

        // Reset details
        const details = $(`${stepId}-details`);
        if (details) {
          details.innerHTML = "<p>Waiting...</p>";
        }

        // Reset progress bars
        const progressFill = $(`${stepId}-progress`);
        const percentText = $(`${stepId}-percent`);
        if (progressFill) progressFill.style.width = "0%";
        if (percentText) percentText.textContent = "0%";
      }
    });

    // Set analyze step as first active
    const analyzeStep = $("step-analyze");
    if (analyzeStep) {
      analyzeStep.dataset.status = "active";
      const icon = analyzeStep.querySelector(".step-status-icon");
      if (icon) icon.textContent = "⏳";
      const details = $("step-analyze-details");
      if (details) details.innerHTML = "<p>Analyzing your photo...</p>";
    }

    // Reset overall progress
    this.updateOverallProgress(0);

    // Reset progressive disclosure phases
    this.resetPhases();

    // Reset story preview section
    this.resetStoryPreview();

    // Reset puzzle game
    this.resetPuzzleGame();

    // Start waiting messages rotation
    this.startWaitingMessages();
  }

  // Progressive disclosure phase management
  resetPhases() {
    const phase1 = $("phase-1");
    const phase2 = $("phase-2");
    const phase3 = $("phase-3");

    // Phase 1 visible immediately
    if (phase1) {
      phase1.classList.remove("phase-hidden", "phase-revealing");
    }
    // Phase 2 & 3 hidden until triggered
    if (phase2) {
      phase2.classList.add("phase-hidden");
      phase2.classList.remove("phase-revealing");
    }
    if (phase3) {
      phase3.classList.add("phase-hidden");
      phase3.classList.remove("phase-revealing");
    }

    // Default to collapsed
    const stepsContainer = $$(".processing-steps-container");
    if (stepsContainer) stepsContainer.classList.add("collapsed");
  }

  revealPhase(phaseId) {
    const phase = $(phaseId);
    if (!phase || !phase.classList.contains("phase-hidden")) return;

    phase.classList.remove("phase-hidden");
    phase.classList.add("phase-revealing");

    // Smooth scroll to keep the new phase in view
    setTimeout(() => {
      phase.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }

  showPhotoEcho() {
    const echoContainer = $("photo-echo");
    const echoImg = $("photo-echo-img");
    if (!echoContainer || !echoImg) return;

    // Set the image from the selected photo data URL
    if (this.selectedPhotoDataUrl) {
      echoImg.src = this.selectedPhotoDataUrl;

      // Remove previous world classes
      echoContainer.className = "photo-echo";

      // Apply world-specific filter class
      if (this.selectedWorld) {
        echoContainer.classList.add(`world-${this.selectedWorld}`);
      }

      // Show with animation
      echoContainer.classList.remove("hidden");

      // Populate story background section for narrative immersion
      this.showProcessingStory();
    } else {
      echoContainer.classList.add("hidden");
    }
  }

  showProcessingStory() {
    const section = $("processing-story-section");
    const bgText = $("processing-story-text");
    const goalText = $("processing-goal-text");
    if (!section) return;

    const storyBg = this.currentStory?.storyPlain || this.currentStory?.storyBackground || "";
    const goal = this.currentStory?.goal || "";

    if (storyBg) {
      if (bgText) bgText.textContent = storyBg;
      if (goalText) goalText.textContent = goal ? `🎯 ${goal}` : "";

      // Register for translation system
      this.setOriginalText("processing-story-text", storyBg);
      if (goal) this.setOriginalText("processing-goal-text", `🎯 ${goal}`);

      section.classList.remove("hidden");
    }
  }

  // Story preview with typewriter effect
  resetStoryPreview() {
    const previewSection = $("story-preview-section");
    const previewText = $("story-preview-text");
    const fictionalImagePreview = $("fictional-image-preview");
    const typingCursor = $$(".typing-cursor");

    if (previewSection) previewSection.classList.add("hidden");
    if (previewText) previewText.textContent = "";
    if (fictionalImagePreview) fictionalImagePreview.classList.add("hidden");
    if (typingCursor) typingCursor.classList.remove("hidden");

    // Reset skeleton and image states
    const skeleton = $("image-skeleton");
    const previewImg = $("fictional-image-preview-img");
    const imgCaption = $$(".fictional-image-caption");
    if (skeleton) skeleton.classList.remove("hidden");
    if (previewImg) { previewImg.classList.add("hidden"); previewImg.src = ""; }
    if (imgCaption) imgCaption.classList.add("hidden");

    // Clear any existing typewriter interval
    if (this.typewriterInterval) {
      clearInterval(this.typewriterInterval);
      this.typewriterInterval = null;
    }
  }

  showStoryPreview(storyText, eventData = {}) {
    const previewSection = $("story-preview-section");
    const previewText = $("story-preview-text");

    if (!previewSection || !previewText) return;

    // Show the section
    previewSection.classList.remove("hidden");

    // Register original text for translation (may trigger async translate)
    this.setOriginalText("story-preview-text", storyText);

    // Only run typewriter for English; for other languages, setOriginalText
    // already triggers async translation which will replace the content.
    // Running typewriter concurrently would cause English chars to append
    // after the translated text.
    if (this._preferredLang === "en") {
      this.typewriterEffect(previewText, storyText, 60);
    } else {
      // Set English as placeholder until translation response arrives
      previewText.textContent = storyText;
      // Hide typing cursor since we're not using typewriter
      const typingCursor = $$(".typing-cursor");
      if (typingCursor) typingCursor.classList.add("hidden");
    }
  }

  typewriterEffect(element, text, speed = 30) {
    if (!element || !text) return;

    element.textContent = "";
    let index = 0;
    const typingCursor = $$(".typing-cursor");

    // Clear any existing interval
    if (this.typewriterInterval) {
      clearInterval(this.typewriterInterval);
    }

    this.typewriterInterval = setInterval(() => {
      if (index < text.length) {
        element.textContent += text.charAt(index);
        index++;
      } else {
        // Typing complete, hide cursor after a moment
        clearInterval(this.typewriterInterval);
        this.typewriterInterval = null;
        setTimeout(() => {
          if (typingCursor) typingCursor.classList.add("hidden");
        }, 1000);
      }
    }, speed);
  }

  // Show skeleton placeholder for fictional image (called when event completes)
  showImageSkeleton(itemName) {
    const fictionalImagePreview = $("fictional-image-preview");
    const skeleton = $("image-skeleton");
    const skeletonLabel = $("skeleton-label-text");
    const previewImg = $("fictional-image-preview-img");
    const caption = $$(".fictional-image-caption");

    if (!fictionalImagePreview) return;

    // Ensure image and caption are hidden, skeleton visible
    if (previewImg) previewImg.classList.add("hidden");
    if (caption) caption.classList.add("hidden");
    if (skeleton) skeleton.classList.remove("hidden");

    // World-specific skeleton label
    const skeletonLabels = {
      Historical: `Painting ${itemName || "a historical scene"}...`,
      Overlaid: `Revealing ${itemName || "the hidden layer"}...`,
      Alternate: `Rendering ${itemName || "an alternate vision"}...`,
      SciFi_Earth: `Hologram of ${itemName || "future tech"} loading...`,
      SciFi_Galaxy: `Projecting ${itemName || "alien imagery"} from deep space...`,
      Fantasy: `Conjuring ${itemName || "an enchanted vision"}...`,
    };
    if (skeletonLabel) {
      skeletonLabel.textContent = skeletonLabels[this.selectedWorld] || `Generating ${itemName || "image"}...`;
    }

    // Show the container (skeleton visible inside)
    fictionalImagePreview.classList.remove("hidden");
  }

  // Swap skeleton → real image (called when image generation completes)
  // Typewriter effect for step detail lines (array of strings)
  typewriteStepDetails(container, lines, onComplete) {
    container.innerHTML = "";
    let lineIndex = 0;

    const typeLine = () => {
      if (lineIndex >= lines.length) {
        if (onComplete) onComplete();
        return;
      }

      const p = document.createElement("p");
      p.className = "step-detail-typewriter";
      container.appendChild(p);

      const text = lines[lineIndex];
      let charIndex = 0;

      const typeChar = () => {
        if (charIndex < text.length) {
          p.textContent += text.charAt(charIndex);
          charIndex++;
          setTimeout(typeChar, 35);
        } else {
          // Line done, remove cursor from this line
          p.classList.add("typing-done");
          lineIndex++;
          setTimeout(typeLine, 300);
        }
      };

      typeChar();
    };

    typeLine();
  }

  showFictionalImagePreview(imageUrl, itemName) {
    const fictionalImagePreview = $("fictional-image-preview");
    const skeleton = $("image-skeleton");
    const previewImg = $("fictional-image-preview-img");
    const captionText = $("fictional-image-caption-text");
    const caption = $$(".fictional-image-caption");

    if (!fictionalImagePreview || !previewImg) return;

    // Load image, then swap
    previewImg.onload = () => {
      // Hide skeleton, reveal image with animation
      if (skeleton) skeleton.classList.add("hidden");
      previewImg.classList.remove("hidden");
      if (caption) caption.classList.remove("hidden");
    };

    previewImg.src = imageUrl;
    if (captionText) captionText.textContent = itemName || "Fictional Item";

    // Ensure container is visible
    fictionalImagePreview.classList.remove("hidden");
  }

  // World-specific waiting messages
  getWorldMessages(world) {
    const worldMessages = {
      Historical: [
        "You wander through flickering gaslight on forgotten streets...",
        "Dust settles around you as an old door creaks open...",
        "You trace your fingers along a faded inscription on the wall...",
        "The scent of aged parchment fills the air around you...",
        "You peer through a window into a world centuries old...",
        "Cobblestones shift beneath your feet as the era reshapes itself...",
        "You overhear whispered conversations in a language almost forgotten...",
        "A distant bell tolls, marking the hour of another age...",
        "You feel the weight of history pressing gently on your shoulders...",
        "The scene before you flickers, assembling itself moment by moment...",
      ],
      Overlaid: [
        "You blink, and for an instant, you see two worlds at once...",
        "The edges of reality around you start to shimmer...",
        "Something moves in the corner of your eye — something that shouldn't be there...",
        "You reach out and feel the air grow thick, almost tangible...",
        "The familiar scene before you ripples like a reflection on water...",
        "Your shadow on the ground doesn't quite match your movements...",
        "You sense another presence layered just beyond your perception...",
        "The colors around you shift, revealing hues that don't belong here...",
        "You walk forward, and the ground beneath you hums with hidden energy...",
        "For a moment, you hear music — faint, otherworldly, beautiful...",
      ],
      Alternate: [
        "You feel a strange déjà vu, as if you've been here before — differently...",
        "The world around you flickers, like a page being rewritten...",
        "You notice small details that are wrong — a sign, a building, a name...",
        "A newspaper blows past your feet with headlines you don't recognize...",
        "You sense the weight of choices that were never made...",
        "The air crackles with the energy of diverging timelines...",
        "You catch a glimpse of yourself in a window — something is different...",
        "Familiar roads lead to unfamiliar destinations around you...",
        "You hear an echo of events that happened — and didn't...",
        "The timeline ripples, and somewhere, history rewrites itself...",
      ],
      SciFi_Earth: [
        "Holographic displays flicker to life around you...",
        "You feel the hum of quantum processors beneath your feet...",
        "A drone passes overhead, scanning the skyline of tomorrow...",
        "Neural pathways connect — you sense the pulse of a future city...",
        "Data streams flow past you like ribbons of light...",
        "You watch as the cityscape ahead reshapes itself in real time...",
        "Your augmented vision detects layers of information everywhere...",
        "The fusion grid hums steadily, powering the world around you...",
        "You hear the soft chime of an AI assistant calibrating nearby...",
        "Tomorrow's Earth is assembling itself around you, one pixel at a time...",
      ],
      SciFi_Galaxy: [
        "Stars drift past the viewport as your ship crosses the void...",
        "You feel the low vibration of the warp drive beneath you...",
        "An unknown constellation fills the observation deck...",
        "You catch a faint signal — something is out there, listening...",
        "Nebula light washes over you in shades of violet and gold...",
        "The navigation console charts a route through uncharted space...",
        "You float weightless for a moment as gravity recalibrates...",
        "An alien language scrolls across the communications panel...",
        "You gaze at a planet below — its surface unlike anything on Earth...",
        "The silence of deep space wraps around you like a blanket...",
      ],
      Fantasy: [
        "You follow a winding forest path as fireflies light the way...",
        "The crystal ball before you clouds, then begins to clear...",
        "You hear the distant rumble of a dragon stirring from slumber...",
        "Enchanted threads weave themselves into patterns around you...",
        "An ancient scroll unfurls before you, its ink still glowing...",
        "Castle gates groan open, revealing torchlit halls beyond...",
        "You watch elven hands at work, shaping something extraordinary...",
        "Moonlight spills through the canopy, revealing a hidden path...",
        "You feel the ground vibrate as a quest begins to take shape...",
        "The trees lean in, and the enchanted forest whispers your name...",
      ],
    };
    return worldMessages[world] || worldMessages.Fantasy;
  }

  startWaitingMessages() {
    const messages = this.getWorldMessages(this.selectedWorld);

    const messageEl = $("waiting-message-text");
    if (!messageEl) return;

    let index = 0;

    // Clear any existing interval
    if (this.waitingMessageInterval) {
      clearInterval(this.waitingMessageInterval);
    }

    // Change message every 4 seconds
    this.waitingMessageInterval = setInterval(() => {
      index = (index + 1) % messages.length;
      messageEl.style.opacity = "0";
      setTimeout(() => {
        messageEl.textContent = messages[index];
        messageEl.style.opacity = "1";
      }, 300);
    }, 4000);
  }

  stopWaitingMessages() {
    if (this.waitingMessageInterval) {
      clearInterval(this.waitingMessageInterval);
      this.waitingMessageInterval = null;
    }
  }

  updateProcessingStep(step, message, details = {}) {
    Logger.log("Processing step:", step, message, details);

    const stepMapping = {
      analyze: "step-analyze",
      event: "step-event",
      "fictional-image": "step-fictional-image",
      "3d-photo": "step-3d-photo",
      "3d-fictional": "step-3d-fictional",
      complete: null,
    };

    const stepId = stepMapping[step];
    if (!stepId) return;

    const stepElement = $(stepId);
    if (!stepElement) return;

    // Update step status
    stepElement.dataset.status = details.status || "active";

    // Update status icon
    const statusIcon = stepElement.querySelector(".step-status-icon");
    if (statusIcon) {
      const iconMap = {
        pending: "⏸️",
        active: "⏳",
        completed: "✅",
        error: "❌",
      };
      statusIcon.textContent = iconMap[details.status] || "⏳";
    }

    // Update details text
    const detailsEl = $(`${stepId}-details`);
    if (detailsEl && message) {
      // Step 1: Analyze - show photo place and item with typewriter
      if (step === "analyze" && (details.photoPlace || details.photoItem)) {
        this.typewriteStepDetails(detailsEl, [
          details.photoPlace ? `📍 Place: ${details.photoPlace}` : null,
          details.photoItem ? `🔍 Item: ${details.photoItem}` : null,
        ].filter(Boolean));
      }
      // Step 2: Event - show fictional item/location with typewriter, then story
      else if (step === "event" && details.status === "completed") {
        this.typewriteStepDetails(detailsEl, [
          details.fictionalLocation ? `📍 Location: ${details.fictionalLocation}` : null,
          details.fictionalItem ? `🔮 Fictional: ${details.fictionalItem}` : null,
        ].filter(Boolean), () => {
          // After details typed, show story preview with typewriter effect
          if (details.storyText) {
            this.showStoryPreview(details.storyText, details);
          }
        });
        // Show image skeleton immediately (image is generating in background)
        this.showImageSkeleton(details.fictionalItem);

        // Reveal Phase 2 (Step 3: Image Generation)
        this.revealPhase("phase-2");
      } else {
        detailsEl.innerHTML = `<p>${message}</p>`;
      }
    }

    // When fictional-image is complete, show the image preview
    if (
      step === "fictional-image" &&
      details.status === "completed" &&
      details.fictionalImageUrl
    ) {
      this.showFictionalImagePreview(
        details.fictionalImageUrl,
        details.fictionalItemName || "Fictional Item",
      );

      // Pre-load fictional image for puzzle and show Finish Reading button
      this.preloadPuzzleImage(details.fictionalImageUrl);
      this.showFinishReadingButton();

      // Reveal Phase 3 (Step 4A & 4B: 3D Models)
      this.revealPhase("phase-3");
    }

    // Update progress bar
    if (details.progress !== undefined) {
      const progressFill = $(`${stepId}-progress`);
      const percentText = $(`${stepId}-percent`);
      if (progressFill) {
        progressFill.style.width = `${details.progress}%`;
      }
      if (percentText) {
        percentText.textContent = `${details.progress}%`;
      }
    }

    // Sync 3D progress to puzzle/appreciation progress bars
    if (step === "3d-photo" || step === "3d-fictional") {
      // Calculate combined 3D progress (average of both)
      const photoProgress = parseFloat($(`step-3d-photo-progress`)?.style.width) || 0;
      const fictionalProgress = parseFloat($(`step-3d-fictional-progress`)?.style.width) || 0;
      const combined3D = (photoProgress + fictionalProgress) / 2;
      this.syncPuzzle3DProgress(combined3D);
    }

    // Update overall progress based on step (5 steps now)
    const stepWeights = {
      analyze: 15,
      event: 15,
      "fictional-image": 20,
      "3d-photo": 25,
      "3d-fictional": 25,
    };

    if (details.status === "completed") {
      const completedWeight = stepWeights[step] || 0;
      this.processingProgress =
        (this.processingProgress || 0) + completedWeight;
      this.updateOverallProgress(Math.min(this.processingProgress, 100));

      // Stop waiting messages when complete
      if (
        step === "complete" ||
        (step === "3d-fictional" && details.status === "completed")
      ) {
        this.stopWaitingMessages();
      }
    }
  }

  updateOverallProgress(percent) {
    const progressFill = $("overall-progress-fill");
    const percentText = $("overall-percent");
    const timeRemaining = $("time-remaining");

    if (progressFill) {
      progressFill.style.width = `${percent}%`;
    }
    if (percentText) {
      percentText.textContent = `${percent}%`;
    }
    if (timeRemaining) {
      const remainingSeconds = Math.max(0, Math.round((100 - percent) * 0.6));
      timeRemaining.textContent = `~${remainingSeconds}s`;
    }

    // Sync collapsed header mini progress
    this.updateStepsMiniProgress(percent);
  }

  showProcessingError(message) {
    // Find the active step and mark it as error
    const steps = $$$(".process-step-card");
    steps.forEach((step) => {
      if (step.dataset.status === "active") {
        step.dataset.status = "error";
        const icon = step.querySelector(".step-status-icon");
        if (icon) icon.textContent = "❌";
      }
    });

    // Hide world badge and show error state
    this.hideAllBadges();

    // Auto-expand processing steps on error for debugging
    const stepsContainer = $$(".processing-steps-container");
    if (stepsContainer) stepsContainer.classList.remove("collapsed");

    // Show error in processing main with retry/back buttons
    const processingText = $$(".processing-text");
    if (processingText) {
      processingText.innerHTML = `
        <span style="color: #ffcccc;">❌ Error: ${message}</span>
        <div style="display: flex; gap: 12px; justify-content: center; margin-top: 16px;">
          <button id="processing-retry-btn" style="
            padding: 10px 24px; border-radius: 8px; border: none;
            background: #667eea; color: white; font-size: 0.95rem;
            cursor: pointer;
          ">🔄 Retry</button>
          <button id="processing-back-btn" style="
            padding: 10px 24px; border-radius: 8px; border: 1px solid #667eea;
            background: transparent; color: #667eea; font-size: 0.95rem;
            cursor: pointer;
          ">← Back to Photo</button>
        </div>
      `;

      // Retry: attempt server-side recovery (event may have been created)
      const retryBtn = $("processing-retry-btn");
      if (retryBtn) {
        on(retryBtn, "click", async () => {
          retryBtn.disabled = true;
          retryBtn.textContent = "⏳ Checking...";
          try {
            const response = await fetch(`/api/stories/${this.journeyId}`);
            const data = await response.json();
            if (data.success && data.journey) {
              this.loadExistingJourney(data.journey);
            } else {
              // Server has no new event — go back to photo upload
              this.navigateTo(PAGES.PHOTO_UPLOAD);
              this.updatePhotoUploadPage();
            }
          } catch (retryError) {
            // Still no network — show brief message then reset button
            retryBtn.textContent = "❌ Still offline";
            setTimeout(() => {
              retryBtn.disabled = false;
              retryBtn.textContent = "🔄 Retry";
            }, 2000);
          }
        });
      }

      // Back: return to photo upload page
      const backBtn = $("processing-back-btn");
      if (backBtn) {
        on(backBtn, "click", () => {
          this.navigateTo(PAGES.PHOTO_UPLOAD);
          this.updatePhotoUploadPage();
        });
      }
    }

    // Stop waiting messages
    this.stopWaitingMessages();
  }

  // ==========================================
  // Reveal Transition (P2-1)
  // ==========================================

  getRevealMessage(world) {
    const messages = {
      Historical: [
        "The dust settles... and the past reveals what it has been keeping.",
        "A chapter lost to time now lies open before you.",
        "History has answered your call. See what it has brought.",
      ],
      Overlaid: [
        "The veil lifts... and what was hidden stands in plain sight.",
        "Two worlds overlap — and something extraordinary emerges.",
        "Reality shivers, and the overlay reveals its secret.",
      ],
      Alternate: [
        "The timeline splits... and a new reality crystallizes.",
        "What could have been now stands before you, vivid and real.",
        "The divergence is complete. Behold what this world has become.",
      ],
      SciFi_Earth: [
        "The hologram stabilizes... the future unfolds before your eyes.",
        "Data streams converge into something tangible — tomorrow made real.",
        "Quantum fabrication complete. The future has arrived.",
      ],
      SciFi_Galaxy: [
        "The transmission clears... a gift from across the stars.",
        "Light-years of silence break — the galaxy has spoken.",
        "From the depths of space, something extraordinary reaches you.",
      ],
      Fantasy: [
        "The mist parts... and the enchantment reveals its creation.",
        "Magic weaves its final thread — behold what it has conjured.",
        "The spell is cast. The enchanted realm offers its treasure.",
      ],
    };
    const pool = messages[world] || messages.Fantasy;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  playRevealTransition() {
    return new Promise((resolve) => {
      const overlay = $("reveal-overlay");
      const textEl = $("reveal-narrative-text");
      if (!overlay || !textEl) {
        // Fallback: simple delay if overlay missing
        setTimeout(resolve, 1500);
        return;
      }

      // Set narrative text
      textEl.textContent = this.getRevealMessage(this.selectedWorld);

      // Show overlay
      removeClass(overlay, "hidden");
      // Force reflow for animation
      void overlay.offsetHeight;
      addClass(overlay, "active");

      // Trigger flash after text appears
      setTimeout(() => addClass(overlay, "flash"), 800);

      // Begin fade-out after reveal
      setTimeout(() => {
        overlay.style.transition = "opacity 0.6s ease";
        overlay.style.opacity = "0";
      }, 2800);

      // Clean up and resolve
      setTimeout(() => {
        removeClass(overlay, "active");
        removeClass(overlay, "flash");
        addClass(overlay, "hidden");
        overlay.style.transition = "";
        overlay.style.opacity = "";
        resolve();
      }, 3400);
    });
  }

  // ==========================================
  // Event Result
  // ==========================================

  showEventResult(eventData) {
    Logger.log("Showing event result:", eventData);

    // 🔗 Store event data globally for AR launcher
    window.currentEventData = eventData;

    const event = eventData.event || {};

    // Update header
    const eventTitle = $("event-title");
    if (eventTitle) {
      eventTitle.textContent = `Event ${eventData.index + 1}`;
    }

    // Update event counter in header
    const eventCounterSpan = $$(".event-counter");
    if (eventCounterSpan) {
      eventCounterSpan.textContent = `${
        eventData.index + 1
      }/${PHOTOS_PER_STORY}`;
    }

    // Update event result page event counter
    const resultEventNum = $("result-event-num");
    const resultTotalEvents = $("result-total-events");
    if (resultEventNum) {
      resultEventNum.textContent = eventData.index + 1;
    }
    if (resultTotalEvents) {
      resultTotalEvents.textContent = PHOTOS_PER_STORY;
    }

    // Update story text
    const storyText = $("event-story-text");
    if (storyText) {
      storyText.textContent =
        event.storyText ||
        event.event_text ||
        "You discovered something magical...";
      // Register original text for translation
      this.setOriginalText("event-story-text", storyText.textContent);
    }

    // Update AR Interaction section
    const arInteractionType = $("ar-interaction-type");
    const arInteractionIcon = $("ar-interaction-icon");
    const arInteractionDesc = $("ar-interaction-desc");

    const interactionType =
      event.ar_interaction || event.arInteraction || "Tap";

    // Set interaction icon based on type
    const interactionIcons = {
      Tap: "👆",
      Rotate: "🔄",
      Track: "🎯",
    };

    // Set interaction description based on type (synced with app.py AR_INTERACTIONS)
    // Tap -> Tap folder, Rotate -> RotateItem folder, Track -> Track folder
    const interactionDescriptions = {
      Tap: "Tap at some animated marks on the surface of a 3D object; the fictional item or character then appears.",
      Rotate:
        "Use two fingers to rotate the 3D object; at 180°, the object turns transparent and reveals the fictional item or character inside.",
      Track:
        "Hold the camera to track the slowly moving 3D object (in mid-air); after tracking for a while, the fictional item or character appears.",
    };

    if (arInteractionType) {
      arInteractionType.textContent = interactionType;
    }
    if (arInteractionIcon) {
      arInteractionIcon.textContent = interactionIcons[interactionType] || "👆";
    }
    if (arInteractionDesc) {
      arInteractionDesc.textContent =
        event.ar_interaction_description ||
        interactionDescriptions[interactionType] ||
        interactionDescriptions.Tap;
    }

    // Update original photo
    const originalPhoto = $("result-original-photo");
    if (originalPhoto && event.photoImageUrl) {
      originalPhoto.src = event.photoImageUrl;
      originalPhoto.alt = "Original Photo";
    }

    const photoItemName = $("photo-item-name");
    if (photoItemName) {
      photoItemName.textContent =
        event.photoItemName || event.photo_item || "Photo Item";
    }

    // Update fictional image
    const fictionalImage = $("result-fictional-image");
    if (fictionalImage && event.fictionalImageUrl) {
      fictionalImage.src = event.fictionalImageUrl;
      fictionalImage.alt = "AI Generated Fictional Item";
    }

    const fictionalItemName = $("fictional-item-name");
    if (fictionalItemName) {
      fictionalItemName.textContent =
        event.fictionalItemName || event.item_or_character || "Fictional Item";
    }

    // Update 3D section titles
    const photo3dTitle = $("photo-3d-title");
    if (photo3dTitle) {
      photo3dTitle.textContent = `3D: ${
        event.photoItemName || event.photo_item || "Photo Item"
      }`;
    }

    const fictional3dTitle = $("fictional-3d-title");
    if (fictional3dTitle) {
      fictional3dTitle.textContent = `3D: ${
        event.fictionalItemName || event.item_or_character || "Fictional Item"
      }`;
    }

    // Initialize 3D viewers
    this.initResultViewers(eventData);

    // Setup download buttons
    this.setupDownloadButtons(eventData);

    // Update continue button (disabled until AR Interaction is clicked)
    const continueBtn = $("continue-adventure-btn");
    if (continueBtn) {
      const nextIndex = this.currentPhotoIndex + 2;
      if (this.currentPhotoIndex >= PHOTOS_PER_STORY - 1) {
        continueBtn.textContent = "🎉 Complete Story";
      } else {
        continueBtn.innerHTML = `📸 Next Photo <span id="next-photo-num">(${nextIndex}/${PHOTOS_PER_STORY})</span>`;
      }
      // Disable button until user clicks AR Interaction
      continueBtn.disabled = true;
    }

    // Navigate to event result page
    this.navigateTo(PAGES.EVENT_RESULT);
  }

  initResultViewers(eventData) {
    // Initialize Three.js viewers for 3D models
    const photoViewerContainer = $("viewer-photo-item");
    const fictionalViewerContainer = $("viewer-fictional-item");

    // 🧹 Properly dispose existing viewers BEFORE clearing containers
    // This prevents the "orphaned canvas" problem where viewer references
    // point to deleted DOM elements
    if (this.dualViewer) {
      try {
        this.dualViewer.dispose(); // 🔧 Use dispose() instead of clear()
        this.dualViewer = null; // 🔧 Reset reference to force new instance
        console.log("🗑️ Old DualViewer disposed successfully");
      } catch (error) {
        console.warn("DualViewer dispose warning:", error);
        this.dualViewer = null;
      }
    }

    // Clear containers (now safe because viewer is disposed)
    if (photoViewerContainer) photoViewerContainer.innerHTML = "";
    if (fictionalViewerContainer) fictionalViewerContainer.innerHTML = "";

    // Check if we have 3D models
    if (eventData.photoModelUrl || eventData.fictionalModelUrl) {
      // 🔄 Reuse or create DualViewer
      if (!this.dualViewer) {
        console.log("🆕 Creating new DualViewer instance");
        this.dualViewer = new DualViewer({
          photoContainer: "viewer-photo-item",
          fictionalContainer: "viewer-fictional-item",
        });
      }

      // Load 3D models
      this.dualViewer.loadModelsIntoContainers(
        eventData.photoModelUrl,
        eventData.fictionalModelUrl,
        photoViewerContainer,
        fictionalViewerContainer,
      );
    } else {
      // Show placeholder when 3D is skipped
      if (photoViewerContainer) {
        photoViewerContainer.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:0.9rem;">3D Generation Skipped</div>';
      }
      if (fictionalViewerContainer) {
        fictionalViewerContainer.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:0.9rem;">3D Generation Skipped</div>';
      }
    }
  }

  createSimpleViewer(container, modelUrl) {
    if (!container || !modelUrl) return;

    // Create a basic Three.js scene for the model
    const scene = new THREE.Scene();
    scene.background = _createStoryGradientBackground();

    const width = container.clientWidth || 200;
    const height = container.clientHeight || 200;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(2, 2, 2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Add OrbitControls for interaction
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Studio-style lighting
    const hemiLight = new THREE.HemisphereLight(0xc4a870, 0x8899aa, 0.6);
    scene.add(hemiLight);
    const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.4);
    scene.add(ambientLight);
    const keyLight = new THREE.DirectionalLight(0xfff0dd, 1.2);
    keyLight.position.set(-3, 5, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xd4e0f0, 0.6);
    fillLight.position.set(4, 2, -1);
    scene.add(fillLight);

    // Load GLB model using the imported GLTFLoader
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        scene.add(gltf.scene);

        // Center and scale the model
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.5 / maxDim;
        gltf.scene.scale.multiplyScalar(scale);

        const center = box.getCenter(new THREE.Vector3());
        gltf.scene.position.sub(center.multiplyScalar(scale));
      },
      undefined,
      (error) => {
        console.error("Error loading model:", error);
        container.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#f88;font-size:0.85rem;">Failed to load model</div>';
      },
    );

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Handle container resize
    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);
  }

  setupDownloadButtons(eventData) {
    const downloadPhotoBtn = $("download-photo-model-btn");
    const downloadFictionalBtn = $("download-fictional-model-btn");

    if (downloadPhotoBtn) {
      if (eventData.photoModelUrl) {
        downloadPhotoBtn.onclick = () =>
          this.downloadModel(eventData.photoModelUrl, "photo-item.glb");
        downloadPhotoBtn.disabled = false;
        downloadPhotoBtn.style.opacity = "1";
      } else {
        downloadPhotoBtn.disabled = true;
        downloadPhotoBtn.style.opacity = "0.5";
        downloadPhotoBtn.textContent = "⬇️ No 3D Model";
      }
    }

    if (downloadFictionalBtn) {
      if (eventData.fictionalModelUrl) {
        downloadFictionalBtn.onclick = () =>
          this.downloadModel(eventData.fictionalModelUrl, "fictional-item.glb");
        downloadFictionalBtn.disabled = false;
        downloadFictionalBtn.style.opacity = "1";
      } else {
        downloadFictionalBtn.disabled = true;
        downloadFictionalBtn.style.opacity = "0.5";
        downloadFictionalBtn.textContent = "⬇️ No 3D Model";
      }
    }
  }

  downloadModel(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  displayPhotoAnalysis(event) {
    // Legacy function - kept for backward compatibility
    // The new design displays analysis info directly in the result sections
  }

  // ==========================================
  // Continue Adventure / Complete
  // ==========================================

  continueAdventure() {
    this.currentPhotoIndex++;

    if (this.currentPhotoIndex >= PHOTOS_PER_STORY) {
      // Story complete
      this.showStoryComplete();
    } else {
      // Continue to next photo
      this.clearPhotoPreview();
      this.updateProgressBar();
      this.updateStoryContextMini();
      this.navigateTo(PAGES.PHOTO_UPLOAD);
    }

    this.saveState();
  }

  // ==========================================
  // Story Complete
  // ==========================================

  showStoryComplete() {
    Logger.log("Story complete!");

    // Build complete story content
    this.buildCompleteStory();

    // Build collection grid
    this.buildCollectionGrid();

    // Navigate to complete page
    this.navigateTo(PAGES.STORY_COMPLETE);

    // Auto-translate if user's preferred language is not English
    if (this._preferredLang !== "en") {
      this.switchLanguage("complete-story", this._preferredLang);
    }

    // Save state so refresh can restore to complete page (especially for guests)
    this.saveState();
  }

  buildCompleteStory() {
    const completeStoryContent = $("complete-story-content");
    if (!completeStoryContent) return;

    let storyHtml = "";

    // Add opening story
    if (this.currentStory) {
      storyHtml += `<div class="story-section">
                <strong>Prologue</strong>
                ${
                  this.currentStory.storyHtml ||
                  `<p>${this.currentStory.storyPlain}</p>`
                }
            </div>`;
    }

    // Add each event (handle both frontend format {event: {...}} and backend format)
    this.events.forEach((eventData, index) => {
      const event = eventData.event || eventData;
      const text = event.storyText || event.event_text || "";
      const imgUrl = event.fictionalImageUrl || event.fictional_image_url || eventData.fictional_image_url || "";
      const itemName = event.fictionalItemName || event.fictional_item_name || event.fictional_item_or_character || event.item_or_character || "";

      let imgHtml = "";
      if (imgUrl) {
        imgHtml = `<figure class="story-illustration" aria-hidden="true">
                    <img src="${imgUrl}" alt="" loading="lazy">
                    ${itemName ? `<figcaption>🔮 ${itemName}</figcaption>` : ""}
                </figure>`;
      }

      storyHtml += `<div class="story-section">
                <strong>Event ${index + 1}</strong>
                <p>${text}</p>
                ${imgHtml}
            </div>`;
    });

    completeStoryContent.innerHTML = storyHtml;

    // Clear any cached original text so language switcher picks up the new content
    delete this._originalTexts["complete-story-content"];
    delete this._originalHtml["complete-story-content"];
  }

  buildCollectionGrid() {
    const collectionGrid = $("collection-grid");
    if (!collectionGrid) return;

    // 🆕 先清理旧的 MiniViewer 和取消未完成的初始化
    this.disposeMiniViewers();
    if (this._collectionGridTimeout) {
      clearTimeout(this._collectionGridTimeout);
      this._collectionGridTimeout = null;
    }

    let gridHtml = "";

    this.collectedItems.forEach((item, index) => {
      gridHtml += `
                <div class="collection-item" data-index="${index}">
                    <div class="item-viewer" id="collection-item-${index}"></div>
                    <div class="item-name">${item.name}</div>
                </div>
            `;
    });

    collectionGrid.innerHTML = gridHtml;

    // 🆕 初始化 MiniViewer 并加载模型
    // 使用延迟确保 DOM 已渲染，并保存 timeout ID 以便取消
    this._collectionGridTimeout = setTimeout(() => {
      this._collectionGridTimeout = null;

      // 🆕 记录当前批次的 ID，用于检测是否被新的批次取消
      const batchId = Date.now();
      this._currentBatchId = batchId;

      this.collectedItems.forEach((item, index) => {
        if (item.modelUrl) {
          try {
            const containerId = `collection-item-${index}`;
            const container = document.getElementById(containerId);

            if (container) {
              console.log(
                `🎨 Creating MiniViewer for ${item.name} (batch: ${batchId})`,
              );
              const miniViewer = new MiniViewer(containerId);

              miniViewer
                .loadModel(item.modelUrl)
                .then(() => {
                  // 🆕 检查是否是当前批次，避免覆盖新的内容
                  if (this._currentBatchId !== batchId) {
                    console.log(`⏭️ Skipping stale batch for ${item.name}`);
                    return;
                  }
                  console.log(`✅ Loaded model for ${item.name}`);
                })
                .catch((error) => {
                  // 🆕 检查是否是当前批次
                  if (this._currentBatchId !== batchId) {
                    console.log(`⏭️ Skipping stale error for ${item.name}`);
                    return;
                  }

                  console.warn(
                    `⚠️ Failed to load model for ${item.name}:`,
                    error,
                  );

                  // 🆕 只有在容器中没有 canvas 时才显示错误
                  const currentContainer = document.getElementById(containerId);
                  if (
                    currentContainer &&
                    !currentContainer.querySelector("canvas")
                  ) {
                    currentContainer.innerHTML =
                      '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:0.8rem;">3D Not Available</div>';
                  }
                });

              this.miniViewers.push(miniViewer);
            }
          } catch (error) {
            console.warn(
              `❌ Error creating MiniViewer for item ${index}:`,
              error,
            );
          }
        } else {
          // 没有模型URL时显示占位符
          const container = document.getElementById(`collection-item-${index}`);
          if (container) {
            container.innerHTML =
              '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:0.8rem;">No 3D Model</div>';
          }
        }
      });
    }, 100);
  }

  // 🆕 清理所有 MiniViewer 实例
  disposeMiniViewers() {
    if (this.miniViewers && this.miniViewers.length > 0) {
      console.log(`🗑️ Disposing ${this.miniViewers.length} MiniViewers`);
      this.miniViewers.forEach((viewer) => {
        try {
          viewer.dispose();
        } catch (error) {
          console.warn("MiniViewer dispose warning:", error);
        }
      });
      this.miniViewers = [];
    }
  }

  // ==========================================
  // Fullscreen Viewer
  // ==========================================

  openFullscreen(viewerType) {
    Logger.log("Opening fullscreen:", viewerType);

    const currentEvent = this.events[this.events.length - 1];
    if (!currentEvent) return;

    let modelUrl, title;

    if (viewerType === "photo") {
      modelUrl = currentEvent.photoModelUrl;
      title = "📷 Real Item - 3D Model";
    } else {
      modelUrl = currentEvent.fictionalModelUrl;
      title = "✨ Fictional Avatar - 3D Model";
    }

    if (modelUrl && this.fullscreenViewer) {
      // Update title
      const titleEl = $("fullscreen-viewer-title");
      if (titleEl) {
        titleEl.textContent = title;
      }

      // Store current model URL for download
      this.currentFullscreenModelUrl = modelUrl;

      // Show modal and load model
      this.fullscreenViewer.show(modelUrl);
    }
  }

  closeFullscreen() {
    if (this.fullscreenViewer) {
      this.fullscreenViewer.hide();
    }
  }

  downloadCurrentModel() {
    if (this.currentFullscreenModelUrl) {
      const filename = `imaginary-world-model-${Date.now()}.glb`;
      downloadFile(this.currentFullscreenModelUrl, filename);
    }
  }

  // ==========================================
  // New Adventure / Share
  // ==========================================

  startNewAdventure() {
    Logger.log("Starting new adventure...");

    // Reset all state
    this.selectedWorld = null;
    this.journeyId = null;
    this.currentStory = null;
    this.currentPhotoIndex = 0;
    this.events = [];
    this.collectedItems = [];
    this.selectedPhoto = null;
    this.selectedPhotoDataUrl = null;

    // Clear viewers
    if (this.dualViewer) {
      this.dualViewer.clear();
    }

    // 🆕 清理收藏品页面的 MiniViewer
    this.disposeMiniViewers();

    // Navigate to world selection
    this.navigateTo(PAGES.WORLD_SELECTION);
  }

  shareStory() {
    Logger.log("Sharing story...");

    // Build share text
    const shareText = `I just completed an adventure in ${
      WORLD_NAMES[this.selectedWorld] || "Imaginary World"
    }! 🌟`;

    if (navigator.share) {
      navigator
        .share({
          title: "Imaginary World Adventure",
          text: shareText,
          url: window.location.href,
        })
        .catch((err) => {
          Logger.warn("Share failed:", err);
        });
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard
        .writeText(shareText)
        .then(() => {
          alert("Story copied to clipboard!");
        })
        .catch(() => {
          alert(shareText);
        });
    }
  }

  // ==========================================
  // State Persistence
  // ==========================================

  saveState() {
    const state = {
      currentPage: this.currentPage,
      selectedWorld: this.selectedWorld,
      journeyId: this.journeyId,
      userFolderId: this.userFolderId,
      currentStory: this.currentStory,
      currentPhotoIndex: this.currentPhotoIndex,
      events: this.events,
      collectedItems: this.collectedItems,
    };

    saveToStorage("iw_story_state", state);
    Logger.log("State saved");
  }

  restoreState() {
    const state = loadFromStorage("iw_story_state");

    if (state && state.journeyId) {
      Logger.log("Restoring state:", state);

      this.currentPage = state.currentPage || PAGES.WORLD_SELECTION;
      this.selectedWorld = state.selectedWorld;
      this.journeyId = state.journeyId;
      this.userFolderId = state.userFolderId;
      this.currentStory = state.currentStory;
      this.currentPhotoIndex = state.currentPhotoIndex || 0;
      this.events = state.events || [];
      this.collectedItems = state.collectedItems || [];

      // Update UI based on restored state
      if (this.currentPage === PAGES.PHOTO_UPLOAD) {
        this.updateProgressBar();
        this.updateStoryContextMini();
      }
    }
  }

  clearState() {
    saveToStorage("iw_story_state", null);
    Logger.log("State cleared");
  }

  // 🔄 Clear stored state completely
  clearStoredState() {
    // Clear the main story state
    saveToStorage("iw_story_state", null);

    // Clear processing recovery state
    removeFromStorage("iw_processing_state");

    // Clear any other potential storage keys
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("iw_story_state");
        localStorage.removeItem("imaginary_world_state");
        localStorage.removeItem("story_progress");
      }
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.clear();
      }
    } catch (e) {
      // Storage might be disabled
      Logger.log("Storage clear warning:", e);
    }

    Logger.log("All stored state cleared - fresh start");
  }

  // 🔄 Reset to first page state
  resetToFirstPage() {
    // Reset all state properties to initial values
    this.currentPage = PAGES.WORLD_SELECTION;
    this.selectedWorld = null;
    this.journeyId = null;
    this.userFolderId = null;
    this.currentStory = null;
    this.currentPhotoIndex = 0;
    this.events = [];
    this.collectedItems = [];
    this.selectedPhoto = null;
    this.selectedPhotoDataUrl = null;

    // Clear any UI state
    this.clearPhotoPreview();

    Logger.log("Reset to first page - all state cleared");
  }

  // ==========================================
  // 🏛️ World Badge System
  // ==========================================

  activateWorldBadge(world) {
    // Map world names to badge CSS classes
    const worldToBadgeClass = {
      Historical: "badge-historical",
      Overlaid: "badge-overlaid",
      Alternate: "badge-alternate",
      SciFi_Earth: "badge-scifi-earth",
      SciFi_Galaxy: "badge-scifi-galaxy",
      Fantasy: "badge-fantasy",
    };

    // Hide all badges first
    this.hideAllBadges();

    // Activate the correct badge
    const badgeClass = worldToBadgeClass[world];
    if (badgeClass) {
      const badge = $$(`.${badgeClass}`);
      if (badge) {
        badge.classList.add("active");
        Logger.log(`World badge activated: ${world}`);
      }
    }
  }

  hideAllBadges() {
    const allBadges = $$$(".badge-icon");
    allBadges.forEach((badge) => {
      badge.classList.remove("active");
    });
  }

  // ==========================================
  // 🧩 Fictional Image Puzzle Mini-Game
  // ==========================================

  // Pre-load and slice the fictional image into a 3×3 grid (called during Event Text display)
  preloadPuzzleImage(imageUrl) {
    if (!imageUrl) return;
    this.puzzleFictionalImageUrl = imageUrl;
    // Pre-create an Image object so it's cached by the time user clicks Finish Reading
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      this.puzzleImageReady = true;
      Logger.log("Puzzle: Fictional image pre-loaded");
    };
    img.onerror = () => {
      Logger.log("Puzzle: Failed to pre-load fictional image, will retry on start");
      this.puzzleImageReady = false;
    };
    img.src = imageUrl;
    this._puzzleImg = img;
  }

  // Show "Finish Reading" button (called after fictional image is displayed)
  showFinishReadingButton() {
    const section = $("finish-reading-section");
    if (!section) return;

    // Bind click handler immediately (but section stays hidden)
    const btn = $("finish-reading-btn");
    if (btn) {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", () => this.onFinishReading());
    }

    // Delay 15s before showing, giving user time to read the event text
    this._finishReadingTimer = setTimeout(() => {
      section.classList.remove("hidden");
      section.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 15000);
  }

  hideFinishReadingButton() {
    const section = $("finish-reading-section");
    if (section) section.classList.add("hidden");
  }

  // User clicked "Finish Reading" — transition from story to puzzle
  onFinishReading() {
    this.hideFinishReadingButton();

    // Start the puzzle (story preview remains visible above)
    this.initPuzzleGame();
  }

  initPuzzleGame() {
    const imageUrl = this.puzzleFictionalImageUrl;
    if (!imageUrl) {
      Logger.log("Puzzle: No fictional image URL available");
      return;
    }

    // Puzzle state
    this.puzzleState = {
      tiles: [0, 1, 2, 3, 4, 5, 6, 7, 8], // 8 = empty
      moves: 0,
      startTime: null,
      timerInterval: null,
      solved: false,
      imageLoaded: false,
      removedTileIndex: 4, // center tile by default
    };

    const puzzleSection = $("puzzle-game-section");
    if (!puzzleSection) return;

    // Apply world-specific styling
    puzzleSection.className = "puzzle-game-section";
    if (this.selectedWorld) {
      puzzleSection.classList.add(`world-${this.selectedWorld}`);
    }

    // Set world-themed title
    const titleEl = $("puzzle-title");
    if (titleEl) {
      const titles = {
        Historical: "Restore the Ancient Vision",
        Overlaid: "Reveal the Hidden Layer",
        Alternate: "Reconstruct the Alternate View",
        SciFi_Earth: "Reassemble the Hologram",
        SciFi_Galaxy: "Decode the Alien Signal",
        Fantasy: "Piece Together the Enchantment",
      };
      titleEl.textContent = titles[this.selectedWorld] || "Restore the Vision";
    }

    // Load image and start puzzle
    const doSetup = () => {
      this.puzzleState.imageLoaded = true;
      // Choose which tile to remove: prefer center (4), or random if center is too easy
      // 70% chance center tile, 30% chance random non-corner tile
      const rand = Math.random();
      if (rand < 0.7) {
        this.puzzleState.removedTileIndex = 4; // center
      } else {
        // Pick from edge/center tiles (1,3,4,5,7) — more impactful than corners
        const candidates = [1, 3, 5, 7];
        this.puzzleState.removedTileIndex = candidates[Math.floor(Math.random() * candidates.length)];
      }

      // First show the complete image briefly, then dissolve a tile
      this.showCompleteImageThenDissolve(puzzleSection);
    };

    if (this._puzzleImg && this._puzzleImg.complete && this._puzzleImg.naturalWidth > 0) {
      doSetup();
    } else {
      // Fallback: reload image
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { this._puzzleImg = img; doSetup(); };
      img.onerror = () => { this._puzzleImg = img; doSetup(); }; // show even if broken
      img.src = imageUrl;
    }
  }

  // Show the full 3×3 image grid, then animate one tile dissolving away
  showCompleteImageThenDissolve(puzzleSection) {
    const puzzleBoard = $("puzzle-board");
    if (!puzzleBoard) return;
    puzzleBoard.innerHTML = "";

    const imageUrl = this.puzzleFictionalImageUrl;
    const removedIdx = this.puzzleState.removedTileIndex;

    // Render all 9 tiles as a complete image
    for (let i = 0; i < 9; i++) {
      const tile = document.createElement("div");
      tile.className = "puzzle-tile";
      const row = Math.floor(i / 3);
      const col = i % 3;
      tile.style.backgroundImage = `url(${imageUrl})`;
      tile.style.backgroundPosition = `${col * 50}% ${row * 50}%`;
      tile.dataset.index = i;
      puzzleBoard.appendChild(tile);
    }

    // Show the puzzle section with complete image
    puzzleSection.classList.remove("hidden");
    puzzleSection.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // After 800ms, dissolve the selected tile with world-themed animation
    setTimeout(() => {
      const tileToRemove = puzzleBoard.children[removedIdx];
      if (tileToRemove) {
        tileToRemove.classList.add("dissolving");

        // After dissolve animation completes (~1s), shuffle and start
        setTimeout(() => {
          this.startPuzzleAfterDissolve();
        }, 1000);
      }
    }, 800);
  }

  // After dissolve animation, shuffle tiles and start the interactive puzzle
  startPuzzleAfterDissolve() {
    const removedTileValue = this.puzzleState.removedTileIndex;

    // Build initial ordered array, where removedTileValue maps to 8 (empty)
    // We need to remap: the removed tile becomes the "empty" slot
    // Tile values 0-8, where removedTileValue becomes 8 (empty), and original 8 doesn't exist
    // Actually for a sliding puzzle we just need 8 pieces + 1 gap
    // Map tile IDs: 0..8, skip the removed one, the gap is at the removed position
    this.puzzleState.tiles = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    // Mark the removed tile position as empty (8)
    // Swap the value at removedTileValue position with value 8 at position 8
    // Actually we keep it simpler: 
    // tiles[i] = tile value displayed at position i
    // value 8 = empty slot, values 0-7 = image pieces
    // We want piece[removedTileValue] to not exist (it's the dissolved piece)
    // So we renumber: all original positions except removedTileValue become pieces 0-7
    // For rendering: piece N maps to original grid position through a lookup

    // Create mapping from piece ID (0-7) to original 3×3 grid position
    this.puzzlePieceToOriginal = [];
    for (let i = 0; i < 9; i++) {
      if (i !== removedTileValue) {
        this.puzzlePieceToOriginal.push(i);
      }
    }
    // Now puzzlePieceToOriginal[0..7] maps to the 8 surviving original positions

    // Initial solved state: piece N should be at a position such that
    // the image looks correct. We need to figure out correct positions.
    // The correct arrangement: at grid position i, piece that originally belongs there
    // For the removed position, the empty tile goes there
    // Correct tiles array: tiles[pos] = piece whose original == pos
    // For pos == removedTileValue, tiles[pos] = 8 (empty)
    const solvedTiles = new Array(9);
    for (let pos = 0; pos < 9; pos++) {
      if (pos === removedTileValue) {
        solvedTiles[pos] = 8; // empty goes where the dissolved tile was
      } else {
        solvedTiles[pos] = this.puzzlePieceToOriginal.indexOf(pos);
      }
    }

    // Start from solved state and shuffle via valid moves
    this.puzzleState.tiles = [...solvedTiles];
    this.shufflePuzzle();

    this.puzzleState.moves = 0;
    this.puzzleState.startTime = Date.now();
    this.renderPuzzle();
    this.startPuzzleTimer();
  }

  shufflePuzzle() {
    const tiles = this.puzzleState.tiles;
    let emptyIdx = tiles.indexOf(8);
    const moves = 50 + Math.floor(Math.random() * 50); // 50-100 random moves

    for (let i = 0; i < moves; i++) {
      const neighbors = this.getValidMoves(emptyIdx);
      const randomNeighbor = neighbors[Math.floor(Math.random() * neighbors.length)];
      tiles[emptyIdx] = tiles[randomNeighbor];
      tiles[randomNeighbor] = 8;
      emptyIdx = randomNeighbor;
    }
  }

  getValidMoves(emptyIdx) {
    const row = Math.floor(emptyIdx / 3);
    const col = emptyIdx % 3;
    const neighbors = [];
    if (row > 0) neighbors.push(emptyIdx - 3);
    if (row < 2) neighbors.push(emptyIdx + 3);
    if (col > 0) neighbors.push(emptyIdx - 1);
    if (col < 2) neighbors.push(emptyIdx + 1);
    return neighbors;
  }

  renderPuzzle() {
    const puzzleBoard = $("puzzle-board");
    if (!puzzleBoard) return;
    puzzleBoard.innerHTML = "";

    const imageUrl = this.puzzleFictionalImageUrl;
    const removedTileValue = this.puzzleState.removedTileIndex;

    this.puzzleState.tiles.forEach((tileValue, currentIdx) => {
      const tile = document.createElement("div");
      tile.className = "puzzle-tile";
      tile.dataset.value = tileValue;
      tile.dataset.index = currentIdx;

      if (tileValue === 8) {
        // Empty tile
        tile.classList.add("empty");
      } else {
        // Map piece ID back to original grid position for bg-position
        const originalPos = this.puzzlePieceToOriginal[tileValue];
        const originalRow = Math.floor(originalPos / 3);
        const originalCol = originalPos % 3;

        tile.style.backgroundImage = `url(${imageUrl})`;
        tile.style.backgroundPosition = `${originalCol * 50}% ${originalRow * 50}%`;

        // Check if tile is in correct position
        // Correct: at position currentIdx, the piece whose original position == currentIdx
        const expectedPiece = (currentIdx === removedTileValue) ? 8 : this.puzzlePieceToOriginal.indexOf(currentIdx);
        if (tileValue === expectedPiece) {
          tile.classList.add("correct");
        }

        tile.addEventListener("click", () => this.handleTileClick(currentIdx));
      }

      puzzleBoard.appendChild(tile);
    });

    this.updatePuzzleStats();
  }

  handleTileClick(clickedIdx) {
    if (this.puzzleState.solved) return;

    const tiles = this.puzzleState.tiles;
    const emptyIdx = tiles.indexOf(8);
    const validMoves = this.getValidMoves(emptyIdx);

    if (validMoves.includes(clickedIdx)) {
      tiles[emptyIdx] = tiles[clickedIdx];
      tiles[clickedIdx] = 8;
      this.puzzleState.moves++;

      const clickedTile = $("puzzle-board")?.children[clickedIdx];
      if (clickedTile) {
        clickedTile.classList.add("moving");
        setTimeout(() => clickedTile.classList.remove("moving"), 150);
      }

      this.renderPuzzle();

      if (this.checkPuzzleSolved()) {
        this.handlePuzzleComplete();
      }
    }
  }

  checkPuzzleSolved() {
    const tiles = this.puzzleState.tiles;
    const removedTileValue = this.puzzleState.removedTileIndex;
    for (let pos = 0; pos < 9; pos++) {
      if (pos === removedTileValue) {
        if (tiles[pos] !== 8) return false;
      } else {
        const expectedPiece = this.puzzlePieceToOriginal.indexOf(pos);
        if (tiles[pos] !== expectedPiece) return false;
      }
    }
    return true;
  }

  handlePuzzleComplete() {
    this.puzzleState.solved = true;
    this.stopPuzzleTimer();

    const timeTaken = Math.floor((Date.now() - this.puzzleState.startTime) / 1000);
    const minutes = Math.floor(timeTaken / 60);
    const seconds = timeTaken % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;

    Logger.log(`Puzzle completed! Moves: ${this.puzzleState.moves}, Time: ${timeStr}`);

    // Cascade animation on all tiles
    const allTiles = document.querySelectorAll(".puzzle-tile");
    allTiles.forEach((tile, idx) => {
      setTimeout(() => {
        tile.style.transform = "scale(1.05)";
        setTimeout(() => { tile.style.transform = "scale(1)"; }, 200);
      }, idx * 50);
    });

    // After tile cascade, transition to appreciation mode
    setTimeout(() => {
      this.showPuzzleAppreciation(timeStr);
    }, 600);
  }

  // Scheme F: Appreciation mode — full image + stats + 3D progress
  showPuzzleAppreciation(timeStr) {
    // Hide puzzle section
    const puzzleSection = $("puzzle-game-section");
    if (puzzleSection) puzzleSection.classList.add("hidden");

    // Show appreciation mode
    const appreciation = $("puzzle-appreciation");
    if (!appreciation) return;

    // Set completed image
    const img = $("appreciation-image");
    if (img) img.src = this.puzzleFictionalImageUrl;

    // World-themed completion message
    const msgEl = $("appreciation-message");
    if (msgEl) {
      const messages = {
        Historical: "Ancient Vision Restored!",
        Overlaid: "Hidden Layer Revealed!",
        Alternate: "Alternate View Reconstructed!",
        SciFi_Earth: "Hologram Reassembled!",
        SciFi_Galaxy: "Alien Signal Decoded!",
        Fantasy: "Enchantment Complete!",
      };
      msgEl.textContent = messages[this.selectedWorld] || "Vision Restored!";
    }

    // Stats
    const statsEl = $("appreciation-stats-text");
    if (statsEl) {
      statsEl.textContent = `${timeStr} \u2022 ${this.puzzleState.moves} moves`;
    }

    // Sync 3D progress into appreciation section
    this.syncAppreciationProgress();

    appreciation.classList.remove("hidden");
    appreciation.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // Mirror the overall progress into the puzzle/appreciation 3D progress bars
  syncPuzzle3DProgress(percent) {
    const puzzleFill = $("puzzle-3d-progress-fill");
    const appreciationFill = $("appreciation-3d-progress-fill");
    if (puzzleFill) puzzleFill.style.width = `${percent}%`;
    if (appreciationFill) appreciationFill.style.width = `${percent}%`;
  }

  syncAppreciationProgress() {
    // Calculate 3D completion percentage from current state
    const currentPercent = this.processingProgress || 0;
    // 3D steps are the last 50% (25% photo + 25% fictional)
    // Map overall 50-100% to 0-100% for the 3D-specific bar
    const threeDPercent = Math.max(0, Math.min(100, (currentPercent - 50) * 2));
    this.syncPuzzle3DProgress(threeDPercent);
  }

  startPuzzleTimer() {
    this.updatePuzzleStats();
    this.puzzleState.timerInterval = setInterval(() => {
      this.updatePuzzleStats();
    }, 1000);
  }

  stopPuzzleTimer() {
    if (this.puzzleState.timerInterval) {
      clearInterval(this.puzzleState.timerInterval);
      this.puzzleState.timerInterval = null;
    }
  }

  updatePuzzleStats() {
    const movesEl = $("puzzle-moves");
    const timerEl = $("puzzle-timer");
    if (movesEl) movesEl.textContent = `Moves: ${this.puzzleState.moves}`;
    if (timerEl && this.puzzleState.startTime) {
      const elapsed = Math.floor((Date.now() - this.puzzleState.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      timerEl.textContent = `\u23f1\ufe0f ${minutes}:${seconds.toString().padStart(2, "0")}`;
    }
  }

  resetPuzzleGame() {
    this.stopPuzzleTimer();

    // Clear pending Finish Reading timer
    if (this._finishReadingTimer) {
      clearTimeout(this._finishReadingTimer);
      this._finishReadingTimer = null;
    }

    const puzzleSection = $("puzzle-game-section");
    const appreciation = $("puzzle-appreciation");
    const finishReading = $("finish-reading-section");

    if (puzzleSection) puzzleSection.classList.add("hidden");
    if (appreciation) appreciation.classList.add("hidden");
    if (finishReading) finishReading.classList.add("hidden");

    this.puzzleFictionalImageUrl = null;
    this.puzzleImageReady = false;
    this._puzzleImg = null;
    this.puzzlePieceToOriginal = [];

    this.puzzleState = {
      tiles: [],
      moves: 0,
      startTime: null,
      timerInterval: null,
      solved: false,
      imageLoaded: false,
      removedTileIndex: 4,
    };
  }
}

// ==========================================
// Initialize Controller
// ==========================================
let storyController = null;

document.addEventListener("DOMContentLoaded", () => {
  storyController = new StoryController();

  // Expose to window for debugging
  window.storyController = storyController;

  Logger.log("Story module loaded");
});

// ==========================================
// Export
// ==========================================
export { StoryController, storyController };
