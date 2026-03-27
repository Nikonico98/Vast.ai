// ==========================================
// Imaginary World - Main Application Entry
// ==========================================
// Simplified version: Core utilities and module initialization
// Story logic is handled by story.js module

// ==========================================
// Test Mode Detection
// ==========================================

/**
 * Check if we're in test mode
 * Two ways to enable: /test path OR ?test=1 parameter
 * Example: https://niko.ngrok.app/test OR https://niko.ngrok.app/?test=1
 * @returns {boolean}
 */
export function isTestMode() {
  // Check URL path (e.g., /test or /test/)
  const pathTest = window.location.pathname.startsWith('/test');
  // Check URL parameter (e.g., ?test=1)
  const paramTest = new URLSearchParams(window.location.search).get('test') === '1';
  return pathTest || paramTest;
}

/**
 * Get test mode query string to append to API URLs
 * Always uses ?test=1 for backend API calls
 * @returns {string} - "?test=1" or ""
 */
export function getTestModeQuery() {
  return isTestMode() ? '?test=1' : '';
}

/**
 * Build URL with test mode parameter if needed
 * @param {string} url - Base URL
 * @returns {string} - URL with test parameter if in test mode
 */
export function buildUrlWithTestMode(url) {
  if (!isTestMode()) return url;
  return url + (url.includes('?') ? '&test=1' : '?test=1');
}

// Show test mode badge and hide test-only elements on page load
document.addEventListener('DOMContentLoaded', () => {
  if (isTestMode()) {
    const badge = document.getElementById('test-mode-badge');
    if (badge) {
      badge.classList.remove('hidden');
    }
    // Hide elements marked with test-hidden class
    document.querySelectorAll('.test-hidden').forEach(el => {
      el.style.display = 'none';
    });
    console.log('🧪 TEST MODE ACTIVE - Data stored in data_test/');
  }
});

// ==========================================
// API Helper Functions
// ==========================================

/**
 * Fetch wrapper with error handling
 * @param {string} url - API endpoint URL
 * @param {object} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function apiFetch(url, options = {}) {
  // Auto-add test mode parameter to URL
  const finalUrl = buildUrlWithTestMode(url);
  
  const defaultOptions = {
    headers: {
      Accept: "application/json",
    },
  };

  // Merge options (don't set Content-Type for FormData)
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers,
    },
  };

  // Remove Content-Type for FormData (browser sets it automatically with boundary)
  if (options.body instanceof FormData) {
    delete mergedOptions.headers["Content-Type"];
  }

  // Set up AbortController for timeout
  const timeout = options.timeout !== undefined ? options.timeout : (CONFIG.API_TIMEOUT || 0);
  let controller;
  let timeoutId;

  if (timeout > 0) {
    controller = new AbortController();
    // If caller already provided a signal, chain them
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }
    mergedOptions.signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), timeout);
  }

  try {
    const response = await fetch(finalUrl, mergedOptions);
    return response;
  } catch (error) {
    if (error.name === 'AbortError' && timeout > 0) {
      throw new Error(`Request timeout after ${timeout}ms: ${finalUrl}`);
    }
    Logger.error("Network request failed:", error);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Fetch JSON with automatic parsing
 * @param {string} url - API endpoint URL
 * @param {object} options - Fetch options
 * @returns {Promise<object>}
 */
export async function apiFetchJSON(url, options = {}) {
  const response = await apiFetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error ${response.status}: ${errorText}`);
  }

  return response.json();
}

// ==========================================
// URL Helpers
// ==========================================

/**
 * Get SAM3/SAM3D API base URL
 * @returns {string}
 */
export function getApiBaseUrl() {
  return CONFIG.API_BASE_URL || "";
}

/**
 * Get OpenAI Story API base URL
 * @returns {string}
 */
export function getOpenAIApiBaseUrl() {
  return CONFIG.OPENAI_API_BASE_URL || "";
}

/**
 * Build full URL from relative path
 * @param {string} baseUrl - Base URL
 * @param {string} path - Relative path
 * @returns {string}
 */
export function buildUrl(baseUrl, path) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${baseUrl}${path}`;
}

// ==========================================
// DOM Utility Functions
// ==========================================

/**
 * Get DOM element by ID with type checking
 * @param {string} id - Element ID
 * @returns {HTMLElement|null}
 */
export function $(id) {
  return document.getElementById(id);
}

/**
 * Query selector shorthand
 * @param {string} selector - CSS selector
 * @param {HTMLElement} parent - Parent element (default: document)
 * @returns {HTMLElement|null}
 */
export function $$(selector, parent = document) {
  return parent.querySelector(selector);
}

/**
 * Query selector all shorthand
 * @param {string} selector - CSS selector
 * @param {HTMLElement} parent - Parent element (default: document)
 * @returns {NodeList}
 */
export function $$$(selector, parent = document) {
  return parent.querySelectorAll(selector);
}

/**
 * Show element
 * @param {HTMLElement|string} el - Element or element ID
 */
export function show(el) {
  const element = typeof el === "string" ? $(el) : el;
  if (element) element.style.display = "";
}

