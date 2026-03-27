"""
Imaginary World - AI Service
==============================
Handles:
- OpenAI client initialization
- Luma AI availability checking
- Template loading (RAG system prompt from prompt.md)
- Conversation context management (chat_with_context)
- Story generation (generate_opening_story)
- Photo analysis (analyze_photo)
- Event generation (generate_event)
- Image generation (generate_fictional_image via Luma AI)
- Image CDN upload (upload_image_to_cdn)

Usage:
    from ai_service import (
        OPENAI_CLIENT, OPENAI_AVAILABLE, LUMA_AVAILABLE, IMAGE_AVAILABLE,
        SYSTEM_PROMPT_TEMPLATE, AR_INTERACTIONS,
        reload_system_prompt, chat_with_context,
        generate_opening_story, analyze_photo, generate_event,
        upload_image_to_cdn, generate_fictional_image
    )
"""

import os
import io
import re
import time
import base64
import traceback
import requests
from pathlib import Path
from typing import Dict, Tuple, Optional, List, Any
from PIL import Image as PILImage

from config import (
    OPENAI_API_KEY, OPENAI_MODEL, OPENAI_TEMPERATURE,
    AI_MODEL, AI_MODEL_VISION, AI_TEMPERATURE,
    LUMA_API_KEY, LUMA_API_BASE, LUMA_MODEL,
    TEMPLATE_FILE, AR_INTERACTIONS_FALLBACK, ACTION_TO_AR,
    RESULT_FOLDER
)
from job_manager import log
from user_manager import get_user_path


# ==========================================
# AI Client Initialization
# ==========================================
OPENAI_CLIENT = None
OPENAI_AVAILABLE = False

if OPENAI_API_KEY and OPENAI_API_KEY.startswith("sk-"):
    try:
        from openai import OpenAI
        OPENAI_CLIENT = OpenAI(api_key=OPENAI_API_KEY)
        OPENAI_AVAILABLE = True
        print(f"✓ OpenAI configured (ChatGPT 5.2)")
        print(f"  Model: {OPENAI_MODEL}")
    except Exception as e:
        print(f"✗ OpenAI error: {e}")

if not OPENAI_AVAILABLE:
    print(f"✗ OpenAI not configured")
    print(f"  Set OPENAI_API_KEY in .env")

# Luma AI availability
LUMA_AVAILABLE = bool(LUMA_API_KEY)
IMAGE_AVAILABLE = LUMA_AVAILABLE

if LUMA_AVAILABLE:
    print(f"✓ Luma AI Image Generation configured")
    print(f"  Model: {LUMA_MODEL}")
else:
    print(f"⚠️  No Luma AI API configured")
    print(f"  Set LUMA_API_KEY in .env to enable fictional image generation")


# ==========================================
# Template Loading (RAG Approach)
# ==========================================

# Global template cache
SYSTEM_PROMPT_TEMPLATE = None
AR_INTERACTIONS = {}  # Will be loaded from template or use fallback


def get_fallback_system_prompt() -> str:
    """Return a minimal fallback system prompt if prompt.md cannot be loaded."""
    return (
        "You are a creative storytelling AI for the Imaginary World project. "
        "You help users explore fictional worlds by crafting stories, analyzing photos, "
        "and generating events. Use second-person perspective. Be vivid but concise."
    )


def load_template_from_markdown(file_path: Path) -> str:
    """
    Load prompt template from Markdown file.
    Markdown is preferred because LLM models understand it natively.

    Args:
        file_path: Path to .md file

    Returns:
        Markdown content as system prompt

    Raises:
        FileNotFoundError: If template file does not exist
        RuntimeError: If template file cannot be read
    """
    if not file_path.exists():
        error_msg = f"CRITICAL: Prompt template not found: {file_path}"
        log("TEMPLATE", f"❌ {error_msg}")
        raise FileNotFoundError(error_msg)

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            template_text = f.read()

        if not template_text.strip():
            error_msg = f"CRITICAL: Prompt template is empty: {file_path}"
            log("TEMPLATE", f"❌ {error_msg}")
            raise RuntimeError(error_msg)

        log("TEMPLATE", f"✅ Loaded Markdown template: {len(template_text)} chars from {file_path.name}")
        return template_text

    except (FileNotFoundError, RuntimeError):
        raise
    except Exception as e:
        error_msg = f"CRITICAL: Error loading Markdown template: {e}"
        log("TEMPLATE", f"❌ {error_msg}")
        raise RuntimeError(error_msg)


