"""Inspect and fit the Subject animation skeleton to the saved base humanoid."""

import argparse
import json
import math
import shutil
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "src" / "assets" / "models"
TARGET_FILE = Path.home() / "Downloads" / "base_mesh2.blend"
SOURCE_FILE = MODEL_DIR / "Subject.glb"
OUTPUT_BLEND = MODEL_DIR / "MC.blend"
OUTPUT_GLB = MODEL_DIR / "MC.glb"
REVIEW_DIR = Path.home() / "Downloads" / "base_mesh2_rigging_review"
MODEL_ORIENTATION = Matrix.Rotation(-math.pi / 2, 4, "Z")
MODEL_FLOOR = 0.156211


def coordinates(value):
    return [round(float(component), 6) for component in value]


def mesh_points(obj, evaluated=False):
    if not evaluated:
        return [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    evaluated_obj = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated_obj.to_mesh()
    points = [evaluated_obj.matrix_world @ vertex.co for vertex in mesh.vertices]
    evaluated_obj.to_mesh_clear()
    return points


def bounds(points):
    return [
        [round(min(point[axis] for point in points), 6), round(max(point[axis] for point in points), 6)]
        for axis in range(3)
    ]


def object_report(obj, geometry=False):
    result = {
        "name": obj.name,
        "type": obj.type,
        "matrix": [coordinates(row) for row in obj.matrix_world],
        "parent": obj.parent.name if obj.parent else None,
    }
    if obj.type == "MESH":
        points = mesh_points(obj)
        result.update({
            "bounds": bounds(points),
            "evaluated_bounds": bounds(mesh_points(obj, True)),
            "vertices": len(points),
            "polygons": len(obj.data.polygons),
            "materials": [material.name if material else None for material in obj.data.materials],
            "modifiers": [{
                "type": modifier.type,
                "object": getattr(modifier, "object", None).name if getattr(modifier, "object", None) else None,
                "axis": list(modifier.use_axis) if modifier.type == "MIRROR" else None,
                "thickness": modifier.thickness if modifier.type == "SOLIDIFY" else None,
                "offset": modifier.offset if modifier.type == "SOLIDIFY" else None,
            } for modifier in obj.modifiers],
        })
        if geometry:
            result["positions"] = [coordinates(point) for point in points]
            result["faces"] = [list(polygon.vertices) for polygon in obj.data.polygons]
    if obj.type == "ARMATURE":
        result["bones"] = [{
            "name": bone.name,
            "parent": bone.parent.name if bone.parent else None,
            "head": coordinates(obj.matrix_world @ bone.head_local),
            "tail": coordinates(obj.matrix_world @ bone.tail_local),
            "deform": bone.use_deform,
        } for bone in obj.data.bones]
    return result


def material_report(material):
    nodes = []
    if material.node_tree:
        for node in material.node_tree.nodes:
            inputs = {}
            for socket in node.inputs:
                if not hasattr(socket, "default_value"):
                    continue
                value = socket.default_value
                if isinstance(value, (int, float, str, bool)):
                    inputs[socket.name] = value
                elif hasattr(value, "__iter__"):
                    inputs[socket.name] = coordinates(value)
            nodes.append({"name": node.name, "type": node.type, "inputs": inputs})
    return {"name": material.name, "nodes": nodes}


def load_sources():
    bpy.ops.wm.open_mainfile(filepath=str(TARGET_FILE))
    target_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    target_report = [object_report(obj, True) for obj in target_meshes]
    materials = [material_report(material) for material in bpy.data.materials]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE_FILE))
    donor_objects = [obj for obj in bpy.data.objects if obj not in before]
    armature = next(obj for obj in donor_objects if obj.type == "ARMATURE")
    armature.data.pose_position = "REST"
    bpy.context.view_layer.update()
    report = {
        "target": target_report,
        "materials": materials,
        "donor": [object_report(obj) for obj in donor_objects],
        "actions": [{
            "name": action.name,
            "frames": coordinates(action.frame_range),
            "slots": [slot.identifier for slot in action.slots],
        } for action in bpy.data.actions],
    }
    return target_meshes, donor_objects, armature, report


def prepare_stage():
    for obj in list(bpy.context.scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 720
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    scene.world = bpy.data.worlds.new("Rig review world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.055, 0.065, 0.08, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45
    for name, location, energy, size in [
        ("Review key", (4, -3, 6), 700, 5),
        ("Review fill", (-3, -2, 4), 350, 4),
        ("Review rim", (1, 4, 5), 600, 3),
    ]:
        light = bpy.data.lights.new(name, "AREA")
        light.energy = energy
        light.shape = "DISK"
        light.size = size
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0, 0, 1.5)) - obj.location).to_track_quat("-Z", "Y").to_euler()
    camera = bpy.data.objects.new("Rig review camera", bpy.data.cameras.new("Rig review camera"))
    scene.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    scene.camera = camera
    return camera


def render_view(camera, name, points, direction):
    box = bounds(points)
    center = Vector([(minimum + maximum) / 2 for minimum, maximum in box])
    span = max(maximum - minimum for minimum, maximum in box)
    camera.location = center + Vector(direction).normalized() * span * 3
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = span * 1.25
    bpy.context.scene.render.filepath = str(REVIEW_DIR / f"{name}.png")
    bpy.ops.render.render(write_still=True)


