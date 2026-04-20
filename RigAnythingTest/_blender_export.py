"""
_blender_export.py — 在 Blender Python 環境中執行的 GLB 匯出腳本。
由 export_glb.py 透過 subprocess 呼叫，不應直接執行。

邏輯取自 RigAnything/inference_utils/vis_skel.py，簡化為：
  1. 讀取 NPZ（joints, parents, skinning_weights, mesh_list）
  2. 匯入原始 mesh GLB
  3. 建立 Armature + Bones
  4. 指定 Vertex Groups + Skinning Weights
  5. 匯出 rigged GLB
"""

import argparse
import numpy as np
import bpy
from mathutils import Vector


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)


def setup_view_layers():
    skeleton_collection = bpy.data.collections.new("Skeleton_Collection")
    mesh_collection = bpy.data.collections.new("Mesh_Collection")
    bpy.context.scene.collection.children.link(skeleton_collection)
    bpy.context.scene.collection.children.link(mesh_collection)

    skeleton_layer = bpy.context.scene.view_layers.new("Skeleton")
    mesh_layer = bpy.context.scene.view_layers.new("Mesh")

    skeleton_layer.layer_collection.children["Skeleton_Collection"].exclude = False
    skeleton_layer.layer_collection.children["Mesh_Collection"].exclude = True
    mesh_layer.layer_collection.children["Skeleton_Collection"].exclude = True
    mesh_layer.layer_collection.children["Mesh_Collection"].exclude = False

    return skeleton_collection, mesh_collection


def create_armature(joint_positions, parents):
    """建立 Armature 和 Bones"""
    # 清除舊 armature
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.armature.select_all(action="SELECT")
            bpy.ops.armature.delete()
            bpy.ops.object.mode_set(mode="OBJECT")

    # 找到或建立 armature
    armature_obj = None
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            armature_obj = obj
            break

    if armature_obj is None:
        armature_data = bpy.data.armatures.new("armature")
        armature_obj = bpy.data.objects.new("armature", armature_data)
        bpy.context.scene.collection.objects.link(armature_obj)

    bpy.context.view_layer.objects.active = armature_obj
    bpy.ops.object.mode_set(mode="EDIT")

    bone_w2l = armature_obj.matrix_world.inverted()
    edit_bones = armature_obj.data.edit_bones

    num_joints = len(joint_positions)
    for i in range(num_joints):
        pos = joint_positions[i]
        bone = edit_bones.new(f"Bone_{i}")
        bone.head = bone_w2l @ Vector(pos[:3].tolist())
        bone.tail = bone.head + Vector([0, 0, 0.1])

        if parents[i] == i and i > 0:  # non-existent joint
            continue
        if i > 0:
            parent_bone = edit_bones.get(f"Bone_{int(parents[i])}")
            if parent_bone:
                bone.parent = parent_bone
                parent_bone.tail = bone.head

    bpy.ops.object.mode_set(mode="OBJECT")
    return armature_obj


def assign_weights(armature_obj, skinning_weights, mesh_obj_name_list):
    """將 skinning weights 分配給 mesh 的 vertex groups"""
    cur_idx = 0
    mesh_obj_list = []

    for obj_name in mesh_obj_name_list:
        obj = bpy.data.objects[obj_name]

        # 清除舊的 armature modifier 和 vertex groups
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
        for group in list(obj.vertex_groups):
            obj.vertex_groups.remove(group)

        mesh_obj_list.append(obj)
        n_verts = len(obj.data.vertices)
        weights_cur = skinning_weights[cur_idx: cur_idx + n_verts]

        # 加 Armature modifier
        modifier = obj.modifiers.new(name="Armature", type="ARMATURE")
        modifier.object = armature_obj

        # 建立 vertex groups 並分配 weights
        for bone in armature_obj.data.bones:
            bone_idx = int(bone.name.split("_")[-1])
            group = obj.vertex_groups.new(name=bone.name)
            for j in range(n_verts):
                w = float(weights_cur[j, bone_idx])
                if w > 1e-6:
                    group.add([j], w, "REPLACE")

        cur_idx += n_verts

    return mesh_obj_list


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--npz_path", type=str, required=True)
    parser.add_argument("--mesh_path", type=str, required=True)
    parser.add_argument("--output_path", type=str, required=True)
    args = parser.parse_args()

    # 讀取 NPZ
    data = np.load(args.npz_path, allow_pickle=True)
    joint_positions = data["joints"][..., :3]
    parents = data["parents"]
    skinning_weights = data["skinning_weights"]
    mesh_list = sorted(data["mesh_list"].tolist()) if "mesh_list" in data else []

    # Normalize weights
    row_sums = skinning_weights.sum(axis=1, keepdims=True) + 1e-6
    skinning_weights = skinning_weights / row_sums

    # 座標轉換 (Y-up to Z-up: [x, z, -y])
    rot = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]])
    joint_positions = np.dot(joint_positions, rot)

    # 清除場景
    clear_scene()

    # 設定 view layers
    setup_view_layers()

    # 匯入原始 mesh
    bpy.ops.import_scene.gltf(filepath=args.mesh_path)

    # 清除舊動畫
    for obj in bpy.data.objects:
        if obj.animation_data:
            obj.animation_data_clear()

    # 建立 Armature
    armature = create_armature(joint_positions, parents)

    # 決定 mesh object 名稱
    if not mesh_list:
        mesh_list = [obj.name for obj in bpy.data.objects if obj.type == "MESH"]
    mesh_list = sorted(mesh_list)

    # 分配 weights
    mesh_objs = assign_weights(armature, skinning_weights, mesh_list)

    # 匯出 GLB
    if "Mesh" in bpy.context.scene.view_layers:
        bpy.context.window.view_layer = bpy.context.scene.view_layers["Mesh"]

    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objs:
        obj.select_set(True)
    armature.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=args.output_path,
        export_format="GLB",
        export_materials="EXPORT",
    )

    print(f"Successfully exported rigged GLB to: {args.output_path}")


if __name__ == "__main__":
    main()