def reload_system_prompt():
    """
    Reload system prompt from Markdown template file.
    Called at startup and can be called via API to hot-reload.

    Raises:
        FileNotFoundError: If prompt.md does not exist
        RuntimeError: If prompt.md cannot be loaded
    """
    global SYSTEM_PROMPT_TEMPLATE, AR_INTERACTIONS

    # Load Markdown template (will raise exception if not found)
    template_text = load_template_from_markdown(TEMPLATE_FILE)

    SYSTEM_PROMPT_TEMPLATE = template_text
    log("TEMPLATE", "✅ System prompt loaded from prompt.md")

    # Try to extract AR_INTERACTIONS from template
    # Look for patterns like "Tap": "description"
    ar_pattern = r'["\']?(Tap|Rotate|Track)["\']?\s*[:=]\s*["\']([^"\']+)["\']'
    matches = re.findall(ar_pattern, template_text, re.IGNORECASE)
    if matches:
        for ar_type, description in matches:
            AR_INTERACTIONS[ar_type.capitalize()] = description
        log("TEMPLATE", f"✅ Extracted AR_INTERACTIONS: {list(AR_INTERACTIONS.keys())}")
    else:
        AR_INTERACTIONS = AR_INTERACTIONS_FALLBACK.copy()
        log("TEMPLATE", "ℹ️ Using fallback AR_INTERACTIONS (not found in template)")


# ==========================================
# Conversation Context (RAG Approach)
# ==========================================
def chat_with_context(
    journey: Dict,
    user_message: str,
    image_base64: str = None,
    task_type: str = "general"
) -> str:
    """
    Send message to OpenAI with full conversation history and Markdown template.

    This implements the RAG approach where the system prompt comes from
    the Markdown template file (prompt.md).

    Args:
        journey: Journey object containing conversation_history
        user_message: New user message
        image_base64: Optional base64 encoded image
        task_type: Type of task for logging ("story", "photo", "event")

    Returns:
        AI response content
    """
    if not OPENAI_AVAILABLE:
        log("CHAT", "OpenAI not available")
        return "AI not available"

    # Get system prompt from loaded template (must be loaded at startup)
    if not SYSTEM_PROMPT_TEMPLATE:
        error_msg = "CRITICAL: System prompt template not loaded. Check prompt.md file."
        log("CHAT", f"❌ {error_msg}")
        raise RuntimeError(error_msg)

    system_prompt = SYSTEM_PROMPT_TEMPLATE

    # Build messages array with system prompt
    messages = [{"role": "system", "content": system_prompt}]

    # Add conversation history if exists
    conversation_history = journey.get("conversation_history", [])
    messages.extend(conversation_history)

    # Add new user message
    if image_base64:
        # Message with image
        new_message = {
            "role": "user",
            "content": [
                {"type": "text", "text": user_message},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{image_base64}",
                        "detail": "low"
                    }
                }
            ]
        }
    else:
        # Text only message
        new_message = {"role": "user", "content": user_message}

    messages.append(new_message)

    try:
        # Call OpenAI API
        response = OPENAI_CLIENT.chat.completions.create(
            model=AI_MODEL_VISION if image_base64 else AI_MODEL,
            messages=messages,
            max_completion_tokens=800,
            temperature=AI_TEMPERATURE
        )

        ai_response = response.choices[0].message.content.strip()

        # Update conversation history (store without image to save space)
        if image_base64:
            journey.setdefault("conversation_history", []).append({
                "role": "user",
                "content": f"{user_message} [Photo uploaded]"
            })
        else:
            journey.setdefault("conversation_history", []).append(new_message)

        journey["conversation_history"].append({
            "role": "assistant",
            "content": ai_response
        })

        log("CHAT", f"[{task_type}] History: {len(journey['conversation_history'])} messages")

        return ai_response

    except Exception as e:
        log("CHAT", f"Error in chat_with_context: {e}")
        return f"Error: {str(e)}"


