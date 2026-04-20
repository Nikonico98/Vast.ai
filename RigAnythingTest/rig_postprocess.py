"""
RigAnything Test — Skeleton Post-Processor

Operates on RigAnything NPZ output to adjust joints, weights, and skinning.
NPZ format: joints[N,3], parents[N], skinning_weights[V,N], pointcloud[V,3]
"""

import copy
import numpy as np
import trimesh


def load_npz(path):
    """Load RigAnything NPZ and return a mutable dict."""
    data = dict(np.load(path, allow_pickle=True))
    return data


def save_npz(path, data):
    """Save modified rig data back to NPZ."""
    np.savez(path, **data)


def get_skeleton_info(data):
    """Extract skeleton summary for ChatGPT or UI display."""
    joints = data["joints"]  # [N, 3]
    parents = data["parents"]  # [N]
    n = len(joints)

    # Build children map and depth
    children = {i: [] for i in range(n)}
    depth = np.zeros(n, dtype=int)
    for i in range(n):
        p = int(parents[i])
        if p != i:
            children[p].append(i)

    # Compute depth via BFS
    visited = set()
    queue = []
    for i in range(n):
        if int(parents[i]) == i:  # root
            queue.append((i, 0))
    while queue:
        idx, d = queue.pop(0)
        if idx in visited:
            continue
        visited.add(idx)
        depth[idx] = d
        for c in children[idx]:
            queue.append((c, d + 1))

    # Bounding box from pointcloud
    pts = data.get("pointcloud", joints)
    bbox_min = pts.min(axis=0).tolist()
    bbox_max = pts.max(axis=0).tolist()
    bbox_size = (pts.max(axis=0) - pts.min(axis=0)).tolist()
    bbox_center = ((pts.max(axis=0) + pts.min(axis=0)) / 2).tolist()

    joint_list = []
    for i in range(n):
        joint_list.append({
            "index": i,
            "position": joints[i].tolist(),
            "parent": int(parents[i]),
            "children": children[i],
            "depth": int(depth[i]),
        })

    return {
        "num_joints": n,
        "joints": joint_list,
        "bbox": {
            "min": bbox_min,
            "max": bbox_max,
            "size": bbox_size,
            "center": bbox_center,
        },
        "num_vertices": len(pts),
    }


def merge_close_joints(data, threshold=0.05):
    """Merge joints that are closer than threshold distance.

    For each pair of close joints, keep the parent and transfer
    the child's weights to the parent.
    """
    joints = data["joints"].copy()
    parents = data["parents"].copy()
    weights = data["skinning_weights"].copy()
    n = len(joints)

    # Find pairs to merge (child → parent)
    merge_map = {}  # child_idx → parent_idx (the one to keep)
    for i in range(n):
        p = int(parents[i])
        if p == i:
            continue
        dist = np.linalg.norm(joints[i] - joints[p])
        if dist < threshold:
            merge_map[i] = p

    if not merge_map:
        return data

    return _apply_merge(data, merge_map)


def merge_joint_groups(data, groups):
    """Merge specific groups of joints. Each group keeps the first index."""
    merge_map = {}
    for group in groups:
        keep = group[0]
        for idx in group[1:]:
            merge_map[idx] = keep
    if not merge_map:
        return data
    return _apply_merge(data, merge_map)


def _apply_merge(data, merge_map):
    """Apply a merge_map {removed_idx: keep_idx} to joints/parents/weights."""
    joints = data["joints"].copy()
    parents = data["parents"].copy()
    weights = data["skinning_weights"].copy()
    n = len(joints)

    # Resolve transitive merges (a→b, b→c becomes a→c)
    def resolve(idx):
        visited = set()
        while idx in merge_map and idx not in visited:
            visited.add(idx)
            idx = merge_map[idx]
        return idx

    for k in list(merge_map.keys()):
        merge_map[k] = resolve(k)

    removed = set(merge_map.keys())

    # Transfer weights: add removed joint's weight column to keep joint's column
    for rm_idx, keep_idx in merge_map.items():
        weights[:, keep_idx] += weights[:, rm_idx]

    # Build index remapping
    keep_indices = [i for i in range(n) if i not in removed]
    old_to_new = {old: new for new, old in enumerate(keep_indices)}

    # Remap
    new_joints = joints[keep_indices]
    new_weights = weights[:, keep_indices]
    new_parents = np.zeros(len(keep_indices), dtype=parents.dtype)
    for new_i, old_i in enumerate(keep_indices):
        old_p = int(parents[old_i])
        # Resolve parent through merge map
        while old_p in merge_map:
            old_p = merge_map[old_p]
        new_parents[new_i] = old_to_new.get(old_p, new_i)

    # Renormalize weights
    row_sums = new_weights.sum(axis=1, keepdims=True)
    row_sums = np.maximum(row_sums, 1e-8)
    new_weights = new_weights / row_sums

    result = copy.deepcopy(data)
    result["joints"] = new_joints
    result["parents"] = new_parents
    result["skinning_weights"] = new_weights
    return result


