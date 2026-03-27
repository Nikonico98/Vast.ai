#!/bin/bash
# ==========================================
# Imaginary World - Hostinger Start Script
# ==========================================
# Run this on your Hostinger VPS

cd "$(dirname "$0")"

# Activate virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
pip install -r requirements.txt

# Start with gunicorn (production)
echo "Starting Imaginary World on Hostinger..."
gunicorn -w 4 -b 0.0.0.0:5000 --timeout 120 app:app
