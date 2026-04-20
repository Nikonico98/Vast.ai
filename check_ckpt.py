import os
d = "/workspace/sam-3d-objects/checkpoints/hf"
for f in sorted(os.listdir(d)):
    p = os.path.join(d, f)
    sz = os.path.getsize(p)
    if sz > 1e9:
        print(f"  {sz/1e9:.2f} GB  {f}")
    elif sz > 1e6:
        print(f"  {sz/1e6:.1f} MB  {f}")
    else:
        print(f"  {sz/1e3:.1f} KB  {f}")
print(f"\nTotal: {sum(os.path.getsize(os.path.join(d,f)) for f in os.listdir(d))/1e9:.2f} GB")
