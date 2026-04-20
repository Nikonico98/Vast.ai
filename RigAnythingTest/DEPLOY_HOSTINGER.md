# Deploy RigAnything Frontend to Hostinger VPS

## Architecture

```
User Browser
    │
    ▼
Hostinger VPS (nginx)          VastAI GPU Server
https://imaginary-test.         http://<VASTAI_IP>:7860
lockup.link/ImaginaryWorld/     └── server_simple.py (Flask)
└── static_simple/
    ├── index.html
    ├── style.css
    └── app.js
```

## Step 1: Get Your VastAI Backend URL

On the VastAI machine (this machine), run:
```bash
# Option A: Use ngrok (recommended)
cd /workspace && ./ngrok http 7860
# Copy the URL like: https://xxxx.ngrok-free.app

# Option B: Check VastAI direct port forwarding  
# Look in VastAI dashboard for the public IP and mapped port
```

Your backend URL will be something like:
- `https://xxxx.ngrok-free.app` (ngrok)
- `http://123.45.67.89:7860` (direct)

## Step 2: Configure Frontend

Edit `static_simple/index.html` — find the `<script>` before `app.js` and set your backend URL:

```html
<script>
    // Set this to your VastAI backend URL
    window.RIG_API_BASE = "https://xxxx.ngrok-free.app";
</script>
<script src="app.js"></script>
```

## Step 3: Upload Files to Hostinger VPS

Upload these 3 files to Hostinger:

```
static_simple/
├── index.html
├── style.css
└── app.js
```

### Via SSH:
```bash
# From your local machine
scp -i ~/.ssh/id_ed25519-imwodata -r \
  /path/to/static_simple/* \
  imwodata@srv1323865:/var/www/imaginary-test/ImaginaryWorld/
```

### Via Hostinger File Manager:
1. Login to Hostinger hPanel
2. Go to Files → File Manager
3. Navigate to `/public_html/ImaginaryWorld/` (or your configured webroot)
4. Upload `index.html`, `style.css`, `app.js`

## Step 4: Nginx Configuration (Hostinger VPS)

If you need to configure nginx manually, SSH into the Hostinger VPS:

```bash
ssh -i ~/.ssh/id_ed25519-imwodata imwodata@srv1323865
```

Create/edit the nginx config:

```nginx
server {
    listen 443 ssl;
    server_name imaginary-test.lockup.link;

    # SSL certs (adjust paths as needed)
    ssl_certificate /etc/letsencrypt/live/imaginary-test.lockup.link/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/imaginary-test.lockup.link/privkey.pem;

    # RigAnything frontend
    location /ImaginaryWorld/ {
        alias /var/www/imaginary-test/ImaginaryWorld/;
        index index.html;
        try_files $uri $uri/ /ImaginaryWorld/index.html;
    }
}
```

Reload nginx:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Step 5: Start the Backend

On the VastAI machine:
```bash
cd /workspace/RigAnythingTest

# Install flask-cors if not already installed
pip install flask-cors

# Start the server
python server_simple.py
```

Then start ngrok in another terminal:
```bash
cd /workspace && ./ngrok http 7860
```

## Step 6: Test

1. Open `https://imaginary-test.lockup.link/ImaginaryWorld/`
2. Upload a GLB/OBJ file
3. Click "Auto Rig" 
4. View skeleton + weight paint
5. Export & download rigged GLB

## Troubleshooting

**CORS errors in browser console:**
- Make sure `flask-cors` is installed and `CORS(app)` is in server_simple.py ✅ (already added)

**"Mixed Content" errors:**
- If Hostinger is HTTPS but backend is HTTP, use ngrok (provides HTTPS)
- Or set up an nginx reverse proxy on Hostinger to forward `/api/` to VastAI

**Ngrok URL changes on restart:**
- Free ngrok gives a new URL each time
- Update `window.RIG_API_BASE` in index.html when it changes
- Consider ngrok paid plan for a fixed subdomain
