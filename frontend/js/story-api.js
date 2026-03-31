// ==========================================
// Imaginary World - Story API Module
// ==========================================
// Handles all API calls to the OpenAI Story Backend
// Location: frontend/js/story-api.js

import {
  apiFetch,
  apiFetchJSON,
  getOpenAIApiBaseUrl,
  getApiBaseUrl,
  buildUrl,
  PollingManager,
} from "../app.js";

// ==========================================
// API Endpoints
// ==========================================
const ENDPOINTS = {
  // OpenAI Story Backend
  START: "/api/start",
  FEEDBACK: "/api/feedback",
  PHOTO_EVENT: "/api/photo_event",

  // SAM3/SAM3D Backend
  PROCESS: "/api/process",
  STATUS: "/api/status",
};

// ==========================================
// World Types (Standard 6 Types)
// ==========================================
// Direct mapping - no conversion needed
export const WORLD_MAPPING = {
  Historical: "Historical",
  Overlaid: "Overlaid",
  Alternate: "Alternate",
  SciFi_Earth: "SciFi_Earth",
  SciFi_Galaxy: "SciFi_Galaxy",
  Fantasy: "Fantasy",
};

// World display names (per Wolf's Building Imaginary Worlds)
export const WORLD_NAMES = {
  Historical: "Historical",
  Overlaid: "Overlaid",
  Alternate: "Alternate",
  SciFi_Earth: "Sci-Fi Earth",
  SciFi_Galaxy: "Sci-Fi Galaxy",
  Fantasy: "Fantasy",
};

// World icons
export const WORLD_ICONS = {
  Historical: "🏛️",
  Overlaid: "🔮",
  Alternate: "🔄",
  SciFi_Earth: "🌍",
  SciFi_Galaxy: "🚀",
  Fantasy: "✨",
};

// ==========================================
// Text Cleaning Utilities
// ==========================================

/**
 * Clean Markdown formatting from text
 * Removes **bold**, *italic*, and other common Markdown syntax
 * @param {string} text - Text with potential Markdown formatting
 * @returns {string} - Clean plain text
 */
function cleanMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // Remove **bold**
    .replace(/\*([^*]+)\*/g, "$1") // Remove *italic*
    .replace(/__([^_]+)__/g, "$1") // Remove __bold__
    .replace(/_([^_]+)_/g, "$1") // Remove _italic_
    .replace(/`([^`]+)`/g, "$1") // Remove `code`
    .replace(/\|\s*$/g, "") // Remove trailing |
    .trim();
}

// ==========================================
// Story API Functions
// ==========================================

/**
 * Start a new story journey
 * @param {string} worldKey - World type key (e.g., 'enchanted_forest')
 * @returns {Promise<object>} - Journey object with story background
 */
export async function startJourney(worldKey) {
  const baseUrl = getOpenAIApiBaseUrl();
  const imaginaryWorld = WORLD_MAPPING[worldKey] || "Fantasy";

  Logger.log("Starting journey:", { worldKey, imaginaryWorld });

  const response = await apiFetch(`${baseUrl}${ENDPOINTS.START}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      imaginary_world: imaginaryWorld,
      custom_imaginary_world: WORLD_NAMES[worldKey] || "",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to start journey: ${errorText}`);
  }

  const journey = await response.json();
  Logger.log("Journey started (raw response):", journey);
  Logger.log("  journey_id:", journey.journey_id);
  Logger.log("  story_background:", journey.story_background);
  Logger.log("  goal:", journey.goal);
  Logger.log("  nodes:", journey.nodes);

  // Get story from latest node (last element = most recent / accepted story)
  const latestNode = journey.nodes?.[journey.nodes.length - 1] || {};
  Logger.log("Latest node:", latestNode);

  const storyHtml = latestNode.story_html || latestNode.story_background || "";
  const storyPlain = latestNode.story_background || stripHtml(storyHtml);
  const goal = latestNode.goal || journey.goal || "";

  Logger.log("Mapped fields:");
  Logger.log("  storyHtml:", storyHtml);
  Logger.log("  storyPlain:", storyPlain);
  Logger.log("  goal:", goal);

  return {
    journeyId: journey.journey_id,
    userFolderId: journey.user_id,
    imaginaryWorld: journey.imaginary_world,
    title: journey.titles?.[journey.titles.length - 1] || journey.world_label || "Untitled",
    storyHtml: storyHtml,
    storyPlain: storyPlain,
    goal: goal,
    storyDetails: journey.story_details || {},
    events: journey.events || [],
  };
}

/**
 * Send feedback on the current story (accept or regenerate)
 * @param {string} journeyId - Journey ID
 * @param {string} decision - 'accept' or 'reject'
 * @returns {Promise<object>} - Updated journey object
 */
export async function feedbackStory(journeyId, decision) {
  const baseUrl = getOpenAIApiBaseUrl();

  Logger.log("Sending feedback:", { journeyId, decision });

  const response = await apiFetch(`${baseUrl}${ENDPOINTS.FEEDBACK}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      journey_id: journeyId,
      decision: decision,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send feedback: ${errorText}`);
  }

  const journey = await response.json();
  Logger.log("Feedback response:", journey);

  // If rejected, return the new story
  if (decision === "reject") {
    const latestNode = journey.nodes?.[journey.nodes.length - 1] || {};
    const storyHtml =
      latestNode.story_html || latestNode.story_background || "";
    const storyPlain = latestNode.story_background || stripHtml(storyHtml);
    return {
      journeyId: journey.journey_id,
      title: journey.titles?.[journey.titles.length - 1] || "Untitled",
      storyHtml: storyHtml,
      storyPlain: storyPlain,
      goal: latestNode.goal || journey.goal || "",
      storyDetails: journey.story_details || {},
      status: "pending",
    };
  }

  // If accepted, return finished status
  return {
    journeyId: journey.journey_id,
    status: "finished",
    events: journey.events || [],
  };
}

/**
 * Process a photo event (upload photo and generate story event)
 * @param {string} journeyId - Journey ID
 * @param {File} photoFile - Photo file to upload
 * @param {Function} onProgress - Progress callback (optional)
 * @returns {Promise<object>} - Event object with story text and model URLs
 */
export async function processPhotoEvent(journeyId, photoFile, onProgress) {
  const baseUrl = getOpenAIApiBaseUrl();

  Logger.log("Processing photo event:", {
    journeyId,
    fileName: photoFile.name,
  });

  // Create form data
  const formData = new FormData();
  formData.append("journey_id", journeyId);
  formData.append("photo", photoFile);

  // Update progress
  if (onProgress) onProgress("analyze", "Analyzing photo...");

  const response = await apiFetch(`${baseUrl}${ENDPOINTS.PHOTO_EVENT}`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to process photo: ${errorText}`);
  }

  const event = await response.json();
  Logger.log("Photo event result:", event);

  // Clean text fields from Markdown formatting
  const storyText = cleanMarkdown(
    event.event_text || "",
  );
  const fictionalItemName = cleanMarkdown(
    event.fictional_item_name ||
      event.fictional_item_or_character ||
      event.item_or_character ||
      "Fictional Avatar",
  );
  const fictionalLocation = cleanMarkdown(
    event.fictional_location || event.location || "",
  );

  return {
    eventId: event.event_id || event.id,
    eventIndex: event.event_index,
    storyText: storyText,

    // Photo Analysis
    photoPlace: event.photo_place || "",
    photoPlaceCategory: event.photo_place_category || "",
    photoItemName: event.photo_item_name || event.photo_item || "Real Item",
    photoItemCategory: event.photo_item_category || "",

    // Event Generation (with Fictional prefix)
    event_text: storyText,
    fictional_location: fictionalLocation,
    fictional_item_or_character: fictionalItemName,
    location: fictionalLocation,
    fictionalItemName: fictionalItemName,
    action: event.event_action || event.action || "",
    actionCategory: event.event_action_category || event.action_category || "",

    // AR Interaction
    ar_interaction: event.ar_interaction || "Tap",
    ar_interaction_type: event.ar_interaction_type || "Tap",
    ar_interaction_description: event.ar_interaction_description || "",
    item_3d: event["3d_item"] || "",

    // Image URLs - add baseUrl for relative paths
    photoImageUrl: buildUrl(baseUrl, event.photo_image_url) || "",
    fictionalImageUrl: buildUrl(baseUrl, event.fictional_image_url) || "",

    // 3D Job IDs (backend processes in background)
    photo_3d_job_id: event.photo_3d_job_id || null,
    fictional_3d_job_id: event.fictional_3d_job_id || null,

    // 3D model URLs will be added after SAM3D processing
    photoModelUrl: null,
    fictionalModelUrl: null,
  };
}