/**
 * Hide element
 * @param {HTMLElement|string} el - Element or element ID
 */
export function hide(el) {
  const element = typeof el === "string" ? $(el) : el;
  if (element) element.style.display = "none";
}

/**
 * Toggle element visibility
 * @param {HTMLElement|string} el - Element or element ID
 * @param {boolean} visible - Force visibility state
 */
export function toggle(el, visible) {
  const element = typeof el === "string" ? $(el) : el;
  if (element) {
    element.style.display = visible ? "" : "none";
  }
}

/**
 * Add class to element
 * @param {HTMLElement|string} el - Element or element ID
 * @param {string} className - Class name to add
 */
export function addClass(el, className) {
  const element = typeof el === "string" ? $(el) : el;
  if (element) element.classList.add(className);
}

/**
 * Remove class from element
 * @param {HTMLElement|string} el - Element or element ID
 * @param {string} className - Class name to remove
 */
export function removeClass(el, className) {
  const element = typeof el === "string" ? $(el) : el;
  if (element) element.classList.remove(className);
}

/**
 * Toggle class on element
 * @param {HTMLElement|string} el - Element or element ID
 * @param {string} className - Class name to toggle
 * @param {boolean} force - Force toggle state
 */
export function toggleClass(el, className, force) {
  const element = typeof el === "string" ? $(el) : el;
  if (element) element.classList.toggle(className, force);
}

// ==========================================
// Event Utility Functions
// ==========================================

/**
 * Add event listener with optional delegation
 * @param {HTMLElement|string} el - Element or element ID
 * @param {string} event - Event name
 * @param {Function} handler - Event handler
 * @param {object} options - Event listener options
 */
export function on(el, event, handler, options = {}) {
  const element = typeof el === "string" ? $(el) : el;
  if (element) {
    element.addEventListener(event, handler, options);
  }
}

/**
 * Add one-time event listener
 * @param {HTMLElement|string} el - Element or element ID
 * @param {string} event - Event name
 * @param {Function} handler - Event handler
 */
export function once(el, event, handler) {
  on(el, event, handler, { once: true });
}

// ==========================================
// Async Utility Functions
// ==========================================

/**
 * Delay execution
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create debounced function
 * @param {Function} fn - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function}
 */
export function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Create throttled function
 * @param {Function} fn - Function to throttle
 * @param {number} limit - Limit time in milliseconds
 * @returns {Function}
 */
export function throttle(fn, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// ==========================================
// File Utility Functions
// ==========================================

/** * Compress an image file using Canvas API.
 * Resizes to maxDimension (keeping aspect ratio) and re-encodes as JPEG.
 * @param {File} file - Original image file
 * @param {number} maxDimension - Max width or height in pixels (default 1024)
 * @param {number} quality - JPEG quality 0-1 (default 0.8)
 * @returns {Promise<File>} - Compressed image file
 */
export function compressImage(file, maxDimension = 1024, quality = 0.8) {
  return new Promise((resolve, reject) => {
    // Skip non-image files
    if (!file.type.startsWith('image/')) {
      return resolve(file);
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Skip if already small enough
      if (width <= maxDimension && height <= maxDimension && file.size <= 300 * 1024) {
        return resolve(file);
      }

      // Scale down keeping aspect ratio
      if (width > height) {
        if (width > maxDimension) {
          height = Math.round(height * (maxDimension / width));
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round(width * (maxDimension / height));
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Canvas compression failed'));
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          Logger.log(
            `Image compressed: ${(file.size / 1024).toFixed(0)}KB → ${(compressed.size / 1024).toFixed(0)}KB, ${width}×${height}`
          );
          resolve(compressed);
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file); // Fallback: return original on error
    };

    img.src = url;
  });
}

/** * Read file as Data URL
 * @param {File} file - File to read
 * @returns {Promise<string>}
 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Read file as ArrayBuffer
 * @param {File} file - File to read
 * @returns {Promise<ArrayBuffer>}
 */
export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Download blob as file
 * @param {Blob|string} blobOrUrl - Blob or URL to download
 * @param {string} filename - Download filename
 */
export function downloadFile(blobOrUrl, filename) {
  const link = document.createElement("a");

  if (typeof blobOrUrl === "string") {
    link.href = blobOrUrl;
  } else {
    link.href = URL.createObjectURL(blobOrUrl);
  }

  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  if (typeof blobOrUrl !== "string") {
    URL.revokeObjectURL(link.href);
  }
}

// ==========================================
// Storage Utility Functions
// ==========================================

/**
 * Save data to localStorage
 * @param {string} key - Storage key
 * @param {*} value - Value to store (will be JSON stringified)
 */
export function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    Logger.warn("Failed to save to localStorage:", error);
  }
}

/**
 * Load data from localStorage
 * @param {string} key - Storage key
 * @param {*} defaultValue - Default value if key not found
 * @returns {*}
 */
export function loadFromStorage(key, defaultValue = null) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    Logger.warn("Failed to load from localStorage:", error);
    return defaultValue;
  }
}

/**
 * Remove data from localStorage
 * @param {string} key - Storage key
 */
export function removeFromStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    Logger.warn("Failed to remove from localStorage:", error);
  }
}

