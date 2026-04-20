"""
test_rig.py — CLI 測試腳本
可直接對 NPZ 進行 post-processing 測試，不需啟動伺服器。
"""

import sys
import json
import argparse
import numpy as np

sys.path.insert(0, ".")
from rig_postprocess import (
    load_npz, save_npz, get_skeleton_info,
    merge_close_joints, remove_joints, adjust_joint_position,
    limit_joint_count, apply_instructions,
)


def main():
    parser = argparse.ArgumentParser(description="RigAnything Test CLI")
    sub = parser.add_subparsers(dest="command")

    # info
    p_info = sub.add_parser("info", help="顯示 NPZ 骨骼資訊")
    p_info.add_argument("npz", help="NPZ 檔案路徑")

    # merge
    p_merge = sub.add_parser("merge", help="合併過近的關節")
    p_merge.add_argument("npz", help="NPZ 檔案路徑")
    p_merge.add_argument("--threshold", type=float, default=0.05)
    p_merge.add_argument("-o", "--output", required=True)

    # limit
    p_limit = sub.add_parser("limit", help="限制關節數量")
    p_limit.add_argument("npz", help="NPZ 檔案路徑")
    p_limit.add_argument("--max-joints", type=int, required=True)
    p_limit.add_argument("-o", "--output", required=True)

    # remove
    p_remove = sub.add_parser("remove", help="移除指定關節")
    p_remove.add_argument("npz", help="NPZ 檔案路徑")
    p_remove.add_argument("--indices", type=int, nargs="+", required=True)
    p_remove.add_argument("-o", "--output", required=True)

    # apply
    p_apply = sub.add_parser("apply", help="套用 JSON 指令")
    p_apply.add_argument("npz", help="NPZ 檔案路徑")
    p_apply.add_argument("--instructions", required=True, help="JSON 指令檔案路徑")
    p_apply.add_argument("-o", "--output", required=True)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return

    if args.command == "info":
        data = load_npz(args.npz)
        info = get_skeleton_info(data)
        print(json.dumps(info, indent=2, ensure_ascii=False))

    elif args.command == "merge":
        data = load_npz(args.npz)
        before = len(data["joints"])
        merge_close_joints(data, args.threshold)
        after = len(data["joints"])
        save_npz(args.output, data)
        print(f"Merged: {before} → {after} joints. Saved to {args.output}")

    elif args.command == "limit":
        data = load_npz(args.npz)
        limit_joint_count(data, args.max_joints)
        save_npz(args.output, data)
        print(f"Limited to {len(data['joints'])} joints. Saved to {args.output}")

    elif args.command == "remove":
        data = load_npz(args.npz)
        remove_joints(data, args.indices)
        save_npz(args.output, data)
        print(f"Removed joints {args.indices}. Now {len(data['joints'])} joints. Saved to {args.output}")

    elif args.command == "apply":
        data = load_npz(args.npz)
        with open(args.instructions) as f:
            instructions = json.load(f)
        apply_instructions(data, instructions)
        save_npz(args.output, data)
        print(f"Applied instructions. Now {len(data['joints'])} joints. Saved to {args.output}")


if __name__ == "__main__":
    main()
