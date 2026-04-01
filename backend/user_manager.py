"""
Imaginary World - User & Folder Manager
=========================================
Handles:
- User folder creation with structure: data/{username}/{world_type}/{timestamp}/
- Guest user ID generation (guest_1, guest_2, ...)
- Journey file save/load for individual users
- Unified journey lookup (database + file fallback)

Folder structure:
    data/{username}/
        {WorldType}/
            {YYYYMMDD_HHMMSS}/
                journey.json
                photos/
                cutouts/
                fictional_images/
                real_3d/
                fictional_3d/

Usage:
    from user_manager import (
        create_story_folder, get_next_guest_id,
        get_story_path, save_user_journey, load_user_journey,
        load_journey_unified, smart_save_journey,
        get_current_data_folder, list_user_journeys,
        # Legacy compat
        get_next_user_id, create_user_folder, get_user_path,
    )
"""

import os
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from config import DATA_FOLDER, DATA_FOLDER_TEST, USER_COUNTER_FILE
from job_manager import log

# Database imports for unified journey loading
from database import get_story_by_journey_id

# Subfolders created inside each story folder
STORY_SUBFOLDERS = ["photos", "cutouts", "fictional_images", "real_3d", "fictional_3d"]


def get_current_data_folder() -> Path:
    """
    Get the current data folder based on test mode.
    Uses Flask g.data_folder if in request context, otherwise defaults to DATA_FOLDER.
    """
    try:
        from flask import has_request_context, g
        if has_request_context() and hasattr(g, 'data_folder'):
            return g.data_folder
    except:
        pass
    return DATA_FOLDER


# ==========================================
# New: Username/WorldType/Timestamp structure
# ==========================================

