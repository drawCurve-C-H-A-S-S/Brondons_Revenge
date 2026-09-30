"""
Space Soldier Makeover - Blender Python script
==============================================
Transforms the visible layer of the imported UAL1 character into a futuristic
space soldier: tanned skin, brown hair, dark metallic suit with glowing cyan
accents, gloves, boots, and optional bone-parented armor plates.

WHAT THIS SCRIPT DOES NOT TOUCH
- The armature (bones, bone count, names, rest poses)
- Animation actions/clips (all 43 UAL clips stay intact)
- Vertex group weights used by the skinning

It only changes materials and optionally ADDS new mesh objects that are
PARENTED to existing bones, so they follow every animation automatically.

HOW TO RUN
1. Blender: File -> Import -> glTF 2.0 -> src/assets/models/UAL1_Standard.glb
2. Switch to the "Scripting" workspace (top tab bar)
3. Text Editor -> Open -> this file
4. Press Alt+P (or the Run button)
5. Inspect the result. Tweak the CONFIG constants below and re-run to taste.
   (Materials are reused between runs, so re-running is safe.)
6. When happy: set RUN_EXPORT = True and run again, or File -> Export -> glTF 2.0
   The exported file lands in src/assets/models/ as UAL1_SpaceSoldier.glb
7. In the game, point src/scripts/characterManager.ts at the new file (or
   overwrite UAL1_Standard.glb), then run: npm test && npm run typecheck && npm run build
"""

import bpy
import bmesh
import math
from mathutils import Vector

# ---------------------------------------------------------------------------
# CONFIG - tweak these and re-run
# ---------------------------------------------------------------------------

# Replace/export the model when everything looks right?
RUN_EXPORT = False
EXPORT_PATH = r"c:\Users\Admin\OneDrive\Desktop\WITS\2026\CGV\Project\Brondons Revenge\src\assets\models\UAL1_SpaceSoldier.glb"

# Add bone-parented armor geometry (shoulder pads, chest plate, shin guards,
# belt). Parenting to bones does not modify the rig or its animations.
ADD_ARMOR = True

# Armor sizes (meters) and offsets, in bone-local space. Nudge to fit.
SHOULDER_PAD_RADIUS = 0.115
SHOULDER_PAD_OFFSET = (0.0, -0.02, 0.12)   # x, y, z offset from upperarm bone origin
CHEST_PLATE_SIZE = (0.36, 0.24, 0.30)      # width, depth, height
CHEST_PLATE_OFFSET = (0.0, 0.10, 0.02)     # +y pushes it toward the chest front
SHIN_GUARD_SIZE = (0.10, 0.10, 0.32)
SHIN_GUARD_OFFSET = (0.0, 0.04, 0.05)
BELT_RADIUS = 0.19
BELT_HEIGHT = 0.06
BELT_OFFSET = (0.0, 0.0, 0.02)

# Polys of the head whose world Z is above this are painted as hair.
# The UAL character is ~1.83 m tall; 1.70 covers the top of the head.
HAIR_Z_THRESHOLD = 1.70

# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def make_principled(name, base_color, roughness, metallic,
                    emission_color=None, emission_strength=0.0,
                    alpha=1.0):
    """Create (or reuse) a Principled BSDF material, Blender 3.x/4.x safe."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if not bsdf:  # unusual node layouts
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                bsdf = node
                break

    def set_input(names, value):
        for n in names:
            sock = bsdf.inputs.get(n)
            if sock is not None:
                sock.default_value = value
                return
        print(f"  (skip) input {names[0]} not found for {name}")

    set_input(["Base Color"], (*base_color, 1.0))
    set_input(["Roughness"], roughness)
    set_input(["Metallic"], metallic)
    if emission_color:
        # 'Emission Color' on 4.x, 'Emission' on 3.x
        set_input(["Emission Color", "Emission"], (*emission_color, 1.0))
        set_input(["Emission Strength"], emission_strength)
    if alpha < 1.0:
        set_input(["Alpha"], alpha)
        mat.blend_method = 'BLEND'
    return mat

MATS = {}

def build_materials():
    MATS["skin"]   = make_principled("SoldierSkin",   (0.80, 0.62, 0.48), 0.55, 0.0)
    MATS["hair"]   = make_principled("SoldierHair",   (0.30, 0.19, 0.10), 0.65, 0.0)
    MATS["suit"]   = make_principled("SuitBase",      (0.10, 0.12, 0.16), 0.35, 0.85)
    MATS["armor"]  = make_principled("SuitArmor",     (0.35, 0.38, 0.42), 0.28, 1.0)
    MATS["accent"] = make_principled("SuitAccent",    (0.10, 0.80, 1.00), 0.20, 0.9,
                                     emission_color=(0.10, 0.80, 1.00),
                                     emission_strength=3.0)
    MATS["gloves"] = make_principled("SuitGloves",    (0.06, 0.06, 0.07), 0.45, 0.4)
    MATS["boots"]  = make_principled("SuitBoots",     (0.08, 0.08, 0.09), 0.60, 0.2)
    MATS["visor"]  = make_principled("SuitVisor",     (0.05, 0.15, 0.25), 0.10, 0.9,
                                     emission_color=(0.20, 0.70, 1.00),
                                     emission_strength=1.5, alpha=0.85)

# ---------------------------------------------------------------------------
# Body-part classification from vertex group (bone) names
# ---------------------------------------------------------------------------

PART_RULES = [
    # (keywords, material key) - first match wins, checked in order
    (("foot", "ball"),                "boots"),
    (("hand", "index", "middle", "pinky", "ring", "thumb"), "gloves"),
    (("hair",),                       "hair"),
    (("head", "face"),                "skin"),
    (("neck",),                       "skin"),
]

def classify_group(group_name):
    name = group_name.lower()
    for keywords, mat_key in PART_RULES:
        if any(k in name for k in keywords):
            return mat_key
    # Everything else on a humanoid rig (root, pelvis, spine, clavicle,
    # upperarm, lowerarm, thigh, calf, leaf bones) is covered by the suit.
    return "suit"

def dominant_group_per_vertex(mesh_obj):
    """vertex index -> vertex group name with the highest weight."""
    result = {}
    vgroups = mesh_obj.vertex_groups
    for v in mesh_obj.data.vertices:
        best_name, best_weight = None, 0.0
        for g in v.groups:
            if g.weight > best_weight:
                best_weight = g.weight
                best_name = vgroups[g.group].name
        result[v.index] = best_name
    return result

def assign_materials(mesh_obj):
    """Per-polygon material assignment using dominant vertex groups."""
    mesh = mesh_obj.data
    if not mesh_obj.vertex_groups:
        print(f"  {mesh_obj.name}: no vertex groups, applying suit material")
        mesh.materials.clear()
        mesh.materials.append(MATS["suit"])
        return

    slots = list(MATS.values())          # stable slot order
    slot_of = {key: i for i, key in enumerate(MATS.keys())}
    mesh.materials.clear()
    for mat in slots:
        mesh.materials.append(mat)

    vert_part = dominant_group_per_vertex(mesh_obj)
    world = mesh_obj.matrix_world
    for poly in mesh.polygons:
        votes = {}
        for vi in poly.vertices:
            part = classify_group(vert_part.get(vi) or "")
            votes[part] = votes.get(part, 0) + 1
        part = max(votes, key=votes.get)

        # Hair override: polygons high on the head become hair.
        if part == "skin":
            avg_z = sum((world @ mesh.vertices[vi].co).z for vi in poly.vertices) / len(poly.vertices)
            if avg_z > HAIR_Z_THRESHOLD:
                part = "hair"

        poly.material_index = slot_of[part]
    print(f"  {mesh_obj.name}: {len(mesh.polygons)} polys assigned across {len(mesh.materials)} slots")

# ---------------------------------------------------------------------------
# Bone-parented armor add-ons (rig untouched)
# ---------------------------------------------------------------------------

def find_armature():
    for obj in bpy.context.scene.objects:
        if obj.type == 'ARMATURE':
            return obj
    return None

def has_bone(armature, name):
    return name in armature.data.bones

def bone_parented(obj_name, bone_name, size, location, mat, bevel=False):
    """Create a mesh object parented to a bone (bone-local space)."""
    mesh = bpy.data.meshes.new(obj_name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(obj_name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.scale = size
    obj.location = location
    if bevel:
        bev = obj.modifiers.new("Bevel", 'BEVEL')
        bev.width = 0.02
        bev.segments = 3

    armature = find_armature()
    obj.parent = armature
    obj.parent_type = 'BONE'
    obj.parent_bone = bone_name     # must be set AFTER parent/parent_type
    obj.matrix_parent_inverse.identity()

    obj.data.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj

def add_shoulder_pad(bone_name):
    obj = bone_parented(f"Pad_{bone_name}", bone_name,
                        (SHOULDER_PAD_RADIUS, SHOULDER_PAD_RADIUS, SHOULDER_PAD_RADIUS * 0.6),
                        SHOULDER_PAD_OFFSET, MATS["armor"], bevel=True)
    # Cap the top with an accent ring for the sci-fi look
    ring = bone_parented(f"PadRing_{bone_name}", bone_name,
                         (SHOULDER_PAD_RADIUS * 1.05, SHOULDER_PAD_RADIUS * 1.05, 0.01),
                         (SHOULDER_PAD_OFFSET[0], SHOULDER_PAD_OFFSET[1],
                          SHOULDER_PAD_OFFSET[2] + SHOULDER_PAD_RADIUS * 0.5),
                         MATS["accent"])
    return obj, ring

def add_chest_plate():
    plate = bone_parented("ChestPlate", "spine_02", CHEST_PLATE_SIZE,
                          CHEST_PLATE_OFFSET, MATS["armor"], bevel=True)
    strip = bone_parented("ChestAccent", "spine_02",
                          (CHEST_PLATE_SIZE[0] * 0.7, 0.012, 0.03),
                          (CHEST_PLATE_OFFSET[0],
                           CHEST_PLATE_OFFSET[1] + CHEST_PLATE_SIZE[1] * 0.52,
                           CHEST_PLATE_OFFSET[2]),
                          MATS["accent"])
    return plate, strip

def add_shin_guard(bone_name):
    return bone_parented(f"Shin_{bone_name}", bone_name, SHIN_GUARD_SIZE,
                         SHIN_GUARD_OFFSET, MATS["armor"], bevel=True)

def add_belt():
    mesh = bpy.data.meshes.new("Belt")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24,
                          radius1=BELT_RADIUS, radius2=BELT_RADIUS, depth=BELT_HEIGHT)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("Belt", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = BELT_OFFSET
    armature = find_armature()
    obj.parent = armature
    obj.parent_type = 'BONE'
    obj.parent_bone = 'pelvis'
    obj.matrix_parent_inverse.identity()
    obj.data.materials.append(MATS["suit"])
    buckle = bone_parented("BeltBuckle", "pelvis", (0.08, 0.02, 0.05),
                           (BELT_OFFSET[0], BELT_RADIUS, BELT_OFFSET[1]), MATS["accent"])
    return obj, buckle

def add_armor():
    armature = find_armature()
    if not armature:
        print("No armature found - skipping armor.")
        return
    count_before = len(bpy.data.objects)
    if has_bone(armature, "upperarm_l"):
        add_shoulder_pad("upperarm_l")
    if has_bone(armature, "upperarm_r"):
        add_shoulder_pad("upperarm_r")
    if has_bone(armature, "spine_02"):
        add_chest_plate()
    if has_bone(armature, "calf_l"):
        add_shin_guard("calf_l")
    if has_bone(armature, "calf_r"):
        add_shin_guard("calf_r")
    if has_bone(armature, "pelvis"):
        add_belt()
    print(f"Armor added: {len(bpy.data.objects) - count_before} new objects parented to bones.")

# ---------------------------------------------------------------------------
# Integrity checks + export
# ---------------------------------------------------------------------------

def snapshot_armature_state():
    armature = find_armature()
    return {
        "bones": len(armature.data.bones) if armature else 0,
        "actions": len(bpy.data.actions),
    }

def verify_integrity(before, after):
    assert before["bones"] == after["bones"], "Bone count changed - rig must stay untouched!"
    assert before["actions"] == after["actions"], "Animation actions changed!"
    print(f"Integrity OK: {after['bones']} bones, {after['actions']} actions preserved.")

def export_glb():
    bpy.ops.export_scene.gltf(
        filepath=EXPORT_PATH,
        export_format='GLB',
        export_animations=True,
        export_skins=True,
        export_materials='EXPORT',
        export_apply=False,   # keep armature modifier untouched
        export_yup=True,
    )
    print(f"Exported to {EXPORT_PATH}")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    build_materials()

    before = snapshot_armature_state()

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    print(f"Re-skinning {len(meshes)} mesh objects...")
    for mesh_obj in meshes:
        assign_materials(mesh_obj)

    if ADD_ARMOR:
        add_armor()

    verify_integrity(before, snapshot_armature_state())

    if RUN_EXPORT:
        export_glb()
    else:
        print("Review the look in Blender. Set RUN_EXPORT = True to write the GLB.")

main()