def inspect():
    target_meshes, donor_objects, armature, report = load_sources()
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    (REVIEW_DIR / "inspection.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    for obj in donor_objects:
        obj.hide_render = True
    camera = prepare_stage()
    points = [point for obj in target_meshes for point in mesh_points(obj, True)]
    render_view(camera, "original_front", points, (1, 0, 0.08))
    render_view(camera, "original_three_quarter", points, (1, -0.7, 0.08))
    render_view(camera, "original_profile", points, (0, -1, 0.05))
    print(f"INSPECTION_REPORT={REVIEW_DIR / 'inspection.json'}")
    print(f"TARGET_BOUNDS={bounds(points)}")
    print(f"DONOR_BONES={len(armature.data.bones)} ACTIONS={len(bpy.data.actions)}")


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def group_mapping(name):
    suffix = "_l" if name.endswith(".L") else "_r"
    stem = name.removesuffix(".R").removesuffix(".L")
    mapping = {
        "Bone": "pelvis", "Bone.001": "spine_02", "Bone.002": "neck_01",
        "Bone.003": "Head", "Bone.004": "clavicle" + suffix,
        "Bone.005": "upperarm" + suffix, "Bone.006": "lowerarm" + suffix,
        "Bone.007": "hand" + suffix, "Bone.008": "hand" + suffix,
        "Bone.009": "hand" + suffix, "Bone.010": "hand" + suffix,
        "Bone.011": "hand" + suffix, "Bone.012": "hand" + suffix,
        "Bone.013": "hand" + suffix, "Bone.014": "root",
        "Bone.015": "pelvis", "Bone.016": "pelvis",
        "Bone.017": "thigh" + suffix, "Bone.018": "calf" + suffix,
        "Bone.019": "foot" + suffix, "Bone.020": "ball" + suffix,
        "Bone.021": "ball" + suffix, "Bone.022": "ball" + suffix,
    }
    return mapping.get(stem)


def fit_collar(obj):
    if obj.get("collar_fitted_face"):
        return
    for vertex in obj.data.vertices:
        if vertex.co.z > 2.43 and abs(vertex.co.x) < 0.15:
            vertex.co.z = 2.43 + (vertex.co.z - 2.43) * 0.45
    obj["collar_fitted_face"] = True


def prepare_meshes(target_meshes):
    for obj in target_meshes:
        select_only(obj)
        if obj.animation_data:
            obj.animation_data_clear()
        for modifier in list(obj.modifiers):
            if modifier.type == "MIRROR":
                bpy.ops.object.modifier_apply(modifier=modifier.name)
            else:
                obj.modifiers.remove(modifier)
        transform = MODEL_ORIENTATION @ obj.matrix_world
        for vertex in obj.data.vertices:
            vertex.co = transform @ vertex.co
            vertex.co.z -= MODEL_FLOOR
        if obj.name == "Cylinder.002":
            fit_collar(obj)
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        if obj.name == "Cylinder":
            mesh.verts.ensure_lookup_table()
            old_hand_groups = {group.index for group in obj.vertex_groups if group.name.startswith(("Bone.007", "Bone.008", "Bone.009", "Bone.010", "Bone.011", "Bone.012", "Bone.013"))}
            old_hands = [mesh.verts[vertex.index] for vertex in obj.data.vertices if sum(member.weight for member in vertex.groups if member.group in old_hand_groups) > 0.55 and vertex.co.z < 1.415]
            bmesh.ops.delete(mesh, geom=old_hands, context="VERTS")
        bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=0.001)
        bmesh.ops.subdivide_edges(mesh, edges=list(mesh.edges), cuts=2, use_grid_fill=True)
        bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
        mesh.to_mesh(obj.data)
        mesh.free()
        obj.data.update()
        old_groups = {group.index: group_mapping(group.name) for group in obj.vertex_groups}
        weights = []
        for vertex in obj.data.vertices:
            values = {}
            for member in vertex.groups:
                mapped = old_groups.get(member.group)
                if mapped and mapped != "root":
                    values[mapped] = values.get(mapped, 0) + member.weight
            weights.append(values)
        obj.vertex_groups.clear()
        names = sorted({name for values in weights for name in values})
        groups = {name: obj.vertex_groups.new(name=name) for name in names}
        for vertex, values in zip(obj.data.vertices, weights):
            values = dict(sorted(values.items(), key=lambda pair: pair[1], reverse=True)[:4])
            total = sum(values.values())
            if total < 1e-8:
                values = {"pelvis": 1.0}
                groups.setdefault("pelvis", obj.vertex_groups.get("pelvis") or obj.vertex_groups.new(name="pelvis"))
                total = 1.0
            for name, weight in values.items():
                groups[name].add([vertex.index], weight / total, "REPLACE")
        obj.name = {"Cylinder": "Character Body", "Cylinder.002": "Character Jacket", "Cylinder.003": "Character Trousers"}.get(obj.name, obj.name)
    bpy.context.view_layer.update()