# ==========================================
# OpenAI: Generate Story Background and Goal
# ==========================================
def generate_opening_story(
    backend_world: str,
    world_label: str,
    world_prompt_template: str,
    avoid_list: List[str] = None
) -> Dict[str, Any]:
    """
    Generate opening story using GPT.

    Output Format (from Prompt.md):
        Story Background: (within 30 words)
        Goal: (within 20 words)
        Title: (a captivating title)

    Args:
        backend_world: World type key (e.g., "Historical")
        world_label: Display name (e.g., "Historical")
        world_prompt_template: World setting description from IMAGINARY_WORLD
        avoid_list: Previously rejected story_backgrounds to avoid

    Returns:
        {title, story_background, goal, story_html, story_plain}
    """

    try:
        # Build avoid instruction if user rejected previous stories
        avoid_instruction = ""
        if avoid_list and len(avoid_list) > 0:
            rejected_items = "\n".join(f'- "{bg}"' for bg in avoid_list)
            avoid_instruction = f"""

The user doesn't like these previous stories, please generate a completely different one:
{rejected_items}
"""

        # Use the exact format from Prompt.md
        prompt = f"""I choose the {world_label} world.

{world_prompt_template}
{avoid_instruction}
Please craft a story analogous to a routine of taking photos in daily life. Use second-person perspective. The protagonist should have a goal.

The writing style should be accessible and direct, meanwhile incorporating moderate imagery or sensory details if necessary.

Output Format:
Story Background: (one or two phrases)
Goal: (within 20 words)
Title: (a captivating title)"""

        response = OPENAI_CLIENT.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT_TEMPLATE or get_fallback_system_prompt()},
                {"role": "user", "content": prompt}
            ],
            max_completion_tokens=300,
            temperature=AI_TEMPERATURE
        )

        log("OPENAI", f"Story generation successful (model: {AI_MODEL})")
        content = response.choices[0].message.content.strip()
        log("OPENAI", f"Generated content: {content[:200]}...")

        # Parse the response
        story_background = ""
        goal = ""
        title = world_label

        lines = content.split('\n')
        for line in lines:
            line = line.strip()
            if line.lower().startswith("story background:"):
                story_background = line.split(":", 1)[1].strip()
            elif line.lower().startswith("goal:"):
                goal = line.split(":", 1)[1].strip()
            elif line.lower().startswith("title:"):
                title = line.split(":", 1)[1].strip()

        # Build story HTML
        story_html = f"<p><strong>{story_background}</strong></p>"

        return {
            "title": title or f"Adventure in {world_label}",
            "story_background": story_background or f"A mysterious {world_label} awaits.",
            "goal": goal or "Find three magical items.",
            "story_html": story_html
        }

    except Exception as e:
        log("OPENAI", f"❌ Error generating story: {type(e).__name__}: {e}")
        log("OPENAI", f"Traceback: {traceback.format_exc()}")
        return {
            "title": f"Adventure in {world_label}",
            "story_background": f"A mysterious {world_label} awaits exploration.",
            "goal": "Find three magical items to complete your quest.",
            "story_html": f"<p>Welcome to {world_label}.</p>"
        }