def create_story_folder(username: str, world_type: str) -> Tuple[str, Path]:
    """
    Create a story folder: data/{username}/{world_type}/{timestamp}/
    with all 6 subfolders.

    Args:
        username: Username (registered) or guest_N (guest)
        world_type: e.g. "Historical", "Fantasy", "SciFi_Earth"

    Returns:
        (user_folder_id, story_folder_path)
        user_folder_id is relative to data/, e.g. "eric/Historical/20260401_120000"
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    data_folder = get_current_data_folder()
    story_folder = data_folder / username / world_type / timestamp

    for subfolder in STORY_SUBFOLDERS:
        (story_folder / subfolder).mkdir(parents=True, exist_ok=True)

    # user_folder_id = relative path from data/
    user_folder_id = f"{username}/{world_type}/{timestamp}"
    log("USER", f"Created story folder: {story_folder}")
    return user_folder_id, story_folder


def get_story_path(user_folder_id: str, subfolder: str = None, data_folder: Path = None) -> Path:
    """
    Get path to a story folder or its subfolder.

    Args:
        user_folder_id: e.g. "eric/Historical/20260401_120000"
        subfolder: "photos", "cutouts", "fictional_images", "real_3d", "fictional_3d"
        data_folder: Override data folder (for background threads)

    Returns:
        Absolute path
    """
    if data_folder is None:
        data_folder = get_current_data_folder()
    story_folder = data_folder / user_folder_id
    if subfolder:
        return story_folder / subfolder
    return story_folder


def list_user_journeys(username: str) -> List[Dict]:
    """
    List all journeys for a user by scanning their folder structure.

    Args:
        username: The username folder to scan

    Returns:
        List of journey summary dicts, sorted by newest first
    """
    data_folder = get_current_data_folder()
    user_root = data_folder / username
    journeys = []

    if not user_root.exists():
        return journeys

    for world_dir in sorted(user_root.iterdir()):
        if not world_dir.is_dir():
            continue
        world_type = world_dir.name
        for ts_dir in sorted(world_dir.iterdir(), reverse=True):
            if not ts_dir.is_dir():
                continue
            journey_path = ts_dir / "journey.json"
            if journey_path.exists():
                try:
                    with open(journey_path, "r", encoding="utf-8") as f:
                        journey = json.load(f)
                    journeys.append({
                        "journey_id": journey.get("journey_id"),
                        "imaginary_world": world_type,
                        "title": (journey.get("titles") or ["Untitled"])[-1],
                        "story_background": journey.get("story_background", ""),
                        "status": journey.get("status", "active"),
                        "progress": len(journey.get("events", [])),
                        "total_events": journey.get("total_events", 3),
                        "created_at": journey.get("created_at", ts_dir.name),
                        "user_folder_id": f"{username}/{world_type}/{ts_dir.name}",
                    })
                except Exception:
                    continue

    # Sort by created_at descending
    journeys.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return journeys


# ==========================================
# Guest ID generation
# ==========================================

def get_next_guest_id() -> str:
    """
    Get next guest ID (guest_1, guest_2, etc.)
    Uses the same counter file.
    """
    if USER_COUNTER_FILE.exists():
        try:
            with open(USER_COUNTER_FILE, "r") as f:
                data = json.load(f)
                next_id = data.get("next_guest_id", 1)
        except:
            next_id = 1
    else:
        next_id = 1

    # Save incremented counter
    counter_data = {}
    if USER_COUNTER_FILE.exists():
        try:
            with open(USER_COUNTER_FILE, "r") as f:
                counter_data = json.load(f)
        except:
            pass
    counter_data["next_guest_id"] = next_id + 1
    with open(USER_COUNTER_FILE, "w") as f:
        json.dump(counter_data, f)

    return f"guest_{next_id}"


# ==========================================
# Journey save/load (works with new structure)
# ==========================================

def save_user_journey(user_folder_id: str, journey_data: Dict, data_folder: Path = None):
    """
    Save journey.json to a story folder.

    Args:
        user_folder_id: Relative path, e.g. "eric/Historical/20260401_120000" or legacy "user_1"
        journey_data: Journey data dict
        data_folder: Override data folder (for background threads)
    """
    story_folder = get_story_path(user_folder_id, data_folder=data_folder)
    story_folder.mkdir(parents=True, exist_ok=True)

    journey_path = story_folder / "journey.json"
    with open(journey_path, "w", encoding="utf-8") as f:
        json.dump(journey_data, f, ensure_ascii=False, indent=2)

    log("USER", f"Saved journey to {journey_path}")


def load_user_journey(user_folder_id: str, data_folder: Path = None) -> Optional[Dict]:
    """
    Load journey.json from a story folder.

    Args:
        user_folder_id: Relative path, e.g. "eric/Historical/20260401_120000" or legacy "user_1"
    """
    if data_folder is None:
        data_folder = get_current_data_folder()
    journey_path = data_folder / user_folder_id / "journey.json"
    if journey_path.exists():
        try:
            with open(journey_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return None
    return None


def load_journey_unified(journey_id: str):
    """
    Load a journey by journey_id using unified lookup.
    First checks database for user_folder_id, then loads from file.
    Falls back to scanning all user folders.

    Returns:
        tuple: (journey_data, user_folder_id) or (None, None) if not found
    """
    # Step 1: Check database for user_folder_id
    story = get_story_by_journey_id(journey_id)
    if story and story.get("user_folder_id"):
        user_folder_id = story["user_folder_id"]
        journey = load_user_journey(user_folder_id)
        if journey:
            return journey, user_folder_id
        # Try alternate data folder
        alt_folder = DATA_FOLDER_TEST if get_current_data_folder() == DATA_FOLDER else DATA_FOLDER
        journey = load_user_journey(user_folder_id, data_folder=alt_folder)
        if journey:
            return journey, user_folder_id

    # Step 2: Fallback - scan folders for this journey_id
    data_folder = get_current_data_folder()
    result = _scan_for_journey(data_folder, journey_id)
    if result:
        return result

    # Step 3: Try alt data folder
    alt_folder = DATA_FOLDER_TEST if data_folder == DATA_FOLDER else DATA_FOLDER
    if alt_folder != data_folder:
        result = _scan_for_journey(alt_folder, journey_id)
        if result:
            return result

    return None, None


def _scan_for_journey(data_folder: Path, journey_id: str):
    """
    Recursively scan data_folder for a journey.json matching journey_id.
    Handles both new structure (username/world/timestamp/) and legacy (user_N/).
    """
    skip_dirs = {'results', 'temp', 'uploads', 'journeys'}

    for root, dirs, files in os.walk(str(data_folder)):
        # Skip non-data directories
        rel = Path(root).relative_to(data_folder)
        if rel.parts and rel.parts[0] in skip_dirs:
            dirs.clear()
            continue

        if "journey.json" in files:
            journey_path = Path(root) / "journey.json"
            try:
                with open(journey_path, "r", encoding="utf-8") as f:
                    journey = json.load(f)
                if journey.get("journey_id") == journey_id:
                    # Compute user_folder_id as relative path from data_folder
                    user_folder_id = str(Path(root).relative_to(data_folder))
                    return journey, user_folder_id
            except:
                continue

    return None


def smart_save_journey(user_folder_id: str, journey_id: str, journey_data: Dict, data_folder: Path = None):
    """
    Save journey to the correct location.

    Args:
        user_folder_id: Relative path from data/, e.g. "eric/Historical/20260401_120000"
        journey_id: Journey ID (for logging)
        journey_data: Journey data dict
        data_folder: Override data folder
    """
    save_user_journey(user_folder_id, journey_data, data_folder=data_folder)


# ==========================================
# Legacy compatibility aliases
# ==========================================

def get_next_user_id() -> str:
    """Legacy: returns guest_N instead of user_N."""
    return get_next_guest_id()


def create_user_folder(user_id: str) -> Path:
    """Legacy: create a flat user folder (for old code paths)."""
    data_folder = get_current_data_folder()
    user_folder = data_folder / user_id
    for subfolder in STORY_SUBFOLDERS:
        (user_folder / subfolder).mkdir(parents=True, exist_ok=True)
    log("USER", f"[Legacy] Created user folder: {user_folder}")
    return user_folder


def get_user_path(user_id: str, subfolder: str = None, data_folder: Path = None) -> Path:
    """Legacy alias for get_story_path."""
    return get_story_path(user_id, subfolder, data_folder)