def fit_armature(source):
    source_rest = {bone.name: bone.matrix_local.copy() for bone in source.data.bones}
    fitted = source.copy()
    fitted.data = source.data.copy()
    fitted.name = "Character Subject Rig"
    fitted.data.name = "Fitted Subject Skeleton"
    fitted.animation_data_clear()
    fitted.show_in_front = True
    fitted.display_type = "WIRE"
    bpy.context.scene.collection.objects.link(fitted)
    select_only(fitted)
    bpy.ops.object.mode_set(mode="EDIT")
    skeleton = fitted.data.edit_bones
    for bone in skeleton:
        bone.use_connect = False
    central = {
        "root": ((0, 0, 0), (0, 0.25, 0)),
        "pelvis": ((0, 0.04, 1.43), (0, 0.04, 1.66)),
        "spine_01": ((0, 0.04, 1.66), (0, 0.045, 1.96)),
        "spine_02": ((0, 0.045, 1.96), (0, 0.08, 2.23)),
        "spine_03": ((0, 0.08, 2.23), (0, 0.09, 2.48)),
        "neck_01": ((0, 0.09, 2.48), (0, 0.04, 2.595)),
        "Head": ((0, 0.04, 2.595), (0, 0.025, 2.815)),
    }
    for name, (head, tail) in central.items():
        bone = skeleton[name]
        axis = bone.z_axis.copy()
        bone.head, bone.tail = Vector(head), Vector(tail)
        bone.align_roll(axis)
    hand_transforms = {}
    for side, sign in (("l", 1), ("r", -1)):
        wrist = Vector((sign * 0.3528, 0.142, 1.595))
        arm_direction = Vector((sign * 0.015, -0.025, -0.9996)).normalized()
        hand_source = source.data.bones[f"hand_{side}"]
        rotation = (hand_source.tail_local - hand_source.head_local).rotation_difference(arm_direction)
        hand_scale = 1.15
        transform = Matrix.Translation(wrist) @ rotation.to_matrix().to_4x4() @ Matrix.Scale(hand_scale, 4) @ Matrix.Translation(-hand_source.head_local)
        hand_transforms[side] = transform
        limbs = {
            f"clavicle_{side}": ((sign * 0.018, 0.09, 2.48), (sign * 0.246, 0.13, 2.385)),
            f"upperarm_{side}": ((sign * 0.246, 0.13, 2.385), (sign * 0.331, 0.139, 1.95)),
            f"lowerarm_{side}": ((sign * 0.331, 0.139, 1.95), tuple(wrist)),
            f"thigh_{side}": ((sign * 0.206, 0.045, 1.44), (sign * 0.254, 0.02, 0.755)),
            f"calf_{side}": ((sign * 0.254, 0.02, 0.755), (sign * 0.32, 0.025, 0.135)),
            f"foot_{side}": ((sign * 0.32, 0.025, 0.135), (sign * 0.338, -0.125, 0.075)),
            f"ball_{side}": ((sign * 0.338, -0.125, 0.075), (sign * 0.338, -0.197, 0.075)),
            f"ball_leaf_{side}": ((sign * 0.338, -0.197, 0.075), (sign * 0.338, -0.22, 0.075)),
        }
        for name, (head, tail) in limbs.items():
            bone = skeleton[name]
            original = source.data.bones[name]
            rotation = (original.tail_local - original.head_local).rotation_difference(Vector(tail) - Vector(head))
            bone.head, bone.tail = Vector(head), Vector(tail)
            bone.align_roll(rotation @ original.matrix_local.to_3x3().col[2])
        finger_prefixes = ("hand_", "thumb_", "index_", "middle_", "ring_", "pinky_")
        for original in source.data.bones:
            if original.name.endswith("_" + side) and original.name.startswith(finger_prefixes):
                bone = skeleton[original.name]
                bone.head = transform @ original.head_local
                bone.tail = transform @ original.tail_local
                bone.align_roll(rotation @ original.matrix_local.to_3x3().col[2])
    bpy.ops.object.mode_set(mode="OBJECT")
    fitted.data.pose_position = "REST"
    bpy.context.view_layer.update()
    return fitted, source_rest, hand_transforms


