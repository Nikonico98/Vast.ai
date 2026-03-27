"""
Imaginary World - User & Folder Manager
=========================================
Handles:
- User ID generation (user_1, user_2, ...)
- User folder creation and path resolution
- Journey file save/load for individual users
- Unified journey lookup (database + file fallback)

Usage:
    from user_manager import (
        get_next_user_id, create_user_folder, get_user_path,
        save_user_journey, load_user_journey,
        load_journey_unified, smart_save_journey,
        get_current_data_folder
    )
"""

import os
import json
from pathlib import Path
from typing import Dict, Optional

from config import DATA_FOLDER, DATA_FOLDER_TEST, USER_COUNTER_FILE
from job_manager import log

# Database imports for unified journey loading
from database import get_story_by_journey_id


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


def get_next_user_id() -> str:
    """
    Get next user ID (user_1, user_2, etc.)
    Uses a counter file to track the next available ID.
    """
    if USER_COUNTER_FILE.exists():
        try:
            with open(USER_COUNTER_FILE, "r") as f:
                data = json.load(f)
                next_id = data.get("next_id", 1)
        except:
            next_id = 1
    else:
        next_id = 1

    # Save incremented counter
    with open(USER_COUNTER_FILE, "w") as f:
        json.dump({"next_id": next_id + 1}, f)

    return f"user_{next_id}"


def create_user_folder(user_id: str) -> Path:
    """
    Create user folder with all subfolders.

    Structure:
        data/user_x/
            ├── journey.json
            ├── photos/
            ├── fictional_images/
            ├── cutouts/
            ├── real_3d/
            └── fictional_3d/
    """
    data_folder = get_current_data_folder()
    user_folder = data_folder / user_id

    # Create all subfolders
    subfolders = ["photos", "fictional_images", "cutouts", "real_3d", "fictional_3d"]
    for subfolder in subfolders:
        (user_folder / subfolder).mkdir(parents=True, exist_ok=True)

    log("USER", f"Created user folder: {user_folder}")
    return user_folder


def get_user_path(user_id: str, subfolder: str = None, data_folder: Path = None) -> Path:
    """
    Get path to user's folder or subfolder.

    Args:
        user_id: e.g., "user_1"
        subfolder: "photos", "fictional_images", "real_3d", or "fictional_3d"
        data_folder: Explicit data folder path (use when outside request context, e.g., background threads)

    Returns:
        Path to user folder or subfolder
    """
    if data_folder is None:
        data_folder = get_current_data_folder()
    user_folder = data_folder / user_id
    if subfolder:
        return user_folder / subfolder
    return user_folder


def save_user_journey(user_id: str, journey_data: Dict, data_folder: Path = None):
    """
    Save journey.json to user's folder.
    This is the main metadata file for each user.

    Args:
        user_id: User folder ID
        journey_data: Journey data dict
        data_folder: Explicit data folder path (use when outside request context)
    """
    user_folder = get_user_path(user_id, data_folder=data_folder)
    user_folder.mkdir(parents=True, exist_ok=True)

    journey_path = user_folder / "journey.json"
    with open(journey_path, "w", encoding="utf-8") as f:
        json.dump(journey_data, f, ensure_ascii=False, indent=2)

    log("USER", f"Saved journey for {user_id} in {user_folder}")


def load_user_journey(user_id: str) -> Optional[Dict]:
    """
    Load journey.json from user's folder.
    """
    journey_path = get_user_path(user_id) / "journey.json"
    if journey_path.exists():
        try:
            with open(journey_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return None
    return None


def load_journey_unified(journey_id: str):
    """
    Load a journey by journey_id using the unified data structure.
    First checks database for user_folder_id, then loads from file.

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
        # Try alternate data folder (story may have been created in test/production mode)
        alt_folder = DATA_FOLDER_TEST if get_current_data_folder() == DATA_FOLDER else DATA_FOLDER
        alt_path = alt_folder / user_folder_id / "journey.json"
        if alt_path.exists():
            try:
                with open(alt_path, "r", encoding="utf-8") as f:
                    journey = json.load(f)
                if journey:
                    return journey, user_folder_id
            except:
                pass

    # Step 2: Fallback - search all user folders for this journey_id
    data_folder = get_current_data_folder()
    for folder in os.listdir(data_folder):
        folder_path = data_folder / folder
        if not folder_path.is_dir():
            continue
        if folder.startswith('_') or folder in ['results', 'temp', 'uploads']:
            continue

        journey_path = folder_path / "journey.json"
        if journey_path.exists():
            try:
                with open(journey_path, "r", encoding="utf-8") as f:
                    journey = json.load(f)
                if journey.get("journey_id") == journey_id:
                    return journey, folder
            except:
                continue

    return None, None


def smart_save_journey(user_folder_id: str, journey_id: str, journey_data: Dict, data_folder: Path = None):
    """
    Save journey to the unified NEW structure: /data/{user_folder_id}/journey.json
    Legacy locations are no longer used.

    Args:
        user_folder_id: User folder ID
        journey_id: Journey ID (for logging)
        journey_data: Journey data dict
        data_folder: Explicit data folder path (use when outside request context)
    """
    save_user_journey(user_folder_id, journey_data, data_folder=data_folder)
