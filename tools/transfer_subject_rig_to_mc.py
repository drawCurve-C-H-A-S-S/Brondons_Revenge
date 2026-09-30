"""Transfer the Subject.glb armature and actions onto the meshes in MC.glb.

Run this file from Blender's Scripting workspace with the Blender Python API.
The source and target GLBs are imported into a temporary scene and the result
is written as MC_rigged.glb. The original files are not modified.
"""

from pathlib import Path

import bpy


PROJECT_ROOT = Path(r"C:\Users\Admin\OneDrive\Desktop\WITS\2026\CGV\Project\Brondons Revenge")
MODEL_DIR = PROJECT_ROOT / "src" / "assets" / "models"
SOURCE_FILE = MODEL_DIR / "Subject.glb"
TARGET_FILE = MODEL_DIR / "MC.glb"
OUTPUT_FILE = MODEL_DIR / "MC_rigged.glb"


def imported_objects(importer):
    before = set(bpy.data.objects)
    importer()
    return [obj for obj in bpy.data.objects if obj not in before]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.armatures, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def transfer_weights(source_mesh, target_mesh):
    modifier = target_mesh.modifiers.new("Subject weights", "DATA_TRANSFER")
    modifier.object = source_mesh
    modifier.use_vert_data = True
    modifier.data_types_verts = {"VGROUP_WEIGHTS"}
    modifier.vert_mapping = "POLYINTERP_NEAREST"
    modifier.layers_vgroup_select_src = "ALL"
    modifier.layers_vgroup_select_dst = "NAME"
    modifier.mix_mode = "REPLACE"

    bpy.context.view_layer.objects.active = target_mesh
    target_mesh.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    target_mesh.select_set(False)


def main():
    if not SOURCE_FILE.exists():
        raise FileNotFoundError(SOURCE_FILE)
    if not TARGET_FILE.exists():
        raise FileNotFoundError(TARGET_FILE)

    clear_scene()

    source_objects = imported_objects(
        lambda: bpy.ops.import_scene.gltf(filepath=str(SOURCE_FILE))
    )
    source_armature = next(obj for obj in source_objects if obj.type == "ARMATURE")
    source_mesh = next(obj for obj in source_objects if obj.type == "MESH")
    source_actions = [action for action in bpy.data.actions if action.users]

    target_objects = imported_objects(
        lambda: bpy.ops.import_scene.gltf(filepath=str(TARGET_FILE))
    )
    target_meshes = [obj for obj in target_objects if obj.type == "MESH"]
    if not target_meshes:
        raise RuntimeError("MC.glb did not contain any mesh objects")

    for target_mesh in target_meshes:
        transfer_weights(source_mesh, target_mesh)

        armature_modifier = target_mesh.modifiers.new("Subject armature", "ARMATURE")
        armature_modifier.object = source_armature

        world_transform = target_mesh.matrix_world.copy()
        target_mesh.parent = source_armature
        target_mesh.matrix_world = world_transform

        if target_mesh.animation_data:
            target_mesh.animation_data_clear()

    source_mesh.hide_render = True
    source_mesh.hide_viewport = True
    source_mesh.hide_set(True)
    bpy.data.objects.remove(source_mesh, do_unlink=True)

    for obj in list(source_objects):
        if obj != source_armature and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    source_armature.select_set(True)
    for target_mesh in target_meshes:
        target_mesh.select_set(True)
    bpy.context.view_layer.objects.active = source_armature

    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT_FILE),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_nla_strips=False,
        export_skins=True,
        export_all_influences=True,
    )

    print(f"Created {OUTPUT_FILE}")
    print(f"Transferred weights to {len(target_meshes)} MC meshes")
    print(f"Available Subject actions: {len(source_actions)}")


if __name__ == "__main__":
    main()