def attach_skin(obj, armature):
    modifier = obj.modifiers.new("Subject Skin", "ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = False
    obj.parent = armature
    obj.matrix_parent_inverse = armature.matrix_world.inverted()


def smoothstep(low, high, value):
    value = max(0.0, min(1.0, (value - low) / (high - low)))
    return value * value * (3.0 - 2.0 * value)


def reweight_meshes(target_meshes):
    for obj in target_meshes:
        obj.vertex_groups.clear()
        groups = {}
        for vertex in obj.data.vertices:
            point = vertex.co
            side = "_l" if point.x >= 0 else "_r"
            height = point.z
            if "Body" in obj.name and height >= 2.5:
                head = smoothstep(2.5, 2.53, height)
                weights = {"neck_01": 1 - head, "Head": head}
            elif "Body" in obj.name and height >= 1.55 and abs(point.x) > 0.215:
                lower = 1 - smoothstep(1.88, 2.015, height)
                clavicle = smoothstep(2.33, 2.48, height)
                weights = {"lowerarm" + side: lower, "upperarm" + side: (1 - lower) * (1 - clavicle), "clavicle" + side: (1 - lower) * clavicle}
            elif height < 1.52 and "Jacket" not in obj.name:
                pelvis = smoothstep(1.26, 1.51, height)
                thigh = smoothstep(0.65, 0.88, height)
                foot = 1 - smoothstep(0.13, 0.28, height)
                weights = {"pelvis": pelvis, "thigh" + side: (1 - pelvis) * thigh, "calf" + side: (1 - pelvis) * (1 - thigh) * (1 - foot), "foot" + side: (1 - pelvis) * (1 - thigh) * foot}
            else:
                centers = [(1.48, "pelvis"), (1.75, "spine_01"), (2.03, "spine_02"), (2.35, "spine_03"), (2.52, "neck_01")]
                if height <= centers[0][0]:
                    weights = {"pelvis": 1}
                elif height >= centers[-1][0]:
                    weights = {"neck_01": 1}
                else:
                    for (low, low_name), (high, high_name) in zip(centers, centers[1:]):
                        if low <= height <= high:
                            blend = smoothstep(low, high, height)
                            weights = {low_name: 1 - blend, high_name: blend}
                            break
            if "Jacket" in obj.name and height > 2.1:
                shoulder = smoothstep(0.12, 0.275, abs(point.x)) * smoothstep(2.1, 2.3, height)
                weights = {name: weight * (1 - shoulder) for name, weight in weights.items()}
                outer = smoothstep(0.19, 0.3, abs(point.x))
                weights["clavicle" + side] = shoulder * (1 - outer)
                weights["upperarm" + side] = shoulder * outer
            for name, weight in weights.items():
                if weight <= 1e-6:
                    continue
                if name not in groups:
                    groups[name] = obj.vertex_groups.new(name=name)
                groups[name].add([vertex.index], weight, "REPLACE")


def wrist_bridges(body, armature):
    result = []
    mesh = bmesh.new()
    mesh.from_mesh(body.data)
    for side, sign in (("l", 1), ("r", -1)):
        ring = [vertex.co.copy() for vertex in mesh.verts if vertex.is_boundary and sign * vertex.co.x > 0.25 and 1.5 < vertex.co.z < 1.7]
        if not ring:
            raise RuntimeError(f"No forearm opening found for {side}")
        center = sum(ring, Vector()) / len(ring)
        ring.sort(key=lambda point: math.atan2(point.y - center.y, point.x - center.x))
        count = len(ring)
        lower = [Vector((point.x, point.y, point.z - 0.07)) for point in ring]
        faces = [(index, index + count, (index + 1) % count + count, (index + 1) % count) for index in range(count)]
        data = bpy.data.meshes.new(f"Wrist seam {side}")
        data.from_pydata(ring + lower, [], faces)
        obj = bpy.data.objects.new(f"Character Wrist {side.upper()}", data)
        bpy.context.scene.collection.objects.link(obj)
        obj.vertex_groups.new(name=f"lowerarm_{side}").add(list(range(count)), 1, "REPLACE")
        obj.vertex_groups.new(name=f"hand_{side}").add(list(range(count, count * 2)), 1, "REPLACE")
        attach_skin(obj, armature)
        result.append(obj)
    mesh.free()
    return result


def donor_hands(source_mesh, armature, transforms):
    hands = []
    for side in ("l", "r"):
        obj = source_mesh.copy()
        obj.data = source_mesh.data.copy()
        obj.animation_data_clear()
        obj.modifiers.clear()
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        obj.name = f"Subject Hand {side.upper()}"
        bpy.context.scene.collection.objects.link(obj)
        for vertex in obj.data.vertices:
            vertex.co = source_mesh.matrix_world @ vertex.co
        seam = armature.data.bones[f"hand_{side}"].head_local
        original_wrist = transforms[side].inverted() @ seam
        sign = 1 if side == "l" else -1
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        unwanted = [vertex for vertex in mesh.verts if sign * vertex.co.x < sign * original_wrist.x - 0.018]
        bmesh.ops.delete(mesh, geom=unwanted, context="VERTS")
        for vertex in mesh.verts:
            vertex.co = transforms[side] @ vertex.co
        mesh.to_mesh(obj.data)
        mesh.free()
        obj.data.update()
        attach_skin(obj, armature)
        hands.append(obj)
    return hands


def material(name, color, roughness=0.75):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.diffuse_color = (*color, 1)
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Specular IOR Level"].default_value = 0.22
    return result


def assign_materials(target_meshes, hands):
    skin = material("Character Warm Skin", (0.67, 0.38, 0.245))
    jacket = material("Character Graphite Jacket", (0.048, 0.056, 0.065))
    trousers = material("Character Charcoal Trousers", (0.035, 0.038, 0.052))
    boots = material("Character Dark Boots", (0.016, 0.019, 0.023), 0.55)
    for obj in target_meshes + hands:
        obj.data.materials.clear()
        chosen = skin if any(name in obj.name for name in ("Body", "Hand", "Wrist")) else jacket if "Jacket" in obj.name else trousers
        obj.data.materials.append(chosen)
        if "Body" in obj.name:
            obj.data.materials.append(boots)
        for polygon in obj.data.polygons:
            height = sum(obj.data.vertices[index].co.z for index in polygon.vertices) / len(polygon.vertices)
            polygon.material_index = 1 if "Body" in obj.name and height < 0.18 else 0
            polygon.use_smooth = any(name in obj.name for name in ("Hand", "Body", "Wrist"))
    return skin


def match_clothing_weights(body, clothing):
    sys.path.insert(0, str(PROJECT_ROOT))
    from tools.transfer_subject_rig_to_mc import transfer_weights

    for obj in clothing:
        for group in body.vertex_groups:
            if not obj.vertex_groups.get(group.name):
                obj.vertex_groups.new(name=group.name)
        transfer_weights(body, obj)


def normalize_skin_weights(meshes, rig):
    for obj in meshes:
        weights = []
        for vertex in obj.data.vertices:
            values = [(member.group, member.weight) for member in vertex.groups if obj.vertex_groups[member.group].name in rig.data.bones and member.weight > 0]
            values = sorted(values, key=lambda value: value[1], reverse=True)[:4]
            total = sum(weight for group, weight in values)
            if total < 1e-8:
                raise RuntimeError(f"Unweighted vertex in {obj.name}: {vertex.index}")
            weights.append([(group, weight / total) for group, weight in values])
        for vertex, values in zip(obj.data.vertices, weights):
            for group in obj.vertex_groups:
                group.remove([vertex.index])
            for group, weight in values:
                obj.vertex_groups[group].add([vertex.index], weight, "REPLACE")


def head_attachment(obj, armature, surface):
    obj.data.materials.clear()
    obj.data.materials.append(surface)
    obj.vertex_groups.new(name="Head").add(list(range(len(obj.data.vertices))), 1, "REPLACE")
    attach_skin(obj, armature)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def face_surface(body, horizontal, height):
    hit, point, normal, polygon = body.ray_cast(Vector((horizontal, -1, height)), Vector((0, 1, 0)))
    if not hit:
        raise RuntimeError(f"No head surface at {horizontal}, {height}")
    return point


def face_ellipsoid(name, center, scale, surface, armature):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    select_only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return head_attachment(obj, armature, surface)


def face_line(name, points, radius, surface, armature):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 2
    data.bevel_depth = radius
    data.bevel_resolution = 1
    spline = data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, coordinate in zip(spline.points, points):
        point.co = (*coordinate, 1)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    select_only(obj)
    bpy.ops.object.convert(target="MESH")
    return head_attachment(bpy.context.object, armature, surface)


def add_face(body, armature, skin):
    eyes = material("Character Eye Whites", (0.8, 0.82, 0.76), 0.35)
    iris = material("Character Amber Iris", (0.14, 0.065, 0.026), 0.32)
    dark = material("Character Brows and Pupils", (0.009, 0.007, 0.009), 0.8)
    lips = material("Character Lip Tone", (0.27, 0.105, 0.068), 0.8)
    details = []
    for side, sign in (("L", 1), ("R", -1)):
        position = face_surface(body, sign * 0.047, 2.643)
        position.y += 0.005
        details.append(face_ellipsoid(f"Face {side} Eye", position, (0.023, 0.011, 0.013), eyes, armature))
        details.append(face_ellipsoid(f"Face {side} Iris", position + Vector((0, -0.01, 0)), (0.0085, 0.004, 0.01), iris, armature))
        details.append(face_ellipsoid(f"Face {side} Pupil", position + Vector((0, -0.013, 0)), (0.004, 0.002, 0.007), dark, armature))
        details.append(face_ellipsoid(f"Face {side} Catchlight", position + Vector((-0.002, -0.015, 0.0038)), (0.0018, 0.001, 0.0018), eyes, armature))
        lid = []
        brow = []
        for horizontal, height in [(sign * 0.027, 2.65), (sign * 0.047, 2.654), (sign * 0.069, 2.65)]:
            point = face_surface(body, horizontal, height)
            point.y -= 0.01
            lid.append(point)
        for horizontal, height in [(sign * 0.026, 2.671), (sign * 0.047, 2.677), (sign * 0.073, 2.67)]:
            point = face_surface(body, horizontal, height)
            point.y -= 0.004
            brow.append(point)
        details.append(face_line(f"Face {side} Upper Lid", lid, 0.0022, dark, armature))
        details.append(face_line(f"Face {side} Eyebrow", brow, 0.004, dark, armature))
    mouth = []
    lower_lip = []
    for horizontal, height in [(-0.025, 2.547), (-0.012, 2.544), (0, 2.545), (0.012, 2.544), (0.025, 2.547)]:
        point = face_surface(body, horizontal, height)
        point.y -= 0.003
        mouth.append(point)
        lower_lip.append(point + Vector((0, -0.0005, -0.004)))
    details.append(face_line("Face Mouth", mouth, 0.0018, dark, armature))
    details.append(face_line("Face Lower Lip", lower_lip, 0.0022, lips, armature))
    for sign, side in ((1, "L"), (-1, "R")):
        details.append(face_ellipsoid(f"Face {side} Ear", Vector((sign * 0.108, 0.025, 2.638)), (0.013, 0.012, 0.031), skin, armature))
    return details


def hair_lock(name, root, middle, tip, width, thickness, surface, armature):
    root, middle, tip = Vector(root), Vector(middle), Vector(tip)
    tangent = (tip - root).normalized()
    breadth = tangent.cross(Vector((0, 1, 0))).normalized()
    depth = tangent.cross(breadth).normalized()
    positions = []
    for center, scale in ((root, 1.0), (middle, 0.72)):
        for horizontal, vertical in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            positions.append(center + breadth * width * scale * horizontal / 2 + depth * thickness * scale * vertical / 2)
    positions.append(tip)
    faces = [(3, 2, 1, 0)]
    faces.extend((index, (index + 1) % 4, (index + 1) % 4 + 4, index + 4) for index in range(4))
    faces.extend((index + 4, (index + 1) % 4 + 4, 8) for index in range(4))
    data = bpy.data.meshes.new(name)
    data.from_pydata(positions, [], faces)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    head_attachment(obj, armature, surface)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return obj


def add_anime_hair(body, armature):
    base = material("Character Anime Hair", (0.013, 0.017, 0.024), 0.63)
    sheen = material("Character Anime Hair Highlights", (0.023, 0.029, 0.041), 0.6)
    center = Vector((0, 0.025, 2.69))
    positions = [Vector((0, 0.006, 2.84))]
    segments, rings = 24, 8
    for ring in range(1, rings + 1):
        for segment in range(segments):
            azimuth = segment / segments * math.tau
            front = (math.cos(azimuth) + 1) / 2
            limit = 1.91 - 0.56 * front
            theta = ring / rings * limit
            direction = Vector((math.sin(theta) * math.sin(azimuth), -math.sin(theta) * math.cos(azimuth), math.cos(theta)))
            hit, point, normal, polygon = body.ray_cast(center, direction)
            if not hit:
                raise RuntimeError("Cannot fit hair cap to head")
            positions.append(point + direction * 0.008)
    faces = [(0, 1 + segment, 1 + (segment + 1) % segments) for segment in range(segments)]
    for ring in range(rings - 1):
        for segment in range(segments):
            first = 1 + ring * segments + segment
            following = 1 + ring * segments + (segment + 1) % segments
            faces.append((first, first + segments, following + segments, following))
    data = bpy.data.meshes.new("Anime fitted hair cap")
    data.from_pydata(positions, [], faces)
    mesh = bmesh.new()
    mesh.from_mesh(data)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    mesh.to_mesh(data)
    mesh.free()
    cap = bpy.data.objects.new("Hair Fitted Cap", data)
    bpy.context.scene.collection.objects.link(cap)
    head_attachment(cap, armature, base)
    hair = [cap]
    locks = [
        ("Center fringe", (-0.025, -0.092, 2.776), (0.002, -0.131, 2.716), (0.018, -0.116, 2.66), 0.058, 0.019),
        ("Left fringe", (0.048, -0.081, 2.775), (0.069, -0.117, 2.731), (0.083, -0.1, 2.674), 0.055, 0.019),
        ("Right fringe", (-0.06, -0.079, 2.772), (-0.067, -0.118, 2.717), (-0.083, -0.098, 2.666), 0.055, 0.019),
        ("Sweep fringe", (0.015, -0.096, 2.788), (0.045, -0.133, 2.751), (0.066, -0.122, 2.694), 0.06, 0.02),
        ("Crown spike", (-0.015, 0.006, 2.824), (-0.015, -0.006, 2.886), (-0.022, -0.014, 2.947), 0.074, 0.055),
        ("Crown right", (-0.043, 0.011, 2.804), (-0.074, 0.003, 2.871), (-0.09, 0.015, 2.932), 0.07, 0.048),
        ("Crown left", (0.047, 0.011, 2.805), (0.078, 0.009, 2.862), (0.118, 0.022, 2.916), 0.073, 0.05),
        ("Side right", (-0.091, 0.023, 2.765), (-0.13, 0.035, 2.811), (-0.175, 0.054, 2.841), 0.069, 0.055),
        ("Side left", (0.091, 0.023, 2.765), (0.129, 0.04, 2.798), (0.17, 0.048, 2.827), 0.067, 0.052),
        ("Rear crest", (0.008, 0.087, 2.803), (0.011, 0.138, 2.86), (0.024, 0.19, 2.883), 0.08, 0.055),
        ("Rear right", (-0.082, 0.088, 2.748), (-0.119, 0.135, 2.777), (-0.158, 0.172, 2.773), 0.075, 0.047),
        ("Rear left", (0.082, 0.088, 2.748), (0.122, 0.135, 2.768), (0.165, 0.176, 2.765), 0.075, 0.047),
        ("Right sideburn", (-0.106, -0.021, 2.699), (-0.112, -0.035, 2.657), (-0.097, -0.045, 2.614), 0.037, 0.015),
        ("Left sideburn", (0.106, -0.021, 2.699), (0.112, -0.035, 2.657), (0.097, -0.045, 2.614), 0.037, 0.015),
    ]
    for index, (name, root, middle, tip, width, thickness) in enumerate(locks):
        hair.append(hair_lock("Hair " + name, root, middle, tip, width, thickness, sheen if index % 3 == 0 else base, armature))
    return hair


def action_curves(action):
    if not action.is_action_layered:
        return list(action.fcurves)
    return [curve for layer in action.layers for strip in layer.strips for slot in action.slots for curve in strip.channelbag(slot).fcurves if strip.channelbag(slot)]


def activate_action(obj, action):
    obj.animation_data_create()
    obj.animation_data.action = action
    if action.slots:
        obj.animation_data.action_slot = action.slots[0]
    for track in obj.animation_data.nla_tracks:
        track.mute = True


def retarget_actions(source, fitted, source_rest, actions):
    source.data.pose_position = "POSE"
    fitted.data.pose_position = "POSE"
    source.animation_data.action = None
    for track in source.animation_data.nla_tracks:
        track.mute = True
    target_rest = {bone.name: bone.matrix_local.copy() for bone in fitted.data.bones}
    differences = {name: target_rest[name].translation - matrix.translation * 1.64 for name, matrix in source_rest.items()}
    for original_action in actions:
        activate_action(source, original_action)
        action = bpy.data.actions.new(original_action.name.removeprefix("Source / "))
        action.use_fake_user = True
        action["source_clip"] = original_action.name.removeprefix("Source / ")
        fitted.animation_data_create()
        fitted.animation_data.action = action
        start, end = [int(round(value)) for value in original_action.frame_range]
        previous_rotations = {}
        for frame in range(start, end + 1):
            bpy.context.scene.frame_set(frame)
            source_matrices = {bone.name: bone.matrix.copy() for bone in source.pose.bones}
            desired = {}
            for bone in fitted.data.bones:
                original_pose = source_matrices[bone.name]
                old_rest = source_rest[bone.name]
                result = original_pose.to_quaternion().to_matrix().to_4x4()
                if bone.name.startswith("clavicle_"):
                    rotation = original_pose.to_quaternion() @ old_rest.to_quaternion().inverted() @ target_rest[bone.name].to_quaternion()
                    result = rotation.to_matrix().to_4x4()
                if bone.parent:
                    parent_pose = source_matrices[bone.parent.name]
                    parent_rest = source_rest[bone.parent.name]
                    target_parent = target_rest[bone.parent.name]
                    local_rest = target_parent.inverted() @ target_rest[bone.name].translation
                    source_local = parent_pose.inverted() @ original_pose.translation
                    source_local_rest = parent_rest.inverted() @ old_rest.translation
                    result.translation = desired[bone.parent.name].translation + desired[bone.parent.name].to_quaternion() @ (local_rest + (source_local - source_local_rest) * 1.64)
                else:
                    result.translation = original_pose.translation * 1.64 + differences[bone.name]
                desired[bone.name] = result
                pose = fitted.pose.bones[bone.name]
                pose.rotation_mode = "QUATERNION"
                if bone.parent:
                    pose.matrix_basis = bone.convert_local_to_pose(result, bone.matrix_local, parent_matrix=desired[bone.parent.name], parent_matrix_local=bone.parent.matrix_local, invert=True)
                else:
                    pose.matrix_basis = bone.convert_local_to_pose(result, bone.matrix_local, invert=True)
                if bone.name in previous_rotations and pose.rotation_quaternion.dot(previous_rotations[bone.name]) < 0:
                    pose.rotation_quaternion.negate()
                previous_rotations[bone.name] = pose.rotation_quaternion.copy()
                pose.keyframe_insert(data_path="location", frame=frame, group=bone.name)
                pose.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
                pose.keyframe_insert(data_path="scale", frame=frame, group=bone.name)
        for curve in action_curves(action):
            for keyframe in curve.keyframe_points:
                keyframe.interpolation = "LINEAR"
        print(f"RETARGETED={action.name} FRAMES={start}:{end}", flush=True)
    fitted.animation_data.action = None
    source.data.pose_position = "REST"
    fitted.data.pose_position = "REST"
    bpy.context.view_layer.update()


def build():
    target_meshes, donor_objects, source, report = load_sources()
    before_names = {action.name for action in bpy.data.actions if any(slot.identifier == "OBArmature" for slot in action.slots)}
    actions = [bpy.data.actions[name] for name in sorted(before_names)]
    for action in actions:
        action.name = "Source / " + action.name
    for track in source.animation_data.nla_tracks:
        track.mute = True
    source.animation_data.action = None
    prepare_meshes(target_meshes)
    fitted, source_rest, hand_transforms = fit_armature(source)
    reweight_meshes(target_meshes)
    body = next(obj for obj in target_meshes if "Body" in obj.name)
    match_clothing_weights(body, [obj for obj in target_meshes if obj != body])
    for obj in target_meshes:
        attach_skin(obj, fitted)
    source_mesh = next(obj for obj in donor_objects if obj.type == "MESH" and obj.vertex_groups.get("hand_l"))
    hands = donor_hands(source_mesh, fitted, hand_transforms)
    hands.extend(wrist_bridges(next(obj for obj in target_meshes if "Body" in obj.name), fitted))
    skin = assign_materials(target_meshes, hands)
    face = add_face(body, fitted, skin)
    hair = add_anime_hair(body, fitted)
    retarget_actions(source, fitted, source_rest, actions)
    for obj in donor_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in actions:
        bpy.data.actions.remove(action)
    camera = prepare_stage()
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    character_meshes = target_meshes + hands + face + hair
    normalize_skin_weights(character_meshes, fitted)
    points = [point for obj in character_meshes for point in mesh_points(obj, True)]
    render_view(camera, "fitted_rest_front", points, (0, -1, 0.05))
    render_view(camera, "fitted_rest_three_quarter", points, (0.65, -1, 0.08))
    fitted.data.pose_position = "POSE"
    activate_action(fitted, bpy.data.actions["Idle_Loop"])
    bpy.context.scene.frame_set(15)
    points = [point for obj in character_meshes for point in mesh_points(obj, True)]
    render_view(camera, "fitted_idle", points, (0.4, -1, 0.04))
    activate_action(fitted, bpy.data.actions["Walk_Loop"])
    bpy.context.scene.frame_set(8)
    points = [point for obj in character_meshes for point in mesh_points(obj, True)]
    render_view(camera, "fitted_walk", points, (0.6, -1, 0.04))
    activate_action(fitted, bpy.data.actions["Idle_Loop"])
    bpy.context.scene.frame_set(0)
    select_only(fitted)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))
    print(f"RIGGED_BLEND={OUTPUT_BLEND}")
    print(f"RIGGED_HANDS={[len(obj.data.vertices) for obj in hands]}")
    print(f"PRESERVED_CLIPS={len(before_names)}")