def remove_joints(data, indices_to_remove):
    """Remove specific joints. Children reconnect to their grandparent."""
    if not indices_to_remove:
        return data

    joints = data["joints"].copy()
    parents = data["parents"].copy()
    weights = data["skinning_weights"].copy()
    n = len(joints)

    remove_set = set(indices_to_remove)
    # Don't remove root
    for i in list(remove_set):
        if int(parents[i]) == i:
            remove_set.discard(i)

    if not remove_set:
        return data

    # Reconnect children: if parent is being removed, find nearest surviving ancestor
    def find_surviving_parent(idx):
        visited = set()
        while idx in remove_set and idx not in visited:
            visited.add(idx)
            idx = int(parents[idx])
        return idx

    # Build merge map: removed → surviving parent (for weight transfer)
    merge_map = {}
    for idx in remove_set:
        merge_map[idx] = find_surviving_parent(idx)

    return _apply_merge(data, merge_map)


def adjust_joint_position(data, joint_idx, new_position):
    """Move a joint to a new position."""
    data = copy.deepcopy(data)
    data["joints"][joint_idx] = np.array(new_position, dtype=np.float32)
    return data


def adjust_skinning(data, mesh=None, top_k=5, threshold=0.068,
                    smooth_iters=10, neighbor_factor=0.35):
    """Recompute skinning weight normalization with new parameters.

    This re-applies the Top-K selection, thresholding, normalization,
    and optional Laplacian smoothing.
    """
    import torch
    import torch.nn.functional as F

    weights = data["skinning_weights"].copy()  # [V, J]

    # Top-K selection
    w_tensor = torch.from_numpy(weights).float()
    k = min(top_k, w_tensor.shape[1])
    _, indices = torch.topk(w_tensor, k=k, dim=1)
    masked = torch.ones_like(w_tensor) * -9999
    masked.scatter_(1, indices, w_tensor.gather(1, indices))
    w_tensor = F.softmax(masked, dim=1)

    # Threshold
    w_tensor[w_tensor < threshold] = 0

    # Renormalize
    w_tensor = w_tensor / (w_tensor.sum(dim=1, keepdim=True) + 1e-6)
    weights = w_tensor.numpy()

    # Laplacian smoothing
    if smooth_iters > 0 and mesh is not None:
        weights = _smooth_weights(mesh, weights, smooth_iters, neighbor_factor)

    data = copy.deepcopy(data)
    data["skinning_weights"] = weights
    return data


def _smooth_weights(mesh, weights, iterations, neighbor_factor):
    """Laplacian smoothing of skinning weights using mesh adjacency."""
    smoothed = weights.copy()
    vertex_neighbors = mesh.vertex_neighbors

    for _ in range(iterations):
        new_weights = smoothed.copy()
        for i in range(len(mesh.vertices)):
            neighbors = vertex_neighbors[i]
            if len(neighbors) > 0:
                neighbor_avg = np.mean(smoothed[neighbors], axis=0)
                new_weights[i] = (1.0 - neighbor_factor) * smoothed[i] + neighbor_factor * neighbor_avg
                s = np.sum(new_weights[i])
                if s > 0:
                    new_weights[i] /= s
        smoothed = new_weights

    return smoothed


def limit_joint_count(data, max_joints):
    """Reduce joint count by merging least important joints.

    Importance = total skinning weight assigned to that joint.
    Merges the least important joint into its parent, repeating
    until joint count <= max_joints.
    """
    while len(data["joints"]) > max_joints:
        weights = data["skinning_weights"]
        parents = data["parents"]
        n = len(data["joints"])

        # Compute importance per joint
        importance = weights.sum(axis=0)  # [J]

        # Find least important non-root joint
        min_imp = float("inf")
        min_idx = -1
        for i in range(n):
            if int(parents[i]) == i:
                continue  # skip root
            if importance[i] < min_imp:
                min_imp = importance[i]
                min_idx = i

        if min_idx < 0:
            break

        data = remove_joints(data, [min_idx])

    return data


def apply_instructions(data, instructions, mesh=None):
    """Apply a ChatGPT-generated instruction dict to rig data.

    Args:
        data: NPZ dict with joints, parents, skinning_weights, pointcloud
        instructions: dict matching RIG_INSTRUCTION_SCHEMA
        mesh: optional trimesh.Trimesh for smoothing

    Returns:
        Modified data dict
    """
    result = copy.deepcopy(data)

    # 1. Merge joints
    merge_groups = instructions.get("merge_joints", [])
    if merge_groups:
        groups = [g["indices"] for g in merge_groups]
        result = merge_joint_groups(result, groups)

    # 2. Remove joints
    remove_list = instructions.get("remove_joints", [])
    if remove_list:
        # Remap indices after merge (approximate — indices may have shifted)
        result = remove_joints(result, remove_list)

    # 3. Move joints
    for move in instructions.get("move_joints", []):
        idx = move["index"]
        pos = move["position"]
        if 0 <= idx < len(result["joints"]):
            result = adjust_joint_position(result, idx, pos)

    # 4. Adjust skinning parameters
    skin_params = instructions.get("skinning", {})
    if skin_params:
        result = adjust_skinning(
            result,
            mesh=mesh,
            top_k=skin_params.get("top_k", 5),
            threshold=skin_params.get("threshold", 0.068),
            smooth_iters=skin_params.get("smooth_iters", 10),
            neighbor_factor=skin_params.get("neighbor_factor", 0.35),
        )

    return result
