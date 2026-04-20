#!/bin/bash
set -e

echo "============================================"
echo "  SAM3 + SAM3D + RigAnything Pipeline Test"
echo "============================================"

# Step 0: Create ckpt symlink if missing
if [ ! -d "/workspace/IW/RigAnything/ckpt" ]; then
    echo "[0] Creating RigAnything ckpt symlink..."
    ln -sf /workspace/RigAnything/ckpt /workspace/IW/RigAnything/ckpt
fi

if [ -f "/workspace/IW/RigAnything/ckpt/riganything_ckpt.pt" ]; then
    echo "[0] ✅ RigAnything checkpoint found"
else
    echo "[0] ❌ RigAnything checkpoint MISSING!"
    exit 1
fi

# Step 1: Check GPU service
echo ""
echo "[1] Checking GPU service health..."
HEALTH=$(curl -s --max-time 5 http://localhost:9090/api/gpu/health 2>/dev/null || echo "FAILED")
echo "    Health: $HEALTH"

if echo "$HEALTH" | grep -q "FAILED"; then
    echo "[1] ❌ GPU service not running on port 9090"
    echo "    Trying port 5555..."
    HEALTH=$(curl -s --max-time 5 http://localhost:5555/api/gpu/health 2>/dev/null || echo "FAILED")
    echo "    Health: $HEALTH"
    if echo "$HEALTH" | grep -q "FAILED"; then
        echo "[1] ❌ GPU service not running. Please start it first."
        exit 1
    fi
    PORT=5555
else
    PORT=9090
fi
echo "[1] ✅ GPU service running on port $PORT"

# Step 2: Find a test image
TEST_IMG=""
if [ -f "/workspace/gpu_data/temp/test_rig_fictional_0/photos/test_rig_fictional_0_input.jpg" ]; then
    TEST_IMG="/workspace/gpu_data/temp/test_rig_fictional_0/photos/test_rig_fictional_0_input.jpg"
elif ls /workspace/data/uploads/*.png 2>/dev/null | head -1 > /dev/null; then
    TEST_IMG=$(ls /workspace/data/uploads/*.png 2>/dev/null | head -1)
elif ls /workspace/data/uploads/*.jpg 2>/dev/null | head -1 > /dev/null; then
    TEST_IMG=$(ls /workspace/data/uploads/*.jpg 2>/dev/null | head -1)
else
    # Use SAM3D example image
    TEST_IMG=$(find /workspace/sam-3d-objects/doc/ -name "*.png" | head -1)
fi

if [ -z "$TEST_IMG" ]; then
    echo "[2] ❌ No test image found"
    exit 1
fi
echo "[2] ✅ Test image: $TEST_IMG"

# Step 3: Submit job
JOB_ID="test_rig_$(date +%Y%m%d_%H%M%S)"
echo ""
echo "[3] Submitting pipeline job: $JOB_ID"
RESPONSE=$(curl -s -X POST "http://localhost:$PORT/api/gpu/process" \
    -F "image=@$TEST_IMG" \
    -F "prompt=an object" \
    -F "job_id=$JOB_ID")
echo "    Response: $RESPONSE"

if echo "$RESPONSE" | grep -q "error"; then
    echo "[3] ❌ Job submission failed"
    exit 1
fi
echo "[3] ✅ Job submitted"

# Step 4: Poll for completion
echo ""
echo "[4] Monitoring progress..."
for i in $(seq 1 120); do
    sleep 10
    STATUS=$(curl -s --max-time 5 "http://localhost:$PORT/api/gpu/status/$JOB_ID" 2>/dev/null)
    PROGRESS=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('status','?')} - {d.get('message','?')} - {d.get('progress',0)}%\")" 2>/dev/null || echo "parse error")
    echo "    [$(date +%H:%M:%S)] $PROGRESS"
    
    if echo "$STATUS" | grep -q '"completed"'; then
        echo "[4] ✅ Pipeline completed!"
        break
    fi
    if echo "$STATUS" | grep -q '"failed"'; then
        echo "[4] ❌ Pipeline failed!"
        echo "    $STATUS"
        exit 1
    fi
done

# Step 5: Check output
echo ""
echo "[5] Checking output..."
GLB_PATH=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('files',{}).get('glb',''))" 2>/dev/null || echo "")
if [ -n "$GLB_PATH" ] && [ -f "$GLB_PATH" ]; then
    SIZE=$(stat -c%s "$GLB_PATH")
    echo "    GLB file: $GLB_PATH"
    echo "    GLB size: $SIZE bytes"
    
    # Check if GLB contains rig/skeleton data (armature/skin)
    if python3 -c "
import sys
data = open('$GLB_PATH', 'rb').read()
has_skin = b'\"skins\"' in data or b'skins' in data
has_joints = b'\"joints\"' in data or b'joints' in data
print(f'    Has skins: {has_skin}')
print(f'    Has joints: {has_joints}')
if has_skin or has_joints:
    print('[5] ✅ GLB contains rigging data!')
else:
    print('[5] ⚠️ GLB does NOT contain rigging data')
"; then
        true
    fi
else
    echo "[5] ❌ GLB file not found: $GLB_PATH"
fi

echo ""
echo "============================================"
echo "  Test Complete"
echo "============================================"