def validate_export():
    bpy.ops.wm.open_mainfile(filepath=str(OUTPUT_BLEND))
    rig = bpy.data.objects["Character Subject Rig"]
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.parent == rig]
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    body = next(obj for obj in meshes if "Body" in obj.name)
    match_clothing_weights(body, [obj for obj in meshes if any(name in obj.name for name in ("Jacket", "Trousers"))])
    normalize_skin_weights(meshes, rig)
    actions = [action for action in bpy.data.actions if action.get("source_clip")]
    if len(actions) != 43 or len(rig.data.bones) != 65:
        raise RuntimeError("Donor skeleton or animation clips are missing")
    weight_report = []
    for obj in meshes:
        for vertex in obj.data.vertices:
            total = sum(member.weight for member in vertex.groups if obj.vertex_groups[member.group].name in rig.data.bones)
            if abs(total - 1) > 0.001:
                raise RuntimeError(f"Invalid skin weights: {obj.name} vertex {vertex.index}: {total}")
        weight_report.append({"mesh": obj.name, "vertices": len(obj.data.vertices), "groups": len(obj.vertex_groups)})
    rig.data.pose_position = "POSE"
    samples = []
    for action in actions:
        activate_action(rig, action)
        start, end = action.frame_range
        for fraction in (0, 0.25, 0.5, 0.75, 1):
            frame = start + (end - start) * fraction
            bpy.context.scene.frame_set(int(frame), subframe=frame % 1)
            points = [point for obj in meshes for point in mesh_points(obj, True)]
            if not all(math.isfinite(component) for point in points for component in point):
                raise RuntimeError(f"Non-finite deformation in {action.name}")
            box = bounds(points)
            if max(high - low for low, high in box) > 8:
                raise RuntimeError(f"Excessive deformation in {action.name}: {box}")
            samples.append({"clip": action.name, "frame": round(frame, 3), "bounds": box})
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    report = {"bones": len(rig.data.bones), "clips": len(actions), "samples": len(samples), "weights": weight_report, "animation_samples": samples}
    (REVIEW_DIR / "validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    camera = bpy.context.scene.camera
    for name, frame in (("Crouch_Idle_Loop", 35), ("Sitting_Idle_Loop", 20), ("Pistol_Aim_Neutral", 2)):
        activate_action(rig, bpy.data.actions[name])
        bpy.context.scene.frame_set(frame)
        points = [point for obj in meshes for point in mesh_points(obj, True)]
        render_view(camera, "check_" + name.lower(), points, (0.55, -1, 0.08))
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    body = next(obj for obj in meshes if "Body" in obj.name)
    face_points = [point for point in mesh_points(body, True) if point.z > 2.49]
    face_points.extend(point for obj in meshes if obj.name.startswith("Hair ") for point in mesh_points(obj, True))
    render_view(camera, "face_closeup", face_points, (0.18, -1, 0.04))
    for side in ("L", "R"):
        hand = bpy.data.objects[f"Subject Hand {side}"]
        render_view(camera, "hand_" + side.lower() + "_closeup", mesh_points(hand, True), (0.5, -1, 0.1))
    rig.data.pose_position = "POSE"
    activate_action(rig, bpy.data.actions["Idle_Loop"])
    bpy.context.scene.frame_set(0)
    points = [point for obj in meshes for point in mesh_points(obj, True)]
    render_view(camera, "finished_character", points, (0.4, -1, 0.05))
    for area in (area for screen in bpy.data.screens for area in screen.areas if area.type == "VIEW_3D"):
        space = area.spaces.active
        space.shading.type = "MATERIAL"
        space.clip_end = 100
        space.region_3d.view_location = Vector((0, 0, 1.4))
        space.region_3d.view_distance = 4.3
        space.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
    select_only(rig)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))
    for obj in meshes:
        obj.select_set(True)
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    export_options = {
        "filepath": str(OUTPUT_GLB), "export_format": "GLB", "use_selection": True,
        "export_animations": True, "export_animation_mode": "ACTIONS",
        "export_skins": True, "export_all_influences": False, "export_force_sampling": True,
    }
    if "export_nla_strips" in properties:
        export_options["export_nla_strips"] = False
    bpy.ops.export_scene.gltf(**export_options)
    print(f"VALIDATED={len(samples)} samples across {len(actions)} animations")
    print(f"FINISHED_BLEND={OUTPUT_BLEND}")
    print(f"FINISHED_GLB={OUTPUT_GLB}")


