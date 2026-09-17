"""
Space Soldier Makeover - Blender Python script
==============================================
Transforms the visible layer of the imported UAL1 character into a futuristic
space soldier: tanned skin, brown hair, navy blue suit, sunglasses.

WHAT THIS SCRIPT DOES NOT TOUCH
- The armature (bones, bone count, names, rest poses)
- Animation actions/clips (all 43 UAL clips stay intact)
- Vertex group weights used by the skinning

It only changes materials.

HOW TO RUN
1. Blender: File -> Import -> glTF 2.0 -> your character .glb
2. Switch to the "Scripting" workspace (top tab bar)
3. Text Editor -> Open -> this file
4. Press Alt+P (or the Run button)
5. Inspect the result. Tweak the CONFIG constants below and re-run to taste.
   (Materials are reused between runs, so re-running is safe.)
6. When happy: set RUN_EXPORT = True and run again, or File -> Export -> glTF 2.0
7. In the game, point src/scripts/characterManager.ts at the new file,
   then run: npm test && npm run typecheck && npm run build
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

# Polys of the head whose world Z is above this are painted as hair.
# The UAL character is ~1.83 m tall; 1.70 covers the top of the head.
HAIR_Z_THRESHOLD = 1.70

# Sunglasses: polygons on the head with world Z in this range get the glasses material.
# Adjust these if the glasses sit too high or low.
GLASSES_Z_MIN = 1.62
GLASSES_Z_MAX = 1.72

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
    MATS["skin"]    = make_principled("SoldierSkin",    (0.80, 0.62, 0.48), 0.55, 0.0)
    MATS["hair"]    = make_principled("SoldierHair",    (0.30, 0.19, 0.10), 0.65, 0.0)
    MATS["suit"]    = make_principled("SuitBase",       (0.05, 0.08, 0.18), 0.35, 0.85)  # Navy blue
    MATS["gloves"]  = make_principled("SuitGloves",     (0.06, 0.06, 0.07), 0.45, 0.4)
    MATS["boots"]   = make_principled("SuitBoots",      (0.08, 0.08, 0.09), 0.60, 0.2)
    MATS["glasses"] = make_principled("SoldierGlasses", (0.02, 0.02, 0.03), 0.15, 0.9)   # Black reflective

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
            # Sunglasses override: polygons in the eye band on the head become glasses.
            elif GLASSES_Z_MIN <= avg_z <= GLASSES_Z_MAX:
                # Only apply to the front half of the head (positive Y in world space)
                avg_y = sum((world @ mesh.vertices[vi].co).y for vi in poly.vertices) / len(poly.vertices)
                if avg_y > 0.0:
                    part = "glasses"

        poly.material_index = slot_of[part]
    print(f"  {mesh_obj.name}: {len(mesh.polygons)} polys assigned across {len(mesh.materials)} slots")

# ---------------------------------------------------------------------------
# Integrity checks + export
# ---------------------------------------------------------------------------

def find_armature():
    for obj in bpy.context.scene.objects:
        if obj.type == 'ARMATURE':
            return obj
    return None

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

    verify_integrity(before, snapshot_armature_state())

    if RUN_EXPORT:
        export_glb()
    else:
        print("Review the look in Blender. Set RUN_EXPORT = True to write the GLB.")

main()
