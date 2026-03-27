"""
Imaginary World - SQLite Database Module
=========================================
Handles user authentication and story management.

Tables:
- users: User accounts with hashed passwords
- stories: User's story journeys

Author: Imaginary World Team
"""

import sqlite3
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any
from werkzeug.security import generate_password_hash, check_password_hash

# Database file path
DB_PATH = Path(__file__).parent.parent / "data" / "users.db"


def get_db():
    """
    Get database connection.
    
    Returns:
        sqlite3.Connection with Row factory enabled
    """
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row  # Allow accessing columns by name, e.g. row["username"]
    return conn


def init_db():
    """
    Initialize database tables.
    
    Creates two tables:
    - users: Store user account information
    - stories: Store user's story records
    """
    # Ensure data directory exists
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    conn = get_db()
    
    # Create users table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create stories table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS stories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            journey_id TEXT UNIQUE NOT NULL,
            user_folder_id TEXT NOT NULL,
            imaginary_world TEXT,
            title TEXT,
            story_background TEXT,
            progress INTEGER DEFAULT 0,
            total_events INTEGER DEFAULT 3,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    
    # Create indexes to speed up queries
    conn.execute('CREATE INDEX IF NOT EXISTS idx_stories_user_id ON stories(user_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_stories_journey_id ON stories(journey_id)')
    
    conn.commit()
    conn.close()
    
    print(f"✅ Database initialized: {DB_PATH}")


# ==========================================
# User Operations
# ==========================================

def create_user(username: str, password: str, display_name: str = None) -> Dict[str, Any]:
    """
    Create a new user.
    
    Args:
        username: Username (unique)
        password: Plain text password (will be hashed before storage)
        display_name: Display name (optional, defaults to username)
    
    Returns:
        {"success": True, "user_id": int} or {"success": False, "error": str}
    """
    conn = get_db()
    cursor = conn.cursor()
    
    # Hash the password
    password_hash = generate_password_hash(password)
    
    try:
        cursor.execute(
            "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)",
            (username, password_hash, display_name or username)
        )
        conn.commit()
        user_id = cursor.lastrowid
        print(f"✅ User created: {username} (ID: {user_id})")
        return {"success": True, "user_id": user_id}
    except sqlite3.IntegrityError:
        print(f"❌ Username already exists: {username}")
        return {"success": False, "error": "Username already exists"}
    finally:
        conn.close()


def verify_user(username: str, password: str) -> Dict[str, Any]:
    """
    Verify user login credentials.
    
    Args:
        username: Username
        password: Plain text password
    
    Returns:
        {"success": True, "user": {...}} or {"success": False, "error": str}
    """
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()
    conn.close()
    
    if user and check_password_hash(user["password_hash"], password):
        print(f"✅ User logged in: {username}")
        return {
            "success": True,
            "user": {
                "id": user["id"],
                "username": user["username"],
                "display_name": user["display_name"],
                "created_at": user["created_at"]
            }
        }
    
    print(f"❌ Login failed: {username}")
    return {"success": False, "error": "Invalid username or password"}


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    """
    Get user by ID.
    
    Args:
        user_id: User ID
    
    Returns:
        User info dict, or None if not found
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, username, display_name, created_at FROM users WHERE id = ?", 
        (user_id,)
    )
    user = cursor.fetchone()
    conn.close()
    
    if user:
        return {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "created_at": user["created_at"]
        }
    return None


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    """
    Get user by username.
    
    Args:
        username: Username
    
    Returns:
        User info dict, or None if not found
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, username, display_name, created_at FROM users WHERE username = ?", 
        (username,)
    )
    user = cursor.fetchone()
    conn.close()
    
    if user:
        return {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "created_at": user["created_at"]
        }
    return None


# ==========================================
# Story Operations
# ==========================================

def create_story(
    user_id: int, 
    journey_id: str, 
    user_folder_id: str, 
    imaginary_world: str, 
    title: str,
    story_background: str = ""
) -> int:
    """
    Create a new story record.
    
    Args:
        user_id: User ID
        journey_id: Story journey ID (UUID)
        user_folder_id: User folder ID (e.g., guest_260129_091022)
        imaginary_world: World type
        title: Story title
        story_background: Story background
    
    Returns:
        Newly created story ID
    """
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT INTO stories (user_id, journey_id, user_folder_id, imaginary_world, title, story_background)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (user_id, journey_id, user_folder_id, imaginary_world, title, story_background))
    
    conn.commit()
    story_id = cursor.lastrowid
    conn.close()
    
    print(f"✅ Story created: {title} (ID: {story_id}, Journey: {journey_id})")
    return story_id


