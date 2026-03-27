"""
Imaginary World - Job & Journey Manager (Hostinger Version)
============================================================
Handles job status tracking and journey persistence.
No conda/SAM3/SAM3D environment checks (those run on Vast.ai).
"""

import os
import json
import uuid
import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, List

from config import JOBS_FILE, JOURNEYS_FOLDER, ALLOWED_EXTENSIONS


# ==========================================
# Logging Utility
# ==========================================
def log(context, message):
    """Print timestamped log message"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] [{context}] {message}", flush=True)


# ==========================================
# Job Management
# ==========================================
JOBS_LOCK = threading.Lock()


def load_jobs() -> Dict:
    if JOBS_FILE.exists():
        try:
            with open(JOBS_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}


def save_jobs(jobs: Dict):
    with open(JOBS_FILE, 'w') as f:
        json.dump(jobs, f, indent=2, default=str)


def create_job(job_id: str, prompt: str, input_file: str, boxes: List = None, points: List = None):
    with JOBS_LOCK:
        jobs = load_jobs()
        jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "prompt": prompt,
            "boxes": boxes or [],
            "points": points or [],
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "started_at": None,
            "completed_at": None,
            "current_step": "Queued",
            "progress": 0,
            "files": {"input": input_file},
            "error": None
        }
        save_jobs(jobs)


def update_job_status(job_id: str, status: str, step: str = "", progress: int = 0,
                      error: str = None, files: Dict = None):
    with JOBS_LOCK:
        jobs = load_jobs()
        if job_id in jobs:
            jobs[job_id]["status"] = status
            jobs[job_id]["current_step"] = step
            jobs[job_id]["progress"] = progress
            jobs[job_id]["updated_at"] = datetime.now().isoformat()
            if error:
                jobs[job_id]["error"] = error
            if files:
                jobs[job_id]["files"].update(files)
            if status == "completed":
                jobs[job_id]["completed_at"] = datetime.now().isoformat()
            save_jobs(jobs)
    log(job_id, f"Status: {status} | Step: {step} | Progress: {progress}%")


def generate_job_id() -> str:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    unique = uuid.uuid4().hex[:6]
    return f"job_{timestamp}_{unique}"


# ==========================================
# Journey Management
# ==========================================
def save_journey(user_id: str, journey_id: str, journey: Dict):
    user_path = JOURNEYS_FOLDER / user_id
    user_path.mkdir(parents=True, exist_ok=True)
    journey_path = user_path / f"{journey_id}.json"
    with open(journey_path, "w", encoding="utf-8") as f:
        json.dump(journey, f, ensure_ascii=False, indent=2)


def load_journey(user_id: str, journey_id: str) -> Optional[Dict]:
    journey_path = JOURNEYS_FOLDER / user_id / f"{journey_id}.json"
    if journey_path.exists():
        try:
            with open(journey_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return None
    return None


# ==========================================
# Helper Functions
# ==========================================
def allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def simplify_prompt_for_sam3(prompt: str) -> str:
    """Simplify prompt for SAM3 segmentation."""
    if not prompt:
        return "object"

    remove_words = [
        'magical', 'ancient', 'mystical', 'enchanted', 'mysterious',
        'beautiful', 'amazing', 'wonderful', 'fantastic',
        'the', 'a', 'an', 'this', 'that', 'these', 'those',
        'fictional', 'digital', 'generated', 'ai'
    ]

    words = prompt.lower().split()
    filtered_words = [w for w in words if w not in remove_words]
    simplified = ' '.join(filtered_words[:3])

    object_mappings = {
        'guardian': 'person', 'character': 'person',
        'warrior': 'person', 'hero': 'person',
        'creature': 'animal', 'beast': 'animal',
    }

    for key, value in object_mappings.items():
        if key in simplified:
            simplified = simplified.replace(key, value)

    return simplified if simplified else "object"
