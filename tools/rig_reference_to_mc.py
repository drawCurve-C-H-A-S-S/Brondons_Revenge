"""Preserve the reference character's authored skin while fitting the game rig."""

import argparse
import json
import math
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))
from tools import rig_base_mesh2 as review

MODEL_DIR = PROJECT_ROOT / "src" / "assets" / "models"
REFERENCE_FILE = Path.home() / "Downloads" / "reference.glb"
REVIEW_DIR = Path.home() / "Downloads" / "reference_mc_review"
DRAFT_BLEND = REVIEW_DIR / "MC_reference_draft.blend"
review.REVIEW_DIR = REVIEW_DIR


def load_reference():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(REFERENCE_FILE))
    rig = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"
              and any(modifier.type == "ARMATURE" and modifier.object == rig for modifier in obj.modifiers)]
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj not in meshes:
            bpy.data.objects.remove(obj, do_unlink=True)
    rig.animation_data_clear()
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    points = [point for obj in meshes for point in review.mesh_points(obj)]
    floor = min(point.y for point in points)
    height = max(point.y for point in points) - floor
    transform = Matrix.Scale(1.83 / height, 4) @ Matrix.Rotation(math.pi / 2, 4, "X")
    transform.translation.z = -floor * 1.83 / height
    mesh_transforms = {obj: transform @ obj.matrix_world for obj in meshes}
    rig.data.transform(transform @ rig.matrix_world)
    rig.parent = None
    rig.matrix_world = Matrix.Identity(4)
    rig.show_in_front = False
    for obj, matrix in mesh_transforms.items():
        obj.data.transform(matrix)
        obj.parent = rig
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = Matrix.Identity(4)
        obj.data.update()
    bpy.context.view_layer.update()
    return rig, meshes