// ==========================================
// Polling Manager
// ==========================================

/**
 * Create a polling manager for async operations
 */
export class PollingManager {
  constructor(options = {}) {
    this.interval = options.interval || CONFIG.POLLING_INTERVAL || 2000;
    this.maxAttempts =
      options.maxAttempts || CONFIG.MAX_POLLING_ATTEMPTS || 300;
    this.maxConsecutiveErrors =
      options.maxConsecutiveErrors || 10;
    this.timer = null;
    this.attempts = 0;
    this.consecutiveErrors = 0;
    this.isPolling = false;
  }

  /**
   * Start polling
   * @param {Function} checkFn - Async function to call each interval
   *                             Should return { done: boolean, data?: any }
   * @returns {Promise<any>} - Resolves when checkFn returns done: true
   */
  start(checkFn) {
    return new Promise((resolve, reject) => {
      this.stop();
      this.attempts = 0;
      this.consecutiveErrors = 0;
      this.isPolling = true;

      const poll = async () => {
        if (!this.isPolling) {
          reject(new Error("Polling cancelled"));
          return;
        }

        this.attempts++;

        if (this.attempts > this.maxAttempts) {
          this.stop();
          reject(new Error("Polling timeout: max attempts reached"));
          return;
        }

        try {
          const result = await checkFn();

          // Reset error counter on success
          this.consecutiveErrors = 0;

          if (result.done) {
            this.stop();
            resolve(result.data);
          } else {
            this.timer = setTimeout(poll, this.interval);
          }
        } catch (error) {
          this.consecutiveErrors++;
          Logger.warn(
            `Polling error ${this.consecutiveErrors}/${this.maxConsecutiveErrors}:`,
            error.message
          );

          if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
            // Too many consecutive failures — give up
            this.stop();
            reject(error);
          } else {
            // Use exponential backoff: base interval * 2^(errors-1), capped at 30s
            const backoff = Math.min(
              this.interval * Math.pow(2, this.consecutiveErrors - 1),
              30000
            );
            Logger.log(`Polling retry in ${backoff}ms...`);
            this.timer = setTimeout(poll, backoff);
          }
        }
      };

      // Start immediately
      poll();
    });
  }

  /**
   * Stop polling
   */
  stop() {
    this.isPolling = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// ==========================================
// Application State Manager
// ==========================================

/**
 * Simple state management for the application
 */
export class StateManager {
  constructor(initialState = {}) {
    this.state = { ...initialState };
    this.listeners = new Map();
  }

  /**
   * Get current state
   * @param {string} key - State key (optional, returns full state if not provided)
   * @returns {*}
   */
  get(key) {
    if (key) {
      return this.state[key];
    }
    return { ...this.state };
  }

  /**
   * Set state
   * @param {string|object} keyOrState - State key or partial state object
   * @param {*} value - Value (if key is string)
   */
  set(keyOrState, value) {
    if (typeof keyOrState === "string") {
      const oldValue = this.state[keyOrState];
      this.state[keyOrState] = value;
      this.notify(keyOrState, value, oldValue);
    } else {
      const oldState = { ...this.state };
      this.state = { ...this.state, ...keyOrState };

      // Notify for each changed key
      for (const key of Object.keys(keyOrState)) {
        if (oldState[key] !== keyOrState[key]) {
          this.notify(key, keyOrState[key], oldState[key]);
        }
      }
    }
  }

  /**
   * Subscribe to state changes
   * @param {string} key - State key to watch
   * @param {Function} callback - Callback function(newValue, oldValue)
   * @returns {Function} - Unsubscribe function
   */
  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(key);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  /**
   * Notify listeners of state change
   * @param {string} key - State key that changed
   * @param {*} newValue - New value
   * @param {*} oldValue - Old value
   */
  notify(key, newValue, oldValue) {
    const listeners = this.listeners.get(key);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(newValue, oldValue);
        } catch (error) {
          Logger.error("State listener error:", error);
        }
      }
    }
  }

  /**
   * Reset state to initial values
   * @param {object} initialState - Initial state
   */
  reset(initialState = {}) {
    this.state = { ...initialState };
  }
}

// ==========================================
// Global Application State
// ==========================================
export const appState = new StateManager({
  currentPage: "page-world-selection",
  selectedWorld: null,
  journeyId: null,
  currentPhotoIndex: 0,
  events: [],
  collectedItems: [],
  isProcessing: false,
});

// ==========================================
// Initialize Application
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  Logger.log("Imaginary World App initialized");
  Logger.log("Config:", CONFIG);

  // The story.js module will handle page navigation and story logic
  // This file provides utility functions for other modules
});

// ==========================================
// Export for global access (non-module scripts)
// ==========================================
window.IW = {
  apiFetch,
  apiFetchJSON,
  getApiBaseUrl,
  getOpenAIApiBaseUrl,
  buildUrl,
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
  debounce,
  throttle,
  compressImage,
  readFileAsDataURL,
  downloadFile,
  saveToStorage,
  loadFromStorage,
  removeFromStorage,
  PollingManager,
  StateManager,
  appState,
};