def refine_face():
    bpy.ops.wm.open_mainfile(filepath=str(OUTPUT_BLEND))
    rig = bpy.data.objects["Character Subject Rig"]
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith(("Face ", "Hair ")):
            bpy.data.objects.remove(obj, do_unlink=True)
    body = bpy.data.objects["Character Body"]
    reweight_meshes([body])
    fit_collar(bpy.data.objects["Character Jacket"])
    face = add_face(body, rig, body.data.materials[0])
    hair = add_anime_hair(body, rig)
    camera = prepare_stage()
    points = [point for point in mesh_points(body, True) if point.z > 2.49]
    points.extend(point for obj in hair for point in mesh_points(obj, True))
    render_view(camera, "face_corrected_front", points, (0, -1, 0.02))
    render_view(camera, "face_corrected_three_quarter", points, (0.55, -1, 0.02))
    render_view(camera, "face_corrected_profile", points, (1, -0.15, 0.02))
    rig.data.pose_position = "POSE"
    activate_action(rig, bpy.data.actions["Idle_Loop"])
    bpy.context.scene.frame_set(0)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.parent == rig]
    points = [point for obj in meshes for point in mesh_points(obj, True)]
    render_view(camera, "finished_character", points, (0.4, -1, 0.04))
    select_only(rig)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))
    print(f"FACE_LANDMARKS=nose:2.58 eyes:2.643 mouth:2.545")
    print(f"ANIME_HAIR_MESHES={len(hair)}")


