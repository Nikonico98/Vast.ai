/**
 * AR Launcher Module
 * ==================
 * Handles launching self-hosted AR experiences with dynamic model loading.
 * AR projects served locally from /ar/tap/, /ar/rotate/, /ar/track/, /ar/viewer/
 *
 * Usage:
 *   launchAR('photo')      - Launch AR Viewer with Photo Item 3D model
 *   launchAR('fictional')  - Launch AR Viewer with Fictional Item 3D model
 *   launchARInteraction()  - Launch AR Interaction with both models
 */

// ==========================================
// Configuration
// ==========================================

// Self-hosted AR - always use local AR routes
// (Migrated from 8th Wall cloud to local webpack builds)
const AR_VIEWER_URL = "/ar/viewer/"; // Single-model viewer

// ==========================================
// AR Launch Function (Single Model Viewer)
// ==========================================

/**
 * Launch AR Viewer with a single model (photo or fictional)
 * Uses /ar/viewer/ route with ?model=URL&name=Name params
 * @param {string} modelType - 'photo' or 'fictional'
 */
function launchAR(modelType) {
  console.log(`🔮 Launching AR Viewer for: ${modelType}`);

  const currentEvent = window.currentEventData || {};
  const event = currentEvent.event || {};

  // Get the appropriate model URL
  let modelUrl, modelName;

  if (modelType === 'photo') {
    modelUrl = currentEvent.photoModelUrl;
    modelName = event.item_or_character || currentEvent.photoItemName || 'Photo Item';
    if (!modelUrl) {
      alert('Photo Item 3D model not ready yet. Please wait for generation.');
      return;
    }
  } else {
    modelUrl = currentEvent.fictionalModelUrl;
    modelName = event.fictionalItemName || event.item_or_character || currentEvent.fictionalItemName || 'Fictional Item';
    if (!modelUrl) {
      alert('Fictional Item 3D model not ready yet. Please wait for generation.');
      return;
    }
  }

  // Build full URL
  const baseUrl = window.location.origin;
  const fullModelUrl = modelUrl.startsWith('http') ? modelUrl : baseUrl + modelUrl;

  // Build URL with parameters
  const params = new URLSearchParams({
    model: fullModelUrl,
    name: modelName,
  });

  const arUrl = `${AR_VIEWER_URL}?${params.toString()}`;

  console.log('📱 Opening AR Viewer:', arUrl);
  console.log('   Model:', fullModelUrl);
  console.log('   Name:', modelName);

  // Open in new tab
  window.open(arUrl, '_blank');
}

// ==========================================
// AR Interaction Configuration
// ==========================================

// Self-hosted AR: always use local Flask routes
// (Migrated from 8th Wall cloud - all AR now served locally)
const AR_INTERACTION_URLS = {
  Rub: "/ar/rub/",
  Tap: "/ar/tap/",
  Rotate: "/ar/rotate/",
  Track: "/ar/track/",
  Blow: "/ar/blow/materialism/",
  Wall: "/ar/wall/"
};

// ==========================================
// AR Interaction Launch Function
// ==========================================

/**
 * Launch AR Interaction with both Real and Fictional models
 * Selects self-hosted AR project based on ar_interaction type (Tap/Rotate/Track)
 */
function launchARInteraction() {
  console.log("🎮 Launching AR Interaction...");

  // Get current event data
  const currentEvent = window.currentEventData || {};
  const event = currentEvent.event || {};

  // Get interaction type - MUST use ar_interaction_type (not ar_interaction which is the description)
  const interactionType =
    event.ar_interaction_type ||
    currentEvent.ar_interaction_type ||
    event.arInteractionType ||
    currentEvent.arInteractionType ||
    "Rub";
  console.log(`🎯 Interaction type: ${interactionType}`);
  console.log(`📋 Event data:`, event);

  // Validate models are ready
  const photoModelUrl = currentEvent.photoModelUrl;
  const fictionalModelUrl = currentEvent.fictionalModelUrl;

  if (!photoModelUrl) {
    alert("Photo Item 3D model not ready yet. Please wait for generation.");
    return;
  }

  if (!fictionalModelUrl) {
    alert("Fictional Item 3D model not ready yet. Please wait for generation.");
    return;
  }

  // Build full URLs
  const baseUrl = window.location.origin;
  const fullPhotoUrl = photoModelUrl.startsWith("http")
    ? photoModelUrl
    : baseUrl + photoModelUrl;
  const fullFictionalUrl = fictionalModelUrl.startsWith("http")
    ? fictionalModelUrl
    : baseUrl + fictionalModelUrl;

  // Get item name
  const itemName =
    event.fictionalItemName ||
    event.item_or_character ||
    currentEvent.fictionalItemName ||
    "Fictional Item";

  // Select project URL based on interaction type
  const projectUrl =
    AR_INTERACTION_URLS[interactionType] || AR_INTERACTION_URLS.Rub;

  // Build current page return URL with hash for deep-linking
  const returnUrl =
    window.location.origin +
    window.location.pathname +
    "#" +
    (window.storyController?.currentPage || "page-event-result");

  // Build URL with parameters
  const params = new URLSearchParams({
    real_glb: fullPhotoUrl,
    fictional_glb: fullFictionalUrl,
    interaction: interactionType,
    item_name: itemName,
    return_url: returnUrl,
  });

  const arUrl = `${projectUrl}?${params.toString()}`;

  console.log("📱 Opening AR Interaction:", arUrl);
  console.log("   Real GLB:", fullPhotoUrl);
  console.log("   Fictional GLB:", fullFictionalUrl);
  console.log("   Interaction:", interactionType);

  // Enable the "Next Photo" button after AR Interaction is clicked
  const continueBtn = document.getElementById("continue-adventure-btn");
  if (continueBtn) {
    continueBtn.disabled = false;
    console.log("✅ Next Photo button enabled");
  }

  // Open in new tab
  window.open(arUrl, "_blank");
}

// ==========================================
// Export for global access
// ==========================================
window.launchAR = launchAR;
window.launchARInteraction = launchARInteraction;

console.log("✅ AR Launcher loaded");