// ==========================================
// SAM3D API Functions
// ==========================================

/**
 * Submit image for 3D model generation via SAM3D
 * @param {File|Blob|string} imageSource - Image file, blob, or base64 string
 * @param {string} prompt - Text prompt for segmentation (from GPT analysis)
 * @returns {Promise<string>} - Job ID for status polling
 */
export async function submitFor3D(imageSource, prompt) {
  const baseUrl = getApiBaseUrl();

  Logger.log("Submitting for 3D processing:", { prompt });

  const formData = new FormData();

  // Handle different image source types
  if (imageSource instanceof File) {
    formData.append("image", imageSource);
  } else if (imageSource instanceof Blob) {
    // Blob needs a filename for server-side validation
    formData.append("image", imageSource, "image.png");
  } else if (typeof imageSource === "string") {
    // If it's a base64 string, convert to blob
    const blob = await base64ToBlob(imageSource);
    formData.append("image", blob, "image.png");
  }

  formData.append("prompt", prompt);

  const response = await apiFetch(`${baseUrl}${ENDPOINTS.PROCESS}`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to submit for 3D: ${errorText}`);
  }

  const data = await response.json();

  if (!data.job_id) {
    throw new Error("No job ID returned from server");
  }

  Logger.log("3D job submitted:", data.job_id);
  return data.job_id;
}

/**
 * Check job status for 3D model generation
 * @param {string} jobId - Job ID
 * @returns {Promise<object>} - Status object { status, step, progress, glb_url, error }
 */
export async function checkJobStatus(jobId) {
  const baseUrl = getApiBaseUrl();

  const response = await apiFetch(`${baseUrl}${ENDPOINTS.STATUS}/${jobId}`);

  if (!response.ok) {
    throw new Error(`Failed to check job status: ${response.status}`);
  }

  const data = await response.json();

  return {
    status: data.status,
    step: data.step || "",
    progress: data.progress || 0,
    glbUrl: data.glb_url ? buildUrl(baseUrl, data.glb_url) : null,
    error: data.error || null,
  };
}

/**
 * Wait for 3D model generation to complete
 * @param {string} jobId - Job ID
 * @param {Function} onProgress - Progress callback (step, progress)
 * @returns {Promise<string>} - GLB model URL
 */
export async function waitFor3DModel(jobId, onProgress) {
  const poller = new PollingManager({
    interval: CONFIG.POLLING_INTERVAL || 2000,
    maxAttempts: CONFIG.MAX_POLLING_ATTEMPTS || 300,
  });

  // Track consecutive failures for tolerance
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5; // Allow up to 5 consecutive failures before giving up

  return poller.start(async () => {
    try {
      const status = await checkJobStatus(jobId);

      // Reset failure counter on success
      consecutiveFailures = 0;

      if (onProgress) {
        onProgress(status.step, status.progress);
      }

      if (status.status === "completed") {
        if (!status.glbUrl) {
          throw new Error("Completed but no GLB URL returned");
        }
        return { done: true, data: status.glbUrl };
      }

      if (status.status === "failed") {
        throw new Error(status.error || "3D generation failed");
      }

      // Still processing
      return { done: false };
    } catch (error) {
      consecutiveFailures++;
      
      // Log the error but don't fail immediately
      Logger.warn(`Job status check failed (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, error.message);
      
      // If we've exceeded max consecutive failures, throw the error
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(`Job status check failed after ${MAX_CONSECUTIVE_FAILURES} attempts: ${error.message}`);
      }
      
      // Otherwise, continue polling (return not done)
      return { done: false };
    }
  });
}

