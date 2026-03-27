"""
Hostinger Shared Hosting - WSGI Entry Point
============================================
Hostinger uses Passenger to run Python apps.
This file is the entry point for the Flask app.
"""

import sys
import os

# Add the backend directory to Python path
INTERP = os.path.join(os.environ['HOME'], 'imaginary-world', 'backend', 'venv', 'bin', 'python3')
if sys.executable != INTERP:
    os.execl(INTERP, INTERP, *sys.argv)

# Add backend folder to path so imports work
sys.path.insert(0, os.path.dirname(__file__))

# Initialize DB before first request
from database import init_db
init_db()

# Import the Flask app
from app import app as application