# ==========================================
# OpenAI: Analyze Photo
# ==========================================
def analyze_photo(photo_base64: str) -> Dict[str, Any]:
    """
    Analyze uploaded photo to identify setting and objects.

    Output Format:
        Photo Place: (one short phrase)
        Photo Place Category: (one short phrase)
        Photo Item: (one or two key objects)
        Photo Item Category: (one short phrase)

    Returns:
        {photo_place, photo_place_category, photo_item, photo_item_category}
    """
    if not OPENAI_AVAILABLE:
        return {
            "photo_place": "Unknown Location",
            "photo_place_category": "Place",
            "photo_item": "Mysterious Object",
            "photo_item_category": "Object"
        }

    try:
        prompt = """Analyze this image and describe the setting and the main object in simple English.
Identify the basic-level categories of the setting and the object respectively.

Please provide your response in the following exact format:

Photo Place: (one short phrase describing the location/setting)
Photo Place Category: (one short phrase - the basic-level category of the place)
Photo Item: (one or two key objects visible in the image)
Photo Item Category: (one short phrase - the basic-level category of the item)

Be concise and use simple, common English words."""

        response = OPENAI_CLIENT.chat.completions.create(
            model=AI_MODEL_VISION,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{photo_base64}",
                                "detail": "low"
                            }
                        }
                    ]
                }
            ],
            max_completion_tokens=200
        )

        content = response.choices[0].message.content.strip()

        # Parse response
        result = {
            "photo_place": "",
            "photo_place_category": "",
            "photo_item": "",
            "photo_item_category": ""
        }

        lines = content.split('\n')
        for line in lines:
            line = line.strip()
            if line.lower().startswith("photo place category:"):
                result["photo_place_category"] = line.split(":", 1)[1].strip()
            elif line.lower().startswith("photo place:"):
                result["photo_place"] = line.split(":", 1)[1].strip()
            elif line.lower().startswith("photo item category:"):
                result["photo_item_category"] = line.split(":", 1)[1].strip()
            elif line.lower().startswith("photo item:"):
                result["photo_item"] = line.split(":", 1)[1].strip()

        return result

    except Exception as e:
        log("OPENAI", f"Error analyzing photo: {e}")
        return {
            "photo_place": "Unknown Location",
            "photo_place_category": "Place",
            "photo_item": "Object",
            "photo_item_category": "Object"
        }