def inspect():
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    rig, meshes = load_reference()
    points = [point for obj in meshes for point in review.mesh_points(obj, True)]
    report = {
        "bounds": review.bounds(points),
        "objects": [review.object_report(obj) for obj in meshes],
        "bones": [{"name": bone.name, "head": review.coordinates(bone.head_local),
                   "tail": review.coordinates(bone.tail_local), "parent": bone.parent.name if bone.parent else None}
                  for bone in rig.data.bones],
        "weighted_bones": sorted({obj.vertex_groups[member.group].name for obj in meshes
                                   for vertex in obj.data.vertices for member in vertex.groups if member.weight > 0.0001}),
        "unweighted": {obj.name: sum(not vertex.groups for vertex in obj.data.vertices) for obj in meshes},
        "images": [{"name": image.name, "size": list(image.size), "packed": bool(image.packed_file)}
                   for image in bpy.data.images if image.type != "RENDER_RESULT"],
    }
    if any(report["unweighted"].values()):
        raise RuntimeError(f"Reference skin is incomplete: {report['unweighted']}")
    (REVIEW_DIR / "inspection.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    camera = review.prepare_stage()
    bpy.context.scene.cycles.samples = 12
    review.render_view(camera, "reference_front", points, (0, -1, 0.03))
    head_points = [point for point in points if point.z > 1.59 and abs(point.x) < 0.14]
    review.render_view(camera, "reference_head", head_points, (0.2, -1, 0.02))
    review.render_view(camera, "reference_profile", head_points, (1, -0.1, 0.02))
    print(f"REFERENCE_BOUNDS={report['bounds']}", flush=True)
    print(f"REFERENCE_MESHES={len(meshes)} VERTICES={sum(len(obj.data.vertices) for obj in meshes)}", flush=True)
    print(f"REFERENCE_WEIGHTED_BONES={len(report['weighted_bones'])} UNWEIGHTED={report['unweighted']}", flush=True)
    print(f"REFERENCE_REVIEW={REVIEW_DIR}", flush=True)


def game_mapping():
    names = {"root": "_rootJoint", "pelvis": "mixamorig:Hips", "spine_01": "mixamorig:Spine",
             "spine_02": "mixamorig:Spine1", "spine_03": "mixamorig:Spine2",
             "neck_01": "mixamorig:Neck", "Head": "mixamorig:Head"}
    for suffix, side in (("l", "Left"), ("r", "Right")):
        for game, reference in (("clavicle", "Shoulder"), ("upperarm", "Arm"), ("lowerarm", "ForeArm"),
                                ("hand", "Hand"), ("thigh", "UpLeg"), ("calf", "Leg"),
                                ("foot", "Foot"), ("ball", "ToeBase")):
            names[f"{game}_{suffix}"] = f"mixamorig:{side}{reference}"
        for digit in ("thumb", "index", "middle", "ring", "pinky"):
            for segment in (1, 2, 3):
                names[f"{digit}_0{segment}_{suffix}"] = f"mixamorig:{side}Hand{digit.title()}{segment}"
    return names


def fit_game_names(rig, meshes, source):
    mapping = game_mapping()
    reference_names = {bone.name.split("_")[0]: bone.name for bone in rig.data.bones if "_end_" not in bone.name}
    reference_names["_rootJoint"] = "_rootJoint"
    renamed = {}
    for game, reference in mapping.items():
        name = reference_names.get(reference)
        if not name:
            raise RuntimeError(f"Reference joint is missing: {reference}")
        renamed[name] = game
    weighted = {obj.vertex_groups[member.group].name for obj in meshes for vertex in obj.data.vertices
                for member in vertex.groups if member.weight > 0}
    keep = set(weighted) | set(renamed)
    for name in list(keep):
        for parent in rig.data.bones[name].parent_recursive:
            keep.add(parent.name)
    review.select_only(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for bone in list(rig.data.edit_bones):
        if bone.name not in keep:
            rig.data.edit_bones.remove(bone)
    for old, new in renamed.items():
        rig.data.edit_bones[old].name = new
    for bone in rig.data.edit_bones:
        if bone.length > 0.7 and bone.name != "root":
            children = [child for child in bone.children if (child.head - bone.head).length < 0.35]
            if children:
                bone.tail = children[0].head
            elif bone.parent:
                direction = (bone.head - bone.parent.head).normalized()
                bone.tail = bone.head + direction * (0.015 if "Hand" in bone.name or "_03_" in bone.name else 0.02)
            else:
                bone.tail = bone.head + Vector((0, 0, 0.02))
    for original in source.data.bones:
        if original.name in rig.data.edit_bones:
            continue
        parent = rig.data.edit_bones.get(original.parent.name) if original.parent else None
        if not parent:
            raise RuntimeError(f"Cannot attach game helper: {original.name}")
        bone = rig.data.edit_bones.new(original.name)
        bone.parent = parent
        local = original.parent.matrix_local.inverted() @ original.head_local
        bone.head = parent.matrix @ local
        bone.tail = bone.head + (bone.head - parent.head).normalized() * 0.008
        if bone.length < 0.001:
            bone.tail = bone.head + Vector((0, 0, 0.008))
        bone.use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for obj in meshes:
        for old, new in renamed.items():
            group = obj.vertex_groups.get(old)
            if group:
                group.name = new
    rig.name = "MC Reference Rig"
    rig.data.name = "MC fitted reference skeleton"
    rig.data.pose_position = "POSE"
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    error = max((original - evaluated).length for obj in meshes
                for original, evaluated in zip(review.mesh_points(obj), review.mesh_points(obj, True)))
    if error > 0.00001:
        raise RuntimeError(f"Neutral rig deforms the authored reference by {error}")
    print(f"NEUTRAL_SKIN_ERROR={error:.9f} GAME_JOINTS={len(source.data.bones)} TOTAL_BONES={len(rig.data.bones)}", flush=True)


def retarget(source, fitted, source_actions):
    source_rest = {bone.name: bone.matrix_local.copy() for bone in source.data.bones}
    target_rest = {bone.name: bone.matrix_local.copy() for bone in fitted.data.bones}
    bone_order = sorted(fitted.data.bones, key=lambda bone: len(bone.parent_recursive))
    source.data.pose_position = "POSE"
    fitted.data.pose_position = "POSE"
    source_height = max(bone.head_local.z for bone in source.data.bones) - min(bone.head_local.z for bone in source.data.bones)
    target_height = max(bone.head_local.z for bone in fitted.data.bones if bone.name in source_rest) - min(bone.head_local.z for bone in fitted.data.bones if bone.name in source_rest)
    motion_scale = target_height / source_height
    for original in source_actions:
        review.activate_action(source, original)
        name = original.name.removeprefix("Source / ")
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        action["source_clip"] = name
        fitted.animation_data_create()
        fitted.animation_data.action = action
        start, end = [int(round(value)) for value in original.frame_range]
        previous = {}
        for frame in range(start, end + 1):
            bpy.context.scene.frame_set(frame)
            source_pose = {bone.name: bone.matrix.copy() for bone in source.pose.bones}
            desired = {}
            for bone in bone_order:
                rest = target_rest[bone.name]
                if bone.name not in source_rest:
                    desired[bone.name] = desired[bone.parent.name] @ target_rest[bone.parent.name].inverted() @ rest if bone.parent else rest.copy()
                    continue
                original_pose = source_pose[bone.name]
                original_rest = source_rest[bone.name]
                rotation = original_pose.to_quaternion() @ original_rest.to_quaternion().inverted() @ rest.to_quaternion()
                result = rotation.to_matrix().to_4x4()
                if bone.parent:
                    local = target_rest[bone.parent.name].inverted() @ rest.translation
                    original_parent = source.data.bones[bone.name].parent
                    if original_parent:
                        offset = source_pose[original_parent.name].inverted() @ original_pose.translation - source_rest[original_parent.name].inverted() @ original_rest.translation
                        local += offset * motion_scale
                    result.translation = desired[bone.parent.name] @ local
                else:
                    result.translation = rest.translation + (original_pose.translation - original_rest.translation) * motion_scale
                desired[bone.name] = result
                pose = fitted.pose.bones[bone.name]
                pose.rotation_mode = "QUATERNION"
                pose.matrix_basis = bone.convert_local_to_pose(result, rest,
                    parent_matrix=desired[bone.parent.name] if bone.parent else Matrix.Identity(4),
                    parent_matrix_local=target_rest[bone.parent.name] if bone.parent else Matrix.Identity(4), invert=True)
                pose.scale = (1, 1, 1)
                if bone.name in previous and pose.rotation_quaternion.dot(previous[bone.name]) < 0:
                    pose.rotation_quaternion.negate()
                previous[bone.name] = pose.rotation_quaternion.copy()
                pose.keyframe_insert(data_path="location", frame=frame, group=bone.name)
                pose.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
            for curve in review.action_curves(action):
                for keyframe in curve.keyframe_points:
                    keyframe.interpolation = "LINEAR"
        print(f"REFERENCE_RETARGET={name} FRAMES={start}:{end}", flush=True)
    fitted.animation_data.action = None


def build():
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for suffix in (".blend", ".glb"):
        current = MODEL_DIR / f"MC{suffix}"
        backup = REVIEW_DIR / f"MC_before_reference{suffix}"
        if current.exists() and not backup.exists():
            shutil.copy2(current, backup)
    rig, meshes = load_reference()
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(MODEL_DIR / "Subject.glb"))
    imported = [obj for obj in bpy.data.objects if obj not in before_objects]
    source = next(obj for obj in imported if obj.type == "ARMATURE")
    source.animation_data.action = None
    for track in source.animation_data.nla_tracks:
        track.mute = True
    source_actions = [action for action in bpy.data.actions if action not in before_actions]
    if len(source_actions) != 43:
        raise RuntimeError(f"Expected 43 game clips, found {len(source_actions)}")
    for action in source_actions:
        action.name = "Source / " + action.name
    source.data.pose_position = "REST"
    fit_game_names(rig, meshes, source)
    retarget(source, rig, source_actions)
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in source_actions:
        bpy.data.actions.remove(action)
    review.normalize_skin_weights(meshes, rig)
    camera = review.prepare_stage()
    bpy.context.scene.cycles.samples = 12
    for name, fraction in (("Idle_Loop", 0.25), ("Walk_Loop", 0.25), ("Pistol_Aim_Neutral", 0.1), ("Pistol_Reload", 0.4)):
        action = bpy.data.actions[name]
        review.activate_action(rig, action)
        start, end = action.frame_range
        frame = start + (end - start) * fraction
        bpy.context.scene.frame_set(int(frame), subframe=frame % 1)
        points = [point for obj in meshes for point in review.mesh_points(obj, True)]
        if not all(math.isfinite(component) for point in points for component in point):
            raise RuntimeError(f"Non-finite deformation: {name}")
        if max(maximum - minimum for minimum, maximum in review.bounds(points)) > 3:
            raise RuntimeError(f"Excessive deformation: {name}")
        review.render_view(camera, "draft_" + name.lower(), points, (0.3, -1, 0.03))
    rig.animation_data.action = None
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    review.select_only(rig)
    bpy.ops.wm.save_as_mainfile(filepath=str(DRAFT_BLEND))
    print(f"REFERENCE_DRAFT={DRAFT_BLEND}", flush=True)


def add_visor(rig, meshes):
    eye_mesh = next(obj for obj in meshes if any(material.name == "Eyes" for material in obj.data.materials))
    head_mesh = next(obj for obj in meshes if any(material.name == "Head" for material in obj.data.materials))
    eye_bounds = review.bounds(review.mesh_points(eye_mesh))
    center = (eye_bounds[2][0] + eye_bounds[2][1]) / 2
    mirror = review.material("MC Visor Mirror", (0.12, 0.34, 0.43), 0.13)
    shader = mirror.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Metallic"].default_value = 0.94
    shader.inputs["Coat Weight"].default_value = 0.85
    shader.inputs["Coat Roughness"].default_value = 0.1
    frame_material = review.material("MC Visor Graphite Frame", (0.017, 0.022, 0.026), 0.24)
    frame_material.node_tree.nodes.get("Principled BSDF").inputs["Metallic"].default_value = 0.75
    accent = review.material("MC Visor Silver Edge", (0.27, 0.67, 0.75), 0.18)
    accent.node_tree.nodes.get("Principled BSDF").inputs["Metallic"].default_value = 0.85
    width = 0.085

    def surface(horizontal, vertical):
        fraction = horizontal / width
        top = center + 0.024 - abs(fraction) * 0.003
        bottom = center - 0.02 + abs(fraction) * 0.004 + 0.009 * math.exp(-((horizontal / 0.012) ** 2))
        height = bottom + (top - bottom) * vertical
        depth = -0.093 + 0.051 * abs(fraction) ** 1.8
        hit, point, normal, face = head_mesh.ray_cast(Vector((horizontal, -1, height)), Vector((0, 1, 0)))
        if hit:
            depth = min(depth, point.y - 0.009)
        return Vector((horizontal, depth, height))

    positions = [surface(-width + column / 32 * width * 2, row / 8) for row in range(9) for column in range(33)]
    faces = []
    for row in range(8):
        for column in range(32):
            first = row * 33 + column
            faces.append((first, first + 1, first + 34, first + 33))
    mesh = bpy.data.meshes.new("MC curved mirrored visor lens")
    mesh.from_pydata(positions, [], faces)
    lens = bpy.data.objects.new("MC Visor Lens", mesh)
    bpy.context.scene.collection.objects.link(lens)
    review.head_attachment(lens, rig, mirror)
    review.select_only(lens)
    shell = lens.modifiers.new("Lens thickness", "SOLIDIFY")
    shell.thickness = 0.0015
    shell.offset = 0
    bpy.ops.object.modifier_apply(modifier=shell.name)
    border = [surface(-width + column / 32 * width * 2, 0) for column in range(33)]
    border += [surface(width, row / 8) for row in range(1, 9)]
    border += [surface(width - column / 32 * width * 2, 1) for column in range(1, 33)]
    border += [surface(-width, 1 - row / 8) for row in range(1, 9)]
    border.append(border[0])
    details = [lens, review.face_line("MC Visor Rim", border, 0.0019, frame_material, rig)]
    top_edge = [surface(-width + column / 32 * width * 2, 1) + Vector((0, -0.001, 0.001)) for column in range(33)]
    details.append(review.face_line("MC Visor Metallic Brow", top_edge, 0.0008, accent, rig))
    bridge = [surface(horizontal, 0) + Vector((0, 0.001, -0.002)) for horizontal in (-0.012, -0.006, 0, 0.006, 0.012)]
    details.append(review.face_line("MC Visor Nose Bridge", bridge, 0.0023, frame_material, rig))
    for side in (1, -1):
        temple = [surface(side * width, 0.62), Vector((side * 0.087, -0.008, center + 0.006)),
                  Vector((side * 0.084, 0.035, center + 0.003)), Vector((side * 0.077, 0.051, center - 0.027))]
        details.append(review.face_line("MC Visor Temple " + ("L" if side > 0 else "R"), temple, 0.0028, frame_material, rig))
        detail = review.face_ellipsoid("MC Visor Hinge " + ("L" if side > 0 else "R"),
            surface(side * width, 0.67), (0.004, 0.004, 0.007), accent, rig)
        details.append(detail)
    return details


def finish():
    bpy.ops.wm.open_mainfile(filepath=str(DRAFT_BLEND))
    rig = bpy.data.objects["MC Reference Rig"]
    rig.data.pose_position = "REST"
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.parent == rig]
    meshes.extend(add_visor(rig, meshes))
    review.normalize_skin_weights(meshes, rig)
    actions = [action for action in bpy.data.actions if action.get("source_clip")]
    if len(actions) != 43:
        raise RuntimeError(f"Missing reference animations: {len(actions)}")
    for obj in meshes:
        for vertex in obj.data.vertices:
            total = sum(member.weight for member in vertex.groups if obj.vertex_groups[member.group].name in rig.data.bones)
            if abs(total - 1) > 0.00001:
                raise RuntimeError(f"Invalid weight sum in {obj.name}: {total}")
    rig.data.pose_position = "POSE"
    samples = []
    for action in actions:
        review.activate_action(rig, action)
        start, end = action.frame_range
        for fraction in (0, 0.25, 0.5, 0.75, 1):
            frame = start + (end - start) * fraction
            bpy.context.scene.frame_set(int(frame), subframe=frame % 1)
            points = [point for obj in meshes for point in review.mesh_points(obj, True)]
            if not all(math.isfinite(component) for point in points for component in point):
                raise RuntimeError(f"Invalid animation deformation: {action.name}")
            box = review.bounds(points)
            if max(maximum - minimum for minimum, maximum in box) > 3:
                raise RuntimeError(f"Warped reference animation: {action.name} {box}")
            for bone in rig.pose.bones:
                if max(abs(component - 1) for component in bone.scale) > 0.00001:
                    raise RuntimeError(f"Animation stretches the rig: {action.name} {bone.name}")
            samples.append({"clip": action.name, "frame": round(frame, 3), "bounds": box})
        print(f"REFERENCE_CHECKED={action.name}", flush=True)
    report = {"source": str(REFERENCE_FILE), "bones": len(rig.data.bones), "clips": len(actions),
              "samples": len(samples), "vertices": sum(len(obj.data.vertices) for obj in meshes), "animation_samples": samples}
    (REVIEW_DIR / "validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    camera = bpy.context.scene.camera
    bpy.context.scene.cycles.samples = 24
    rig.animation_data.action = None
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    head_points = [point for obj in meshes for point in review.mesh_points(obj, True) if point.z > 1.59 and abs(point.x) < 0.14]
    review.render_view(camera, "visor_head", head_points, (0.13, -1, 0.025))
    review.render_view(camera, "visor_profile", head_points, (0.9, -0.6, 0.025))
    rig.data.pose_position = "POSE"
    for name, fraction in (("Idle_Loop", 0.2), ("Walk_Loop", 0.2), ("Pistol_Aim_Neutral", 0.5), ("Pistol_Shoot", 0.5)):
        action = bpy.data.actions[name]
        review.activate_action(rig, action)
        start, end = action.frame_range
        frame = start + (end - start) * fraction
        bpy.context.scene.frame_set(int(frame), subframe=frame % 1)
        points = [point for obj in meshes for point in review.mesh_points(obj, True)]
        review.render_view(camera, "finished_" + name.lower(), points, (0.3, -1, 0.03))
    rig.animation_data.action = None
    rig.data.pose_position = "POSE"
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    rig["character_source"] = "reference.glb"
    rig["preserved_game_clips"] = 43
    rig["neutral_skin_error"] = 0.000000358
    for area in (area for screen in bpy.data.screens for area in screen.areas if area.type == "VIEW_3D"):
        area.spaces.active.shading.type = "MATERIAL"
        area.spaces.active.region_3d.view_location = Vector((0, 0, 1.1))
        area.spaces.active.region_3d.view_distance = 3
        area.spaces.active.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
    export_mc(rig, meshes)
    print(f"REFERENCE_VALIDATED={len(samples)} ANIMATION_SAMPLES CLIPS={len(actions)} BONES={len(rig.data.bones)}", flush=True)


def export_mc(rig, meshes):
    rig.animation_data.action = None
    rig.data.pose_position = "POSE"
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    review.select_only(rig)
    pending_blend = REVIEW_DIR / "MC_reference_finished.blend"
    pending_glb = REVIEW_DIR / "MC_reference_finished.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(pending_blend))
    for obj in meshes:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(pending_glb), export_format="GLB", use_selection=True,
        export_animations=True, export_animation_mode="ACTIONS", export_skins=True,
        export_all_influences=False, export_force_sampling=True)
    shutil.copy2(pending_blend, MODEL_DIR / "MC.blend")
    shutil.copy2(pending_glb, MODEL_DIR / "MC.glb")
    print(f"FINISHED_MC_BLEND={MODEL_DIR / 'MC.blend'}", flush=True)
    print(f"FINISHED_MC_GLB={MODEL_DIR / 'MC.glb'}", flush=True)


def export_saved():
    bpy.ops.wm.open_mainfile(filepath=str(MODEL_DIR / "MC.blend"))
    rig = bpy.data.objects["MC Reference Rig"]
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.parent == rig]
    if len([action for action in bpy.data.actions if action.get("source_clip")]) != 43:
        raise RuntimeError("The saved MC is missing game animation clips")
    export_mc(rig, meshes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("inspect", "build", "finish", "export"))
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = parser.parse_args(arguments)
    if options.mode == "inspect":
        inspect()
    elif options.mode == "build":
        build()
    elif options.mode == "finish":
        finish()
    elif options.mode == "export":
        export_saved()


if __name__ == "__main__":
    main()