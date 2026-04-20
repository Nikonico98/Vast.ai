"""
RigAnything Test — JSON Schema for ChatGPT Rigging Instructions
"""

# Schema for model info sent to ChatGPT
MODEL_INFO_SCHEMA = {
    "type": "object",
    "properties": {
        "num_joints": {"type": "integer"},
        "joints": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "position": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                    "parent": {"type": "integer"},
                    "children": {"type": "array", "items": {"type": "integer"}},
                    "depth": {"type": "integer"},
                },
            },
        },
        "bbox": {
            "type": "object",
            "properties": {
                "min": {"type": "array", "items": {"type": "number"}},
                "max": {"type": "array", "items": {"type": "number"}},
                "size": {"type": "array", "items": {"type": "number"}},
                "center": {"type": "array", "items": {"type": "number"}},
            },
        },
        "num_vertices": {"type": "integer"},
    },
}

# Schema for ChatGPT rigging instruction output
RIG_INSTRUCTION_SCHEMA = {
    "type": "object",
    "properties": {
        "merge_joints": {
            "type": "array",
            "description": "Groups of joint indices to merge into one",
            "items": {
                "type": "object",
                "properties": {
                    "indices": {"type": "array", "items": {"type": "integer"}, "minItems": 2},
                    "reason": {"type": "string"},
                },
                "required": ["indices"],
            },
        },
        "remove_joints": {
            "type": "array",
            "description": "Joint indices to remove entirely",
            "items": {"type": "integer"},
        },
        "move_joints": {
            "type": "array",
            "description": "Joints to reposition",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "position": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                    "reason": {"type": "string"},
                },
                "required": ["index", "position"],
            },
        },
        "skinning": {
            "type": "object",
            "description": "Skinning weight parameters to adjust",
            "properties": {
                "top_k": {"type": "integer", "minimum": 1, "maximum": 10},
                "threshold": {"type": "number", "minimum": 0, "maximum": 1},
                "smooth_iters": {"type": "integer", "minimum": 0, "maximum": 50},
                "neighbor_factor": {"type": "number", "minimum": 0, "maximum": 1},
            },
        },
        "bone_groups": {
            "type": "array",
            "description": "Semantic grouping of bones for user understanding",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "joints": {"type": "array", "items": {"type": "integer"}},
                    "role": {"type": "string"},
                },
                "required": ["name", "joints"],
            },
        },
        "explanation": {
            "type": "string",
            "description": "Human-readable explanation of what was changed and why",
        },
    },
    "required": ["explanation"],
}

# System prompt for ChatGPT
SYSTEM_PROMPT = """You are a professional 3D rigging expert. You analyze 3D mesh geometry and skeleton data, then produce precise rigging adjustment instructions based on user requests.

## Your capabilities:
- Analyze joint positions, hierarchy, and distribution
- Identify semantic body parts from geometry (trunk, limbs, head, tail, wings, etc.)
- Suggest merging redundant joints that are too close together
- Suggest removing unnecessary joints
- Adjust joint positions for better deformation
- Tune skinning weight parameters (top_k, threshold, smoothing)
- Group bones semantically for the user's understanding

## Rules:
1. Always output valid JSON matching the instruction schema
2. Joint indices must reference existing joints (0 to num_joints-1)
3. Never remove the root joint (index 0)
4. When merging joints, children of removed joints reconnect to the surviving joint
5. Position values are in normalized space [-1, 1]
6. Be conservative — small adjustments are better than drastic changes
7. Always provide a clear explanation in the user's language

## Input you receive:
- Model info: joint positions, parent hierarchy, bounding box, vertex count
- User's request in natural language (may be in any language — respond in the same language)
- Previous conversation history for iterative refinement

## Output format (strict JSON):
{
  "merge_joints": [{"indices": [3, 4], "reason": "..."}],
  "remove_joints": [5],
  "move_joints": [{"index": 2, "position": [0.1, 0.5, 0.0], "reason": "..."}],
  "skinning": {"top_k": 5, "threshold": 0.068, "smooth_iters": 10, "neighbor_factor": 0.35},
  "bone_groups": [{"name": "spine", "joints": [0,1,2], "role": "main body support"}],
  "explanation": "..."
}

Only include fields that need changes. Omit fields that should stay as-is."""