# ==========================================
# OpenAI: Generate Event
# ==========================================
def generate_event(
    photo_analysis: Dict[str, Any],
    story_background: str,
    goal: str,
    backend_world: str,
    world_label: str,
    event_index: int
) -> Dict[str, Any]:
    """
    Generate fictional event based on photo analysis.

    Constraints (from Prompt.md):
    - Fictional Location shares same basic-level category as Photo Place Category
    - Fictional Item or Character shares same basic-level category as Photo Item Category
    - Event Action belongs to basic-level category of "Touch", "Turning", or "Following"

    Output Format:
        Fictional Event #: (within 40 words)
        Fictional Location: (one short phrase)
        Fictional Item or Character: (one short phrase)
        Fictional Action: (one or two phrases)
        Event Action Category: (Touch, Turning, or Following)

    Returns:
        {fictional_event, fictional_location, fictional_item_or_character,
         event_action, event_action_category, ar_interaction, 3d_item}
    """

    event_num = event_index + 1

    prompt = f"""This is Event {event_num} of 3.

Story Background: {story_background}
Goal: {goal}
World: {world_label}

The user uploaded a photo. Here is the analysis:
Photo Place: {photo_analysis.get('photo_place', 'location')}
Photo Place Category: {photo_analysis.get('photo_place_category', 'place')}
Photo Item: {photo_analysis.get('photo_item', 'object')}
Photo Item Category: {photo_analysis.get('photo_item_category', 'object')}

In this event:
- The Fictional Location should share the same basic-level category as the Photo Place Category
- The Fictional Item or Character should share the same basic-level category as the Photo Item Category
- Choose an Event Action Category that fits naturally with the story:
  * "Touch" for actions like touching, tapping, pressing, or making physical contact
  * "Turning" for actions like rotating, spinning, turning, or twisting
  * "Following" for actions like following, tracking, chasing, or pursuing

Output Format:
Fictional Event {event_num}: (within 40 words)
Fictional Location: (one short phrase)
Fictional Item or Character: (one short phrase)
Fictional Action: (one or two phrases)
Event Action Category: (choose one: Touch, Turning, or Following)"""

    response = OPENAI_CLIENT.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT_TEMPLATE or get_fallback_system_prompt()},
                {"role": "user", "content": prompt}
            ],
            max_completion_tokens=300
        )

    content = response.choices[0].message.content.strip()

    log("EVENT", f"Event {event_num}: AI choosing action category based on story context")

    # Parse response
    result = {
        "fictional_event": "",
        "fictional_location": "",
        "location": "",
        "fictional_item_or_character": "",
        "item_or_character": "",
        "event_action": "",
        "action": "",
        "event_action_category": "Touch",  # Default, will be overwritten by AI response
        "action_category": "Touch",
        "ar_interaction": "",
        "3d_item": ""
    }

    lines = content.split('\n')
    for line in lines:
        line = line.strip()
        lower_line = line.lower()

        # Parse "Fictional Event #:" or "Fictional Event:" format
        if lower_line.startswith("fictional event"):
            if ":" in line:
                value = line.split(":", 1)[1].strip()
                result["fictional_event"] = value
        # Parse "Fictional Item or Character:" or "Fictional Item:" format
        elif lower_line.startswith("fictional item"):
            value = line.split(":", 1)[1].strip()
            result["fictional_item_or_character"] = value
            result["item_or_character"] = value
        elif lower_line.startswith("fictional location:"):
            value = line.split(":", 1)[1].strip()
            result["fictional_location"] = value
            result["location"] = value
        # Parse "Fictional Action:" format
        elif lower_line.startswith("fictional action:"):
            value = line.split(":", 1)[1].strip()
            result["event_action"] = value
            result["action"] = value
        # Parse Event Action Category (AI chooses based on story context)
        elif lower_line.startswith("event action category:"):
            category = line.split(":", 1)[1].strip().lower()
            if "touch" in category:
                result["event_action_category"] = "Touch"
                result["action_category"] = "Touch"
            elif "turning" in category or "turn" in category or "rotate" in category:
                result["event_action_category"] = "Turning"
                result["action_category"] = "Turning"
            elif "following" in category or "follow" in category or "track" in category:
                result["event_action_category"] = "Following"
                result["action_category"] = "Following"
        # Legacy: also support "Event Action:" for backward compatibility
        elif lower_line.startswith("event action:") and not lower_line.startswith("event action category"):
            value = line.split(":", 1)[1].strip()
            result["event_action"] = value
            result["action"] = value

    # Map action category to AR interaction type (Touch->Tap, Turning->Rotate, Following->Track)
    ar_type = ACTION_TO_AR.get(result["event_action_category"], "Tap")
    result["ar_interaction"] = AR_INTERACTIONS.get(ar_type, "")
    result["ar_interaction_type"] = ar_type
    result["3d_item"] = f"3D {result['fictional_item_or_character']}"

    log("EVENT", f"Event {event_num}: Final action = {result['event_action_category']} -> AR: {ar_type}")

    return result


# ==========================================
# Helper: Upload image to temporary CDN for Luma AI
# ==========================================
def upload_image_to_cdn(image_path: str) -> Optional[str]:
    """
    Upload an image to a temporary CDN for use with Luma AI image_ref.
    Uses 0x0.st as a simple file hosting service.

    Compresses the image to 1024px max before upload to reduce transfer time.
    Luma only uses it as a style/angle reference, so full resolution is unnecessary.

    Args:
        image_path: Path to the local image file

    Returns:
        Public URL of the uploaded image, or None if upload failed
    """
    try:
        if not os.path.exists(image_path):
            log("CDN", f"Image file not found: {image_path}")
            return None

        # Compress image in memory before uploading
        original_size = os.path.getsize(image_path)
        buf = io.BytesIO()
        fallback_fh = None
        try:
            with PILImage.open(image_path) as img:
                if img.mode in ('RGBA', 'P', 'LA'):
                    img = img.convert('RGB')
                img.thumbnail((1024, 1024), PILImage.LANCZOS)
                img.save(buf, format='JPEG', quality=82)
                buf.seek(0)
                log("CDN", f"Compressed for CDN: {original_size / 1024:.0f}KB → {buf.getbuffer().nbytes / 1024:.0f}KB ({img.size[0]}×{img.size[1]})")
        except Exception as e:
            log("CDN", f"⚠️ Compression failed, uploading original: {e}")
            buf.close()
            fallback_fh = open(image_path, 'rb')
            buf = fallback_fh

        # Use 0x0.st for temporary file hosting
        response = requests.post(
            'https://0x0.st',
            files={'file': ('photo.jpg', buf, 'image/jpeg')},
            timeout=30
        )

        if fallback_fh:
            fallback_fh.close()

        if response.status_code == 200:
            url = response.text.strip()
            log("CDN", f"✅ Image uploaded to CDN: {url}")
            return url
        else:
            log("CDN", f"❌ Upload failed: HTTP {response.status_code}")
            return None

    except Exception as e:
        log("CDN", f"❌ Upload error: {type(e).__name__}: {e}")
        return None