// ==========================================
// Combined Processing Flow
// ==========================================

/**
 * World-specific step messages for contextual loading UX
 */
const WORLD_STEP_MESSAGES = {
  Historical: {
    analyze: "You hold the photograph up to the candlelight, studying every detail...",
    analyzeComplete: "The image stirs a memory — something from long ago.",
    event: "You hear footsteps echoing through the corridor of time...",
    eventComplete: "A forgotten chapter of history unfolds before your eyes.",
    image: "The world around you shimmers, and the past begins to take shape...",
    imageComplete: "You find yourself standing in a scene from another century.",
    photo3d: "You reach for the object — it feels weathered, real beneath your fingers...",
    photo3dComplete: "An artifact from the archives now rests in your hands.",
    fictional3d: "Something catches your eye in the dust — a relic left behind by history...",
    fictional3dComplete: "You brush away the centuries, revealing a forgotten treasure.",
    complete: "The past has spoken. Your journey through time awaits.",
  },
  Overlaid: {
    analyze: "You squint at the photograph — something about it feels... different...",
    analyzeComplete: "There it is. A hidden layer, shimmering just beneath the surface.",
    event: "The air around you thickens, and reality begins to warp...",
    eventComplete: "Fiction and truth have woven themselves together.",
    image: "The veil between worlds grows thin, and something appears...",
    imageComplete: "You see it now — a world layered over your own.",
    photo3d: "You reach through the shimmer and grasp something solid...",
    photo3dComplete: "An anchor from the real world, tethering you to both sides.",
    fictional3d: "From the overlay, an object drifts toward you...",
    fictional3dComplete: "It has crossed over. The overlaid entity is yours.",
    complete: "Two worlds, intertwined. Look closer — nothing is what it seems.",
  },
  Alternate: {
    analyze: "You examine the photograph, and a strange thought surfaces: what if...?",
    analyzeComplete: "A divergence point. History could have gone another way.",
    event: "The timeline wavers, and a new chain of events begins to form...",
    eventComplete: "An alternate history crystallizes — one that almost happened.",
    image: "The world shifts, and you glimpse a reality that could have been...",
    imageComplete: "Before you stands a world rewritten by a single different choice.",
    photo3d: "You pick up an object that shouldn't exist — not in this timeline...",
    photo3dComplete: "This artifact belongs to a reality parallel to your own.",
    fictional3d: "From the branching timeline, something materializes before you...",
    fictional3dComplete: "A relic from the world that almost was.",
    complete: "The timeline has split. Your alternate history is ready to explore.",
  },
  SciFi_Earth: {
    analyze: "Your neural interface flickers to life, scanning the photograph...",
    analyzeComplete: "Bio-scan complete. The data reveals something unexpected.",
    event: "A holographic display unfolds before your eyes, projecting a future scenario...",
    eventComplete: "The projection stabilizes — a vision of Earth yet to come.",
    image: "Light bends around you as nanobots render a scene from the future...",
    imageComplete: "The holographic vision sharpens into focus before you.",
    photo3d: "You watch as a nanobot swarm assembles matter, atom by atom...",
    photo3dComplete: "The fabrication is complete. You can almost feel it humming.",
    fictional3d: "Quantum particles coalesce, forming something from tomorrow's blueprint...",
    fictional3dComplete: "A future artifact takes solid form before you.",
    complete: "Welcome to the future. The world ahead has something to show you.",
  },
  SciFi_Galaxy: {
    analyze: "You transmit the photograph into the void — and something out there receives it...",
    analyzeComplete: "A signal returns from across the galaxy. Something has noticed you.",
    event: "Static fills your comm channel, then resolves into an alien transmission...",
    eventComplete: "The interstellar message has been decoded. A story from the stars.",
    image: "Deep-space imagery floods your viewport, revealing an alien vista...",
    imageComplete: "A star system unknown to any human chart now fills your vision.",
    photo3d: "The transporter beam hums, rearranging matter into a familiar shape...",
    photo3dComplete: "Matter replication complete. The object is tangible, yet alien.",
    fictional3d: "Atom by atom, an artifact from beyond the stars assembles itself...",
    fictional3dComplete: "An alien artifact, assembled from elements unknown to Earth.",
    complete: "The transmission is complete. The galaxy has shared its secrets with you.",
  },
  Fantasy: {
    analyze: "You unroll the ancient parchment, and the runes on the photograph begin to glow...",
    analyzeComplete: "The runes have spoken — they reveal a tale woven in enchantment.",
    event: "The oracle's voice echoes through the chamber, whispering a prophecy...",
    eventComplete: "A prophecy has been written in starlight. Your quest takes shape.",
    image: "Mist swirls around you, and an enchanted vision begins to crystallize...",
    imageComplete: "Through the mist, a scene from the enchanted realm reveals itself.",
    photo3d: "Elven artisans work by moonlight, their hammers ringing softly...",
    photo3dComplete: "The enchanted artifact gleams, warm to the touch.",
    fictional3d: "From deep within the enchanted forest, a mythical object drifts toward you...",
    fictional3dComplete: "You close your fingers around it — the mythical object is yours.",
    complete: "Your quest awaits, adventurer. The enchanted realm calls to you.",
  },
};