def update_story_progress(journey_id: str, progress: int, title: str = None, story_background: str = None):
    """
    Update story progress.
    
    Args:
        journey_id: Story journey ID
        progress: Current progress (0-3)
        title: New title (optional)
        story_background: Story background (optional)
    """
    conn = get_db()
    cursor = conn.cursor()
    
    # Build update statement
    updates = ["progress = ?", "updated_at = ?"]
    params = [progress, datetime.now()]
    
    if title:
        updates.append("title = ?")
        params.append(title)
    
    if story_background:
        updates.append("story_background = ?")
        params.append(story_background)
    
    # Auto-update status
    updates.append("status = CASE WHEN ? >= total_events THEN 'completed' ELSE 'active' END")
    params.append(progress)
    
    params.append(journey_id)
    
    sql = f"UPDATE stories SET {', '.join(updates)} WHERE journey_id = ?"
    cursor.execute(sql, params)
    
    conn.commit()
    conn.close()
    
    print(f"✅ Story progress updated: {journey_id} -> {progress}")


def get_user_stories(user_id: int) -> List[Dict[str, Any]]:
    """
    Get all stories for a user.
    
    Args:
        user_id: User ID
    
    Returns:
        List of stories, sorted by updated_at descending
    """
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT * FROM stories WHERE user_id = ? ORDER BY updated_at DESC
    ''', (user_id,))
    
    stories = []
    for row in cursor.fetchall():
        stories.append({
            "id": row["id"],
            "user_id": row["user_id"],
            "journey_id": row["journey_id"],
            "user_folder_id": row["user_folder_id"],
            "imaginary_world": row["imaginary_world"],
            "title": row["title"],
            "story_background": row["story_background"],
            "progress": row["progress"],
            "total_events": row["total_events"],
            "status": row["status"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"]
        })
    
    conn.close()
    return stories


def get_story_by_journey_id(journey_id: str) -> Optional[Dict[str, Any]]:
    """
    Get story by journey_id.
    
    Args:
        journey_id: Story journey ID
    
    Returns:
        Story info dict, or None if not found
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM stories WHERE journey_id = ?", (journey_id,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {
            "id": row["id"],
            "user_id": row["user_id"],
            "journey_id": row["journey_id"],
            "user_folder_id": row["user_folder_id"],
            "imaginary_world": row["imaginary_world"],
            "title": row["title"],
            "story_background": row["story_background"],
            "progress": row["progress"],
            "total_events": row["total_events"],
            "status": row["status"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"]
        }
    return None


def delete_story(journey_id: str) -> bool:
    """
    Delete a story.
    
    Args:
        journey_id: Story journey ID
    
    Returns:
        True if deleted successfully, False if story not found
    """
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("DELETE FROM stories WHERE journey_id = ?", (journey_id,))
    deleted = cursor.rowcount > 0
    
    conn.commit()
    conn.close()
    
    if deleted:
        print(f"✅ Story deleted: {journey_id}")
    return deleted


# ==========================================
# Debug/Test Functions
# ==========================================

def get_all_users() -> List[Dict[str, Any]]:
    """Get all users (for debugging only)"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, display_name, created_at FROM users")
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return users


def get_db_stats() -> Dict[str, Any]:
    """Get database statistics"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM users")
    user_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM stories")
    story_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM stories WHERE status = 'completed'")
    completed_count = cursor.fetchone()[0]
    
    conn.close()
    
    return {
        "db_path": str(DB_PATH),
        "db_exists": DB_PATH.exists(),
        "user_count": user_count,
        "story_count": story_count,
        "completed_stories": completed_count,
        "active_stories": story_count - completed_count
    }


# ==========================================
# Module Initialization
# ==========================================

if __name__ == "__main__":
    # When running this file directly, initialize database and show stats
    print("Initializing database...")
    init_db()
    print("\nDatabase stats:")
    stats = get_db_stats()
    for key, value in stats.items():
        print(f"  {key}: {value}")