def refine_shoulders():
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for asset in (OUTPUT_BLEND, OUTPUT_GLB):
        backup = REVIEW_DIR / f"MC_before_shoulder_fix{asset.suffix}"
        if asset.exists() and not backup.exists():
            shutil.copy2(asset, backup)
    bpy.ops.wm.open_mainfile(filepath=str(OUTPUT_BLEND))
    rig = bpy.data.objects["Character Subject Rig"]
    rig.data.pose_position = "REST"
    body = bpy.data.objects["Character Body"]
    jacket = bpy.data.objects["Character Jacket"]
    for obj in (body, jacket):
        if obj.get("shoulder_proportions_refined"):
            continue
        neighbors = [[] for vertex in obj.data.vertices]
        for edge in obj.data.edges:
            first, second = edge.vertices
            neighbors[first].append(second)
            neighbors[second].append(first)
        influence = []
        for vertex in obj.data.vertices:
            point = vertex.co
            amount = smoothstep(2.15, 2.31, point.z) * (1 - smoothstep(2.42, 2.5, point.z)) * smoothstep(0.1, 0.22, abs(point.x))
            point.x *= 1 + amount * (0.085 if obj == body else 0.13)
            influence.append(amount)
        for iteration in range(6):
            positions = [vertex.co.copy() for vertex in obj.data.vertices]
            for vertex, amount, adjacent in zip(obj.data.vertices, influence, neighbors):
                if amount > 0 and adjacent:
                    average = sum((positions[index] for index in adjacent), Vector()) / len(adjacent)
                    vertex.co = positions[vertex.index].lerp(average, amount * 0.28)
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
        mesh.to_mesh(obj.data)
        mesh.free()
        obj.data.update()
        obj["shoulder_proportions_refined"] = True
    previous_actions = set(bpy.data.actions)
    previous_objects = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE_FILE))
    imported = [obj for obj in bpy.data.objects if obj not in previous_objects]
    source = next(obj for obj in imported if obj.type == "ARMATURE")
    source.data.pose_position = "REST"
    source_rest = {bone.name: bone.matrix_local.copy() for bone in source.data.bones}
    source_actions = [action for action in bpy.data.actions if action not in previous_actions and any(slot.identifier.startswith("OBArmature") for slot in action.slots)]
    for action in source_actions:
        name = action.name.rsplit(".", 1)[0] if action.name.rsplit(".", 1)[-1].isdigit() else action.name
        action.name = "Source / " + name
    rig.animation_data.action = None
    for action in list(previous_actions):
        if action.get("source_clip"):
            bpy.data.actions.remove(action)
    select_only(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for side, sign in (("l", 1), ("r", -1)):
        clavicle = rig.data.edit_bones[f"clavicle_{side}"]
        clavicle.head = Vector((sign * 0.018, 0.09, 2.425))
        clavicle.tail = Vector((sign * 0.274, 0.13, 2.35))
        original = source.data.bones[f"clavicle_{side}"]
        rotation = (original.tail_local - original.head_local).rotation_difference(clavicle.tail - clavicle.head)
        clavicle.align_roll(rotation @ original.matrix_local.to_3x3().col[2])
        upper = rig.data.edit_bones[f"upperarm_{side}"]
        upper.head = clavicle.tail.copy()
        original = source.data.bones[f"upperarm_{side}"]
        rotation = (original.tail_local - original.head_local).rotation_difference(upper.tail - upper.head)
        upper.align_roll(rotation @ original.matrix_local.to_3x3().col[2])
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.show_in_front = False
    rig.data.display_type = "STICK"
    reweight_meshes([body])
    retarget_actions(source, rig, source_rest, source_actions)
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in source_actions:
        bpy.data.actions.remove(action)
    match_clothing_weights(body, [jacket, bpy.data.objects["Character Trousers"]])
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.parent == rig]
    normalize_skin_weights(meshes, rig)
    camera = prepare_stage()
    rig.data.pose_position = "REST"
    points = [point for obj in (body, jacket) for point in mesh_points(obj, True) if 1.98 < point.z < 2.62]
    render_view(camera, "shoulders_corrected_rest", points, (0, -1, 0.05))
    rig.data.pose_position = "POSE"
    for name, frame in (("Idle_Loop", 15), ("Pistol_Aim_Neutral", 2), ("A_TPose", 0)):
        activate_action(rig, bpy.data.actions[name])
        bpy.context.scene.frame_set(frame)
        points = [point for obj in meshes for point in mesh_points(obj, True)]
        render_view(camera, "shoulders_corrected_" + name.lower(), points, (0.4, -1, 0.06))
    activate_action(rig, bpy.data.actions["Idle_Loop"])
    bpy.context.scene.frame_set(0)
    select_only(body)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))
    print("SHOULDERS_REFINED=symmetric rounded caps and fitted clavicles")
    validate_export()


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("inspect", "build", "validate", "face", "shoulders"))
    options = parser.parse_args(arguments)
    if options.mode == "inspect":
        inspect()
    elif options.mode == "build":
        build()
    elif options.mode == "face":
        refine_face()
    elif options.mode == "shoulders":
        refine_shoulders()
    else:
        validate_export()


if __name__ == "__main__":
    main()