function getStepMsg(world, key) {
  const msgs = WORLD_STEP_MESSAGES[world] || WORLD_STEP_MESSAGES.Fantasy;
  return msgs[key];
}

/**
 * Full photo event processing: Photo → Story Event → Dual 3D Models
 * @param {string} journeyId - Journey ID
 * @param {File} photoFile - User's photo
 * @param {Function} onProgress - Progress callback (step, message)
 * @param {string} [world] - Selected imaginary world type
 * @returns {Promise<object>} - Complete event with both 3D models
 */
export async function processFullPhotoEvent(journeyId, photoFile, onProgress, world) {
  const result = {
    event: null,
    photoModelUrl: null,
    fictionalModelUrl: null,
  };

  try {
    // Step 1: Photo Analysis (Photo + Category)
    onProgress?.("analyze", getStepMsg(world, "analyze"), {
      status: "active",
    });
    const event = await processPhotoEvent(journeyId, photoFile);
    result.event = event;

    // === All steps fire immediately (no artificial delays) ===
    // Step 1 completed: show analysis results (typewriter runs in background)
    onProgress?.("analyze", getStepMsg(world, "analyzeComplete"), {
      status: "completed",
      photoPlace: event.photoPlace,
      photoItem: event.photoItemName,
    });

    // Step 2 completed: show fictional event (typewriter runs in background)
    onProgress?.("event", getStepMsg(world, "eventComplete"), {
      status: "completed",
      fictionalItem: event.fictionalItemName,
      fictionalLocation: event.fictional_location || event.location,
      storyText: event.event_text || event.storyText,
    });

    // Step 3: Fictional image (already generated by backend) — show immediately
    onProgress?.("fictional-image", getStepMsg(world, "imageComplete"), {
      status: "completed",
      progress: 100,
      fictionalImageUrl: event.fictionalImageUrl,
      fictionalItemName: event.fictionalItemName,
    });

    // Check if 3D generation should be skipped
    if (CONFIG.SKIP_3D_GENERATION) {
      Logger.log("Skipping 3D generation (CONFIG.SKIP_3D_GENERATION = true)");

      onProgress?.("3d-photo", "Skipped (test mode)", {
        status: "completed",
        progress: 100,
      });
      onProgress?.("3d-fictional", "Skipped (test mode)", {
        status: "completed",
        progress: 100,
      });

      onProgress?.("complete", getStepMsg(world, "complete"), { status: "completed" });
      return result;
    }

    // Backend starts 3D generation in background and returns job IDs
    // We just need to poll for completion using those IDs
    const photoJobId = event.photo_3d_job_id;
    const fictionalJobId = event.fictional_3d_job_id;

    // Step 4A: Wait for photo 3D model (backend already processing)
    if (photoJobId) {
      onProgress?.("3d-photo", getStepMsg(world, "photo3d"), {
        status: "active",
        progress: 0,
      });
    }

    // Step 4B: Fictional 3D status (if backend is processing it)
    if (fictionalJobId) {
      onProgress?.("3d-fictional", getStepMsg(world, "fictional3d"), {
        status: "active",
        progress: 0,
      });
    }

    // Step 4A & 4B: Wait for BOTH 3D models IN PARALLEL
    const photoPromise = photoJobId
      ? waitFor3DModel(photoJobId, (step, progress) => {
          onProgress?.("3d-photo", getStepMsg(world, "photo3d"), {
            status: "active",
            progress: progress,
          });
        }).then((url) => {
          onProgress?.("3d-photo", getStepMsg(world, "photo3dComplete"), {
            status: "completed",
            progress: 100,
          });
          return url;
        })
      : Promise.resolve(null).then(() => {
          onProgress?.("3d-photo", "Skipped (no photo item)", {
            status: "completed",
            progress: 100,
          });
          return null;
        });

    const fictionalPromise = fictionalJobId
      ? waitFor3DModel(fictionalJobId, (step, progress) => {
          onProgress?.("3d-fictional", getStepMsg(world, "fictional3d"), {
            status: "active",
            progress: progress,
          });
        }).then((url) => {
          onProgress?.("3d-fictional", getStepMsg(world, "fictional3dComplete"), {
            status: "completed",
            progress: 100,
          });
          return url;
        })
      : Promise.resolve(null);

    // Wait for BOTH to complete in parallel
    const [photoModelUrl, fictionalModelUrl] = await Promise.all([
      photoPromise,
      fictionalPromise,
    ]);

    result.photoModelUrl = photoModelUrl;
    result.fictionalModelUrl = fictionalModelUrl;

    onProgress?.("complete", getStepMsg(world, "complete"), { status: "completed" });

    return result;
  } catch (error) {
    Logger.error("Full photo event processing failed:", error);
    throw error;
  }
}

