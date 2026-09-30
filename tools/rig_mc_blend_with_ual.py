"""Put the UAL1_Standard.glb rig and animations onto the character in MC.blend.

Run this from Blender's Scripting workspace. The script uses MC.blend as the
destination scene, imports the UAL GLB, matches overall height and ground
position, transfers weights, and writes new editable and GLB outputs.
"""

from pathlib import Path

import bpy
from mathutils import Vector


PROJECT_ROOT = Path(r"C:\Users\Admin\OneDrive\Desktop\WITS\2026\CGV\Project\Brondons Revenge")
RAW_DIR = PROJECT_ROOT / "raw blend"
UAL_FILE = RAW_DIR / "UAL1_Standard.glb"
MC_FILE = RAW_DIR / "MC.blend"
OUTPUT_BLEND = RAW_DIR / "MC_with_UAL_rig.blend"
OUTPUT_GLB = RAW_DIR / "MC_with_UAL_rig.glb"

# Leave empty to use every visible mesh in MC.blend. Set names here when the
# file contains props or other meshes that should not receive the character rig.
TARGET_MESH_NAMES = []


def world_bounds(objects):
    corners = []
    for obj in objects:
        corners.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not corners:
        raise RuntimeError("No geometry was found for bounding-box alignment")
    minimum = corners[0].copy()
    maximum = corners[0].copy()
    for corner in corners[1:]:
        minimum.x = min(minimum.x, corner.x)
        minimum.y = min(minimum.y, corner.y)
        minimum.z = min(minimum.z, corner.z)
        maximum.x = max(maximum.x, corner.x)
        maximum.y = max(maximum.y, corner.y)
        maximum.z = max(maximum.z, corner.z)
    return minimum, maximum


def bounds_center(minimum, maximum):
    return (minimum + maximum) * 0.5


def imported_objects():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(UAL_FILE))
    return [obj for obj in bpy.data.objects if obj not in before]


def choose_target_meshes():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not obj.hide_viewport]
    if TARGET_MESH_NAMES:
        meshes = [obj for obj in meshes if obj.name in TARGET_MESH_NAMES]
    if not meshes:
        raise RuntimeError("No target meshes found in MC.blend")
    return meshes


def transfer_weights(source_mesh, target_mesh):
    modifier = target_mesh.modifiers.new("UAL weights", "DATA_TRANSFER")
    modifier.object = source_mesh
    modifier.use_vert_data = True
    modifier.data_types_verts = {"VGROUP_WEIGHTS"}
    modifier.vert_mapping = "POLYINTERP_NEAREST"
    modifier.layers_vgroup_select_src = "ALL"
    modifier.layers_vgroup_select_dst = "NAME"
    modifier.mix_mode = "REPLACE"

    bpy.ops.object.select_all(action="DESELECT")
    target_mesh.select_set(True)
    bpy.context.view_layer.objects.active = target_mesh
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    target_mesh.select_set(False)


def main():
    if not UAL_FILE.exists():
        raise FileNotFoundError(UAL_FILE)
    if not MC_FILE.exists():
        raise FileNotFoundError(MC_FILE)

    if Path(bpy.data.filepath).resolve() != MC_FILE.resolve():
        bpy.ops.wm.open_mainfile(filepath=str(MC_FILE))

    target_meshes = choose_target_meshes()
    target_min, target_max = world_bounds(target_meshes)
    target_height = target_max.z - target_min.z
    if target_height <= 0:
        raise RuntimeError("Target character has no measurable height")

    source_objects = imported_objects()
    source_armature = next(obj for obj in source_objects if obj.type == "ARMATURE")
    source_mesh = next(obj for obj in source_objects if obj.type == "MESH")

    source_min, source_max = world_bounds([source_mesh])
    source_height = source_max.z - source_min.z
    if source_height <= 0:
        raise RuntimeError("UAL mesh has no measurable height")

    # Parent imported UAL objects under a temporary root so the complete rig
    # can be scaled and translated without changing its bone names or actions.
    root = bpy.data.objects.new("UAL alignment root", None)
    bpy.context.scene.collection.objects.link(root)
    for obj in (source_armature, source_mesh):
        world_transform = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world_transform

    scale = target_height / source_height
    root.scale = (scale, scale, scale)
    bpy.context.view_layer.update()

    source_min, source_max = world_bounds([source_mesh])
    source_center = bounds_center(source_min, source_max)
    target_center = bounds_center(target_min, target_max)
    root.location += target_center - source_center
    bpy.context.view_layer.update()

    for target_mesh in target_meshes:
        transfer_weights(source_mesh, target_mesh)
        armature_modifier = target_mesh.modifiers.new("UAL armature", "ARMATURE")
        armature_modifier.object = source_armature

        world_transform = target_mesh.matrix_world.copy()
        target_mesh.parent = source_armature
        target_mesh.matrix_world = world_transform
        if target_mesh.animation_data:
            target_mesh.animation_data_clear()

    # Remove the source render mesh while preserving its actions on the armature.
    bpy.data.objects.remove(source_mesh, do_unlink=True)
    armature_transform = source_armature.matrix_world.copy()
    source_armature.parent = None
    source_armature.matrix_world = armature_transform
    bpy.data.objects.remove(root, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    source_armature.select_set(True)
    for target_mesh in target_meshes:
        target_mesh.select_set(True)
    bpy.context.view_layer.objects.active = source_armature

    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT_GLB),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_nla_strips=False,
        export_skins=True,
        export_all_influences=True,
    )

    print(f"Created {OUTPUT_BLEND}")
    print(f"Created {OUTPUT_GLB}")
    print(f"Rigged {len(target_meshes)} target meshes")


if __name__ == "__main__":
    main()