# ==========================================
# Luma AI: Generate Fictional Image
# ==========================================
def generate_fictional_image(
    item_name: str,
    backend_world: str,
    world_label: str,
    journey_id: str,
    event_index: int,
    user_id: str = None,
    story_background: str = None,
    photo_path: str = None
) -> Tuple[Optional[str], Optional[Path]]:
    """
    Generate an image of the fictional item or character using Luma AI.

    Uses async API with polling for completion.
    Supports image_ref to match camera angle/perspective from user's photo.

    Args:
        item_name: Name of the item/character to generate
        backend_world: World type for styling
        world_label: Display label for world
        journey_id: Journey ID
        event_index: Event index (0-based)
        user_id: User ID for new folder structure (e.g., "user_1")
        story_background: Story context to include in prompt
        photo_path: Path to user's uploaded photo for camera angle reference

    Returns:
        Tuple of (URL path to the generated image, actual file path) or (None, None)
    """
    if not LUMA_AVAILABLE:
        log("LUMA", "Luma AI not available - skipping image generation")
        return None, None

    try:
        # Build world-specific style prompt
        world_styles = {
            "Historical": "historically accurate, period-appropriate, cinematic lighting, photorealistic",
            "Overlaid": "realistic with subtle magical elements, natural lighting, photorealistic",
            "Alternate": "steampunk aesthetic, alternate history, detailed textures, photorealistic",
            "SciFi_Earth": "futuristic design, sci-fi aesthetic, volumetric lighting, photorealistic",
            "SciFi_Galaxy": "alien design, cosmic atmosphere, bioluminescent, photorealistic",
            "Fantasy": "magical atmosphere, ethereal glow, fantasy style, high detail"
        }

        style = world_styles.get(backend_world, world_styles["Fantasy"])

        # Build prompt with story background context
        story_context = ""
        if story_background:
            story_context = f"The story background is: {story_background}. "

        # Step 1: Upload photo to CDN for image reference (if provided)
        image_ref_url = None
        use_modify_mode = False

        if photo_path and os.path.exists(photo_path):
            log("LUMA", "Uploading photo to CDN for image reference...")
            image_ref_url = upload_image_to_cdn(photo_path)
            if image_ref_url:
                log("LUMA", f"✅ Photo uploaded for reference: {image_ref_url}")
                use_modify_mode = True
            else:
                log("LUMA", "⚠️ Photo upload failed, proceeding without image reference")

        # Build prompt based on mode
        if use_modify_mode:
            prompt = f"""{story_context}Transform this into {item_name}, {style}, keep the same camera angle and perspective, clean background suitable for AR overlay, professional quality, high detail"""
        else:
            prompt = f"""{story_context}Generate an image of {item_name}, {style}, three-quarter view from 30 to 60 degree angle, slight side perspective showing depth, centered composition, clean background suitable for AR overlay, professional quality, high detail"""

        log("LUMA", f"Generating image for: {item_name}")
        log("LUMA", f"Using model: {LUMA_MODEL}")
        log("LUMA", f"Mode: {'modify_image_ref' if use_modify_mode else 'text-to-image'}")
        log("LUMA", f"Story background: {story_background[:50] if story_background else 'None'}...")
        log("LUMA", f"Photo reference: {image_ref_url if image_ref_url else 'None'}")
        log("LUMA", f"Prompt: {prompt[:100]}...")

        # Step 2: Start generation (async)
        headers = {
            "Authorization": f"Bearer {LUMA_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

        payload = {
            "prompt": prompt,
            "model": LUMA_MODEL,
            "aspect_ratio": "1:1"
        }

        # Use modify_image_ref for better camera angle matching
        if image_ref_url and use_modify_mode:
            payload["modify_image_ref"] = {
                "url": image_ref_url,
                "weight": 0.85
            }
            log("LUMA", "Using modify_image_ref for camera angle preservation (weight=0.85)")

        # Start generation
        response = requests.post(
            f"{LUMA_API_BASE}/generations/image",
            headers=headers,
            json=payload,
            timeout=30
        )

        if response.status_code != 200 and response.status_code != 201:
            log("LUMA", f"❌ Failed to start generation: HTTP {response.status_code}")
            log("LUMA", f"Response: {response.text}")
            return None, None

        generation_data = response.json()
        generation_id = generation_data.get("id")

        if not generation_id:
            log("LUMA", f"❌ No generation ID received")
            return None, None

        log("LUMA", f"Generation started: {generation_id}")

        # Step 3: Poll for completion (max 2 minutes)
        max_attempts = 60  # 60 attempts x 2 seconds = 2 minutes
        poll_interval = 2  # seconds

        for attempt in range(max_attempts):
            time.sleep(poll_interval)

            status_response = requests.get(
                f"{LUMA_API_BASE}/generations/{generation_id}",
                headers=headers,
                timeout=30
            )

            if status_response.status_code != 200:
                log("LUMA", f"Poll attempt {attempt+1}: HTTP {status_response.status_code}")
                continue

            status_data = status_response.json()
            state = status_data.get("state", "unknown")

            if state == "completed":
                # Get image URL from assets
                assets = status_data.get("assets", {})
                image_url = assets.get("image")

                if not image_url:
                    log("LUMA", f"❌ Completed but no image URL in assets")
                    return None, None

                log("LUMA", f"✅ Generation completed: {image_url[:50]}...")
                break

            elif state == "failed":
                failure_reason = status_data.get("failure_reason", "Unknown error")
                log("LUMA", f"❌ Generation failed: {failure_reason}")
                return None, None

            # Still processing
            if attempt % 5 == 0:
                log("LUMA", f"Waiting... state: {state} (attempt {attempt+1}/{max_attempts})")
        else:
            log("LUMA", f"❌ Generation timeout after {max_attempts * poll_interval} seconds")
            return None, None

        # Step 4: Download and save locally
        img_response = requests.get(image_url, timeout=60)
        if img_response.status_code == 200:
            # Determine save path based on user structure
            if user_id:
                # New structure: save to user's fictional_images folder
                filename = f"event_{event_index + 1}.png"
                fictional_images_folder = get_user_path(user_id, "fictional_images")
                fictional_images_folder.mkdir(parents=True, exist_ok=True)
                filepath = fictional_images_folder / filename
                url_path = f"/user/{user_id}/fictional_images/{filename}"
            else:
                # Legacy structure
                filename = f"fictional_{journey_id}_{event_index}.png"
                filepath = RESULT_FOLDER / filename
                url_path = f"/results/{filename}"

            with open(filepath, "wb") as f:
                f.write(img_response.content)
            log("LUMA", f"✅ Fictional image saved: {filepath}")
            return url_path, filepath
        else:
            log("LUMA", f"❌ Failed to download image: HTTP {img_response.status_code}")

        return None, None

    except Exception as e:
        log("LUMA", f"❌ Error generating fictional image: {type(e).__name__}: {e}")
        log("LUMA", f"Traceback: {traceback.format_exc()}")
        return None, None