// ==========================================
// Utility Functions
// ==========================================

/**
 * Strip HTML tags from text
 * @param {string} html - HTML string
 * @returns {string} - Plain text
 */
function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "");
}

/**
 * Convert base64 string to Blob
 * @param {string} base64 - Base64 encoded string (with or without data URL prefix)
 * @returns {Promise<Blob>}
 */
async function base64ToBlob(base64) {
  // Handle data URL format
  let base64Data = base64;
  let mimeType = "image/png";

  if (base64.startsWith("data:")) {
    const matches = base64.match(/^data:([^;]+);base64,(.+)$/);
    if (matches) {
      mimeType = matches[1];
      base64Data = matches[2];
    }
  }

  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);

  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }

  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Fetch image and convert to base64
 * @param {string} url - Image URL
 * @returns {Promise<string>} - Base64 data URL
 */
export async function imageUrlToBase64(url) {
  const response = await fetch(url);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ==========================================
// Export for global access
// ==========================================
window.StoryAPI = {
  startJourney,
  feedbackStory,
  processPhotoEvent,
  submitFor3D,
  checkJobStatus,
  waitFor3DModel,
  processFullPhotoEvent,
  WORLD_MAPPING,
  WORLD_NAMES,
};

export default {
  startJourney,
  feedbackStory,
  processPhotoEvent,
  submitFor3D,
  checkJobStatus,
  waitFor3DModel,
  processFullPhotoEvent,
  WORLD_MAPPING,
  WORLD_NAMES,